export async function createKernels(device){
    const common=await(await fetch('common.wgsl')).text(),body=await(await fetch('fdtd.wgsl')).text(),fused=await(await fetch('fused.wgsl')).text();
    const module=device.createShaderModule({code:common+body+fused});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
    const group=device.createBindGroupLayout({entries:[{binding:0,visibility:4,buffer:{type:'uniform'}},
        ...[1,2,3,4,5,6,7].map(binding=>({binding,visibility:4,buffer:{type:binding===5?'read-only-storage':'storage'}}))]});
    const layout=device.createPipelineLayout({bindGroupLayouts:[group]}),k={common,group};
    for(const entryPoint of ['initialize','stepH','stepE'])k[entryPoint]=await device.createComputePipelineAsync({layout,compute:{module,entryPoint}});
    k.initialize_fused=await device.createComputePipelineAsync({layout,compute:{module,entryPoint:'initialize',constants:{fused:true}}});
    k.fused=[];for(const parity of [0,1])k.fused.push(await device.createComputePipelineAsync({layout,compute:{module,entryPoint:'stepFused',constants:{parity}}}));
    return k;
}
export class Solver {
    constructor(device,k,ppa=32,preset=2,frequency=.36,defect=0,test=0,optimized=true){
        Object.assign(this,{device,k,ppa,preset,frequency,defect,test,optimized,nx:32*ppa,ny:24*ppa,steps:0,source:true});
        this.cells=this.nx*this.ny;this.dx=1/ppa;this.dt=.65*this.dx;
        this.params=device.createBuffer({size:64,usage:72});
        this.current=0;
        this.state=[0,1].map(()=>device.createBuffer({size:this.cells*(optimized?16:8),usage:132}));
        this.epsilon=device.createBuffer({size:this.cells*4,usage:128});
        this.intensity=device.createBuffer({size:this.cells*4,usage:132});
        this.edits=device.createBuffer({size:25*17*4,usage:136});
        this.clock=device.createBuffer({size:32,usage:128});
        this.axes=device.createBuffer({size:2*(this.nx+this.ny)*16,usage:128});
        this.overrides=new Float32Array(25*17).fill(-1);
        this.groups=(optimized?[0,1]:[0]).map(i=>device.createBindGroup({layout:k.group,entries:[this.params,this.state[i],this.state[1-i],this.epsilon,this.intensity,this.edits,this.clock,this.axes].map((buffer,binding)=>({binding,resource:{buffer}}))}));
        this.configure();this.reset();
    }
    configure(){
        const data=new ArrayBuffer(64);new Uint32Array(data).set([this.nx,this.ny,this.cells,this.test]);
        new Float32Array(data).set([this.dx,this.dt,this.frequency,Number(this.source),-16,-12,32,24,this.preset,this.defect,this.preset===3?0:-13.5,0],4);
        this.device.queue.writeBuffer(this.params,0,data);
    }
    get electric(){return this.state[this.optimized?this.current:0];}
    get magnetic(){return this.state[this.optimized?this.current:1];}
    dispatch(pass,name){if(this.optimized&&name==='initialize')name='initialize_fused';pass.setPipeline(this.k[name]);pass.setBindGroup(0,this.groups[this.current]);pass.dispatchWorkgroups(Math.ceil(this.nx/16),Math.ceil(this.ny/8));}
    reset(){this.steps=0;this.current=0;this.configure();this.device.queue.writeBuffer(this.edits,0,this.overrides);const e=this.device.createCommandEncoder(),p=e.beginComputePass();this.dispatch(p,'initialize');p.end();this.device.queue.submit([e.finish()]);}
    advance(count,encoder=null,querySet=null){const e=encoder??this.device.createCommandEncoder(),p=e.beginComputePass(querySet?{timestampWrites:{querySet,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});
        for(let i=0;i<count;i++){
            if(this.optimized){p.setPipeline(this.k.fused[this.current]);p.setBindGroup(0,this.groups[this.current]);p.dispatchWorkgroups(this.nx/32,this.ny/8);this.current=1-this.current;}
            else{this.dispatch(p,'stepH');this.dispatch(p,'stepE');}
        }
        p.end();this.steps+=count;if(!encoder)this.device.queue.submit([e.finish()]);}
    get time(){return this.steps*this.dt;}
    rodRadius(x,y){
        const override=this.overrides[x+12+25*(y+8)];if(override>=0)return override;
        const defect=(this.preset===1&&y===0)||(this.preset===2&&((y===0&&x<=2)||(x===2&&y>=0)))||(this.preset===3&&x===0&&y===0);
        return defect?this.defect:.2;
    }
    toggleRod(x,y){const key=x+12+25*(y+8);this.overrides[key]=this.rodRadius(x,y)>.1?0:.2;this.reset();}
    async read(){
        const buffers=[[this.electric,0,this.cells*8],[this.magnetic,this.optimized?this.cells*8:0,this.cells*8],[this.intensity,0,this.cells*4]],e=this.device.createCommandEncoder();
        const read=buffers.map(([b,offset,size])=>{const r=this.device.createBuffer({size,usage:9});e.copyBufferToBuffer(b,offset,r,0,size);return r;});
        this.device.queue.submit([e.finish()]);const result=[];
        for(const b of read){await b.mapAsync(1);result.push(new Float32Array(b.getMappedRange()).slice());b.unmap();b.destroy();}return result;
    }
    destroy(){for(const b of [this.params,...this.state,this.epsilon,this.intensity,this.edits,this.clock,this.axes])b.destroy();}
}
