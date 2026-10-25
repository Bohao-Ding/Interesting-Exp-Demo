export class View {
    static async create(device,canvas,k,onEdit){
        const v=new View();Object.assign(v,{device,canvas,onEdit,zoom:1,center:[0,0],mode:0,gain:20,dirty:true});
        v.context=canvas.getContext('webgpu');v.format=navigator.gpu.getPreferredCanvasFormat();v.context.configure({device,format:v.format,alphaMode:'opaque'});
        v.camera=device.createBuffer({size:48,usage:72});
        const module=device.createShaderModule({code:k.common+await(await fetch('render.wgsl')).text()});
        const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
        if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
        v.pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'screen'},fragment:{module,entryPoint:'color',targets:[{format:v.format}]},primitive:{topology:'triangle-list'}});
        v.controls();return v;
    }
    bind(s){this.solver=s;this.groups=(s.optimized?s.state:[s.electric]).map(field=>this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[s.params,field,s.intensity,s.edits,this.camera].map((buffer,binding)=>({binding,resource:{buffer}}))}));this.dirty=true;}
    dimensions(){
        const w=this.canvas.clientWidth,h=this.canvas.clientHeight,panel=document.querySelector('aside').offsetWidth+46;
        return {w,h,panel,scale:Math.min((w-panel-36)/32,(h-160)/24)*this.zoom};
    }
    world(x,y){const {w,h,panel,scale}=this.dimensions();return [this.center[0]+(x-(w-panel)*.5)/scale,this.center[1]+(h*.55-y)/scale];}
    home(){this.zoom=1;this.center=[0,0];this.dirty=true;}
    controls(){
        let drag=null;
        this.canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};this.canvas.setPointerCapture(e.pointerId);});
        this.canvas.addEventListener('pointermove',e=>{if(!drag)return;const {scale}=this.dimensions();this.center[0]-=(e.clientX-drag.x)/scale;this.center[1]+=(e.clientY-drag.y)/scale;drag.x=e.clientX;drag.y=e.clientY;this.dirty=true;});
        this.canvas.addEventListener('pointerup',e=>{
            if(drag&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<4&&document.getElementById('edit').checked){
                const q=this.world(e.clientX,e.clientY),x=Math.round(q[0]),y=Math.round(q[1]);
                if(Math.abs(x)<=12&&Math.abs(y)<=8&&Math.hypot(q[0]-x,q[1]-y)<.45)this.onEdit(x,y);
            }drag=null;
        });
        this.canvas.addEventListener('wheel',e=>{e.preventDefault();const before=this.world(e.clientX,e.clientY);this.zoom=Math.max(.7,Math.min(20,this.zoom*Math.exp(-e.deltaY*.0015)));const after=this.world(e.clientX,e.clientY);this.center=this.center.map((v,i)=>v+before[i]-after[i]);this.dirty=true;},{passive:false});
        this.canvas.addEventListener('dblclick',()=>this.home());
    }
    draw(encoder=null,querySet=null){
        const {w,h,panel,scale}=this.dimensions(),dpr=Math.min(devicePixelRatio,1.5);
        const width=Math.round(w*dpr),height=Math.round(h*dpr);
        if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
        this.device.queue.writeBuffer(this.camera,0,new Float32Array([w,h,dpr,panel,...this.center,scale,this.mode,this.gain,0,0,0]));
        const e=encoder??this.device.createCommandEncoder(),p=e.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[.018,.028,.046,1]}],...(querySet?{timestampWrites:{querySet,beginningOfPassWriteIndex:2,endOfPassWriteIndex:3}}:{})});
        p.setPipeline(this.pipeline);p.setBindGroup(0,this.groups[this.solver.optimized?this.solver.current:0]);p.draw(3);p.end();if(!encoder)this.device.queue.submit([e.finish()]);this.dirty=false;
    }
}
