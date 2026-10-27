export async function createKernels(device){
    const module=device.createShaderModule({code:await(await fetch('mhd.wgsl')).text()});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
    const entries=[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
        ...[1,2,3,4,5,6,7].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===1?'read-only-storage':'storage'}}))];
    const group=device.createBindGroupLayout({entries}),layout=device.createPipelineLayout({bindGroupLayouts:[group]}),k={group};
    for(const entryPoint of ['initialize','forwardRows','forwardColumns','inverseColumns','inverseRows','computeCurrent','euler','adamsBashforth'])
        k[entryPoint]=await device.createComputePipelineAsync({layout,compute:{module,entryPoint}});
    return k;
}
export class Solver {
    constructor(device,k,n=256,eta=.003,test=0,amplitude=.20){
        Object.assign(this,{device,k,n,eta,test,amplitude,nu:.003,dx:2*Math.PI/n,steps:0,currentIndex:0,stepScale:1});
        const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
        this.params=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        this.state=[0,1].map(()=>device.createBuffer({size:n*n*8,usage:storage}));
        this.previous=device.createBuffer({size:n*n*8,usage:storage});
        this.phi=device.createBuffer({size:n*n*4,usage:storage});
        this.current=device.createBuffer({size:n*n*4,usage:storage});
        this.fft=[0,1].map(()=>device.createBuffer({size:n*n*8,usage:storage}));
        this.groups=[0,1].map(i=>device.createBindGroup({layout:k.group,entries:[this.params,this.state[i],this.previous,this.state[1-i],this.phi,this.current,...this.fft].map((buffer,binding)=>({binding,resource:{buffer}}))}));
        this.configure();this.reset();
    }
    configure(){
        // AB2 has a shorter negative-real stability interval than Euler.
        this.dt=this.stepScale*Math.min(.12*this.dx,.11*this.dx*this.dx/Math.max(this.eta,this.nu));
        const data=new ArrayBuffer(48);new Uint32Array(data).set([this.n,Math.log2(this.n),this.test,0]);
        new Float32Array(data).set([this.dx,this.dt,this.eta,this.nu,.18,this.amplitude,0,0],4);this.device.queue.writeBuffer(this.params,0,data);
    }
    dispatch(p,name){p.setPipeline(this.k[name]);
        if(name.includes('Rows')||name.includes('Columns'))p.dispatchWorkgroups(this.n);
        else p.dispatchWorkgroups(Math.ceil(this.n/16),Math.ceil(this.n/8));}
    solve(p,group){p.setBindGroup(0,group);for(const name of ['forwardRows','forwardColumns','inverseColumns','inverseRows','computeCurrent'])this.dispatch(p,name);}
    reset(){this.steps=0;this.elapsed=0;this.currentIndex=0;this.needsEuler=true;const e=this.device.createCommandEncoder(),p=e.beginComputePass();
        p.setBindGroup(0,this.groups[1]);this.dispatch(p,'initialize');p.end();this.device.queue.submit([e.finish()]);}
    advance(count,e){const p=e.beginComputePass();
        for(let i=0;i<count;i++){
            this.solve(p,this.groups[this.currentIndex]);this.dispatch(p,this.needsEuler?'euler':'adamsBashforth');this.needsEuler=false;this.currentIndex=1-this.currentIndex;
        }p.end();this.steps+=count;this.elapsed+=count*this.dt;
    }
    get field(){return this.state[this.currentIndex];}
    get time(){return this.elapsed;}
    async read(buffer){const out=this.device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        const e=this.device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,out,0,buffer.size);this.device.queue.submit([e.finish()]);
        await out.mapAsync(GPUMapMode.READ);const data=new Float32Array(out.getMappedRange()).slice();out.unmap();out.destroy();return data;}
    destroy(){for(const b of [this.params,...this.state,this.previous,this.phi,this.current,...this.fft])b.destroy();}
}
