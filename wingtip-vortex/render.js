const minus=(a,b)=>a.map((x,i)=>x-b[i]);
const norm=a=>{const l=Math.hypot(...a);return a.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export class View {
    static async create(device,canvas,geometry,mesh){
        const view=new View();Object.assign(view,{device,canvas,geometry,angle:-.6,elevation:.7,distance:7.3,target:[1.8,0,0],mode:0,threshold:1.2,opacity:1.6,cp:false,cut:1.,focus:true,showLines:true});
        view.context=canvas.getContext('webgpu');view.format=navigator.gpu.getPreferredCanvasFormat();view.context.configure({device,format:view.format,alphaMode:'opaque'});
        view.scene=device.createBuffer({size:128,usage:72});
        view.vertices=device.createBuffer({size:mesh.byteLength,usage:40});device.queue.writeBuffer(view.vertices,0,mesh);
        view.lines=device.createBuffer({size:192*128*16,usage:128});
        view.dummyDepth=device.createTexture({size:[1,1],format:'depth32float',usage:20});
        view.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
        const code=await(await fetch('render.wgsl')).text(),module=device.createShaderModule({code});
        const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum} ${m.message}`).join('\n'));
        view.layout=device.createBindGroupLayout({entries:[
            {binding:0,visibility:3,buffer:{type:'uniform'}},
            ...[1,2].map(binding=>({binding,visibility:2,texture:{viewDimension:'3d'}})),
            {binding:3,visibility:2,sampler:{}},{binding:4,visibility:2,texture:{sampleType:'depth'}},
            {binding:5,visibility:1,buffer:{type:'read-only-storage'}}]});
        const layout=device.createPipelineLayout({bindGroupLayouts:[view.layout]});
        const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}};
        const make=(vertex,fragment,buffers=[],extra={})=>device.createRenderPipelineAsync({layout,vertex:{module,entryPoint:vertex,buffers},fragment:{module,entryPoint:fragment,targets:[{format:view.format,...extra.target}]},primitive:extra.primitive??{topology:'triangle-list'},...extra.depth});
        view.mesh=await make('meshVertex','meshFragment',[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32'}]}],{depth:{depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}}});
        view.background=await make('screen','backdrop');
        view.volume=await make('screen','volume',[],{target:{blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:blend.alpha}}});
        view.linePipeline=await make('lineVertex','lineFragment',[],{target:{blend},primitive:{topology:'line-list'},depth:{depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less-equal'}}});
        const trace=device.createShaderModule({code:await(await fetch('trace.wgsl')).text()});
        view.tracePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:trace,entryPoint:'trace'}});
        view.traceParams=device.createBuffer({size:32,usage:72});device.queue.writeBuffer(view.traceParams,0,new Float32Array([...geometry.domain.origin,0,...geometry.domain.size,0]));
        const seeds=[];
        for(let j=0;j<64;j++){
            const y=-2.12+4.24*(j+.5)/64;const sec=geometry.sections.reduce((a,b)=>Math.abs(b.y-y)<Math.abs(a.y-y)?b:a);
            for(const z of [-.065,.065])seeds.push([sec.le-.08,y,sec.z+z,0]);
        }
        for(const sign of [-1,1])for(let j=0;j<32;j++){
            const r=.03+.12*(j%4)/3,angle=2*Math.PI*Math.floor(j/4)/8;
            seeds.push([1.9,sign*(2.12+r*Math.cos(angle)),.18+r*Math.sin(angle),0]);
        }
        view.seeds=device.createBuffer({size:seeds.length*16,usage:136});device.queue.writeBuffer(view.seeds,0,new Float32Array(seeds.flat()));
        view.controls();return view;
    }
    bind(flow){
        this.flow=flow;this.group=null;this.meshGroup=null;this.dirty=true;
        this.traceGroup=this.device.createBindGroup({layout:this.tracePipeline.getBindGroupLayout(0),entries:[this.traceParams,flow.textures[0].createView(),this.sampler,this.seeds,this.lines].map((r,binding)=>({binding,resource:[0,3,4].includes(binding)?{buffer:r}:r}))});
    }
    controls(){
        let drag=null;
        this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
        this.canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,pan:e.button===2||e.shiftKey};this.canvas.setPointerCapture(e.pointerId);});
        this.canvas.addEventListener('pointerup',()=>drag=null);
        this.canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
            this.dirty=true;
            if(drag.pan){const right=[-Math.sin(this.angle),Math.cos(this.angle),0];for(let i=0;i<3;i++)this.target[i]-=right[i]*dx*this.distance*.0015;this.target[2]+=dy*this.distance*.0015;}
            else{this.angle-=dx*.006;this.elevation=Math.max(-1.35,Math.min(1.4,this.elevation+dy*.006));}});
        this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.distance=Math.max(.35,Math.min(16,this.distance*Math.exp(e.deltaY*.001)));this.dirty=true;},{passive:false});
        this.canvas.addEventListener('dblclick',()=>this.home());
    }
    home(){Object.assign(this,{angle:-.6,elevation:.7,distance:7.3,target:[1.8,0,0],dirty:true});}
    draw(devices,querySet=null,encoder=null){
        const width=Math.round(this.canvas.clientWidth*Math.min(devicePixelRatio,1.5)),height=Math.round(this.canvas.clientHeight*Math.min(devicePixelRatio,1.5));
        if(this.canvas.width!==width||this.canvas.height!==height||!this.depth){
            this.canvas.width=width;this.canvas.height=height;this.depth?.destroy();this.depth=this.device.createTexture({size:[width,height],format:'depth32float',usage:20});this.group=null;
        }
        if(!this.group)this.group=this.device.createBindGroup({layout:this.layout,entries:[this.scene,...this.flow.textures.map(t=>t.createView()),this.sampler,this.depth.createView(),this.lines].map((r,binding)=>({binding,resource:[0,5].includes(binding)?{buffer:r}:r}))});
        if(!this.meshGroup)this.meshGroup=this.device.createBindGroup({layout:this.layout,entries:[this.scene,...this.flow.textures.map(t=>t.createView()),this.sampler,this.dummyDepth.createView(),this.lines].map((r,binding)=>({binding,resource:[0,5].includes(binding)?{buffer:r}:r}))});
        const offset=[Math.cos(this.angle)*Math.cos(this.elevation),Math.sin(this.angle)*Math.cos(this.elevation),Math.sin(this.elevation)];
        const eye=this.target.map((v,i)=>v+offset[i]*this.distance),forward=norm(minus(this.target,eye)),right=norm(cross(forward,[0,0,1])),up=cross(right,forward);
        this.device.queue.writeBuffer(this.scene,0,new Float32Array([...eye,0,...right,width/height,...up,.48,...forward,0,...this.geometry.domain.origin,this.flow.dx,...this.geometry.domain.size,0,this.mode,this.threshold,this.opacity,this.flow.time,Number(this.cp),this.cut,this.focus?1.55:0,Math.min(.55,300/this.canvas.clientWidth)]));
        const e=encoder??this.device.createCommandEncoder(),compute=e.beginComputePass(querySet?{timestampWrites:{querySet,beginningOfPassWriteIndex:6}}:{});compute.setPipeline(this.tracePipeline);compute.setBindGroup(0,this.traceGroup);compute.dispatchWorkgroups(3);compute.end();
        const color=this.context.getCurrentTexture().createView(),depth=this.depth.createView();
        const background=e.beginRenderPass({colorAttachments:[{view:color,clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]});
        background.setPipeline(this.background);background.setBindGroup(0,this.meshGroup);background.draw(3);background.end();
        const first=e.beginRenderPass({colorAttachments:[{view:color,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:depth,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
        first.setPipeline(this.mesh);first.setBindGroup(0,this.meshGroup);first.setVertexBuffer(0,this.vertices);first.draw(devices?this.geometry.mesh_vertices:this.geometry.wing_vertices);first.end();
        const bg=e.beginRenderPass({colorAttachments:[{view:color,loadOp:'load',storeOp:'store'}],...(!this.showLines&&querySet?{timestampWrites:{querySet,endOfPassWriteIndex:7}}:{})});
        bg.setPipeline(this.volume);bg.setBindGroup(0,this.group);bg.draw(3);bg.end();
        if(this.showLines){const lines=e.beginRenderPass({colorAttachments:[{view:color,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:depth,depthLoadOp:'load',depthStoreOp:'store'},...(querySet?{timestampWrites:{querySet,endOfPassWriteIndex:7}}:{})});lines.setPipeline(this.linePipeline);lines.setBindGroup(0,this.meshGroup);lines.draw(192*127*2);lines.end();}
        if(!encoder)this.device.queue.submit([e.finish()]);this.dirty=false;
    }
}
