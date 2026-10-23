export async function kernels(device) {
    const module=device.createShaderModule({code:await(await fetch('simulation.wgsl')).text()});
    const info=await module.getCompilationInfo();
    if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
    const group=device.createBindGroupLayout({entries:[
        {binding:0,visibility:4,buffer:{type:'uniform'}},
        ...[1,2,3,4].map(binding=>({binding,visibility:4,buffer:{type:[1,3].includes(binding)?'read-only-storage':'storage'}})),
        ...[5,6].map(binding=>({binding,visibility:4,storageTexture:{access:'write-only',format:'rgba16float',viewDimension:'3d'}})),
        {binding:7,visibility:4,buffer:{type:'storage'}}]});
    const layout=device.createPipelineLayout({bindGroupLayouts:[group]});
    const result={group};
    for(const entryPoint of ['initialize','step','extract','curl','forces']){
        result[entryPoint]=await device.createComputePipelineAsync({layout,compute:{module,entryPoint}});
    }
    result.fast=await device.createComputePipelineAsync({layout,compute:{module,entryPoint:'step',constants:{optimized:true,tiled:true,wg_x:32,wg_y:2,wg_z:2}}});
    result.step_field=await device.createComputePipelineAsync({layout,compute:{module,entryPoint:'step',constants:{write_field:true}}});
    for(const entryPoint of ['initialize','step','extract','forces']){
        result[`half_${entryPoint}`]=await device.createComputePipelineAsync({layout,compute:{module,entryPoint,constants:{optimized:true,compressed:true}}});
    }
    for(const entryPoint of ['initialize','step'])result[`wave_${entryPoint}`]=await device.createComputePipelineAsync({layout,compute:{module,entryPoint,constants:{optimized:true,shear_test:true}}});
    return result;
}
export class Flow {
    constructor(device,k,geometry,grid,flags,alpha=8,re=2000,format='fp32',wave=false){
        Object.assign(this,{device,k,geometry,grid,alpha,re,format,wave,current:0,steps:0,U:.07});
        this.cells=grid.reduce((a,b)=>a*b,1);this.dx=geometry.domain.size[0]/grid[0];
        this.params=device.createBuffer({size:48,usage:72});
        const data=new ArrayBuffer(48);new Uint32Array(data).set([...grid,this.cells]);
        new Float32Array(data).set([this.U,wave?.65:.5+3*this.U*geometry.mac/this.dx/re,wave?0:.14,alpha*Math.PI/180,...geometry.domain.origin,this.dx],4);
        device.queue.writeBuffer(this.params,0,data);
        this.pop=[0,1].map(()=>device.createBuffer({size:this.cells*(format==='fp16'?40:76),usage:128}));
        this.flags=device.createBuffer({size:flags.byteLength,usage:136});device.queue.writeBuffer(this.flags,0,flags);
        this.field=device.createBuffer({size:this.cells*16,usage:132});
        this.forcePartials=device.createBuffer({size:Math.ceil(this.cells/128)*16,usage:132});
        this.textures=[0,1].map(()=>device.createTexture({size:grid,dimension:'3d',format:'rgba16float',usage:12}));
        this.groups=[0,1].map(i=>device.createBindGroup({layout:k.group,entries:[
            this.params,this.pop[i],this.pop[1-i],this.flags,this.field,...this.textures.map(t=>t.createView()),this.forcePartials
        ].map((r,binding)=>({binding,resource:binding<5||binding===7?{buffer:r}:r}))}));
    }
    dispatch(pass,name){
        if(this.wave&&['initialize','step','fast'].includes(name))name=`wave_${name==='fast'?'step':name}`;
        else if(this.format==='fp16'&&['initialize','step','fast','extract','forces'].includes(name))name=`half_${name==='fast'?'step':name}`;
        pass.setPipeline(this.k[name]);pass.setBindGroup(0,this.groups[this.current]);
        if(name==='fast')pass.dispatchWorkgroups(Math.ceil(this.grid[0]/32),Math.ceil(this.grid[1]/2),Math.ceil(this.grid[2]/2));
        else pass.dispatchWorkgroups(Math.min(32768,Math.ceil(this.cells/128)),Math.ceil(this.cells/4194304));
    }
    init(){const e=this.device.createCommandEncoder(),p=e.beginComputePass();this.dispatch(p,'initialize');this.current=1;this.dispatch(p,'initialize');this.current=0;this.dispatch(p,'extract');this.dispatch(p,'curl');p.end();this.device.queue.submit([e.finish()]);}
    advance(count,fast=true,encoder=null){const e=encoder??this.device.createCommandEncoder(),p=e.beginComputePass();
        for(let i=0;i<count;i++){this.dispatch(p,fast?'fast':'step');this.current=1-this.current;}
        p.end();if(!encoder)this.device.queue.submit([e.finish()]);this.steps+=count;}
    update(encoder=null){const e=encoder??this.device.createCommandEncoder(),p=e.beginComputePass();this.dispatch(p,'extract');this.dispatch(p,'curl');p.end();if(!encoder)this.device.queue.submit([e.finish()]);}
    frame(count,encoder){
        if(this.format!=='fp32'||this.wave){this.advance(count,false,encoder);this.update(encoder);return;}
        const p=encoder.beginComputePass();
        for(let i=0;i<count;i++){this.dispatch(p,i===count-1?'step_field':'step');this.current=1-this.current;}
        // Solid velocities stay zero from init(); only fluid nodes change during stepping.
        this.steps+=count;this.dispatch(p,'curl');p.end();
    }
    get time(){return this.steps*this.U*this.dx/this.geometry.mac;}
    async read(){const b=this.device.createBuffer({size:this.field.size,usage:9}),e=this.device.createCommandEncoder();e.copyBufferToBuffer(this.field,0,b,0,b.size);this.device.queue.submit([e.finish()]);await b.mapAsync(1);const a=new Float32Array(b.getMappedRange()).slice();b.unmap();b.destroy();return a;}
    async force(){
        const e=this.device.createCommandEncoder(),p=e.beginComputePass();this.dispatch(p,'forces');p.end();
        const b=this.device.createBuffer({size:this.forcePartials.size,usage:9});e.copyBufferToBuffer(this.forcePartials,0,b,0,b.size);this.device.queue.submit([e.finish()]);await b.mapAsync(1);
        const a=new Float32Array(b.getMappedRange()),sum=[0,0,0];for(let i=0;i<a.length;i+=4)for(let j=0;j<3;j++)sum[j]+=a[i+j];b.unmap();b.destroy();
        const scale=2*this.dx*this.dx/(this.U*this.U*this.geometry.area),alpha=this.alpha*Math.PI/180;
        return {force_lattice:sum,CL:(sum[2]*Math.cos(alpha)-sum[0]*Math.sin(alpha))*scale,CD:(sum[0]*Math.cos(alpha)+sum[2]*Math.sin(alpha))*scale};
    }
    destroy(){for(const b of [this.params,this.flags,this.field,this.forcePartials,...this.pop,...this.textures])b.destroy();}
}
