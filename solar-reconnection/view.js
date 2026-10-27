export class View {
    static async create(device,canvas){
        const v=new View();Object.assign(v,{device,canvas,zoom:1,center:[Math.PI,Math.PI],mode:0,gain:1,dirty:true});
        v.context=canvas.getContext('webgpu');v.format=navigator.gpu.getPreferredCanvasFormat();v.context.configure({device,format:v.format,alphaMode:'opaque'});
        v.camera=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        const module=device.createShaderModule({code:await(await fetch('render.wgsl')).text()});
        const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
        v.pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'screen'},fragment:{module,entryPoint:'color',targets:[{format:v.format}]},primitive:{topology:'triangle-list'}});
        v.controls();return v;
    }
    bind(s){this.solver=s;this.groups=s.state.map(field=>this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[s.params,field,this.camera].map((buffer,binding)=>({binding,resource:{buffer}}))}));this.dirty=true;}
    dimensions(){const w=this.canvas.clientWidth,h=this.canvas.clientHeight,panel=document.querySelector('aside').offsetWidth+46;
        return {w,h,panel,scale:Math.min((w-panel-40)/(2*Math.PI),(h-150)/(2*Math.PI))*this.zoom};}
    world(x,y){const {w,h,panel,scale}=this.dimensions();return [this.center[0]+(x-(w-panel)*.5)/scale,this.center[1]+(h*.53-y)/scale];}
    home(){this.zoom=1;this.center=[Math.PI,Math.PI];this.dirty=true;}
    controls(){let drag=null;
        this.canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};this.canvas.setPointerCapture(e.pointerId);});
        this.canvas.addEventListener('pointermove',e=>{if(!drag)return;const {scale}=this.dimensions();this.center[0]-=(e.clientX-drag.x)/scale;this.center[1]+=(e.clientY-drag.y)/scale;drag={x:e.clientX,y:e.clientY};this.dirty=true;});
        this.canvas.addEventListener('pointerup',()=>{drag=null;});this.canvas.addEventListener('pointercancel',()=>{drag=null;});
        this.canvas.addEventListener('wheel',e=>{e.preventDefault();const before=this.world(e.clientX,e.clientY);this.zoom=Math.max(.7,Math.min(20,this.zoom*Math.exp(-e.deltaY*.0015)));const after=this.world(e.clientX,e.clientY);this.center=this.center.map((v,i)=>v+before[i]-after[i]);this.dirty=true;},{passive:false});
        this.canvas.addEventListener('dblclick',()=>this.home());
    }
    draw(e){const {w,h,panel,scale}=this.dimensions(),dpr=Math.min(devicePixelRatio,1.5);
        const width=Math.round(w*dpr),height=Math.round(h*dpr);if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
        this.device.queue.writeBuffer(this.camera,0,new Float32Array([w,h,dpr,panel,...this.center,scale,this.mode,this.gain,0,0,0]));
        const p=e.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[.018,.027,.043,1]}]});
        p.setPipeline(this.pipeline);p.setBindGroup(0,this.groups[this.solver.currentIndex]);p.draw(3);p.end();this.dirty=false;
    }
}
