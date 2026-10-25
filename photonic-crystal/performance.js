import {Solver} from './solver.js';
export async function benchmark(device,k,view,current,notify){
    const args=[device,k,current.ppa,current.preset,current.frequency,current.defect,0];
    const a=new Solver(...args,false),b=new Solver(...args,true);
    for(const s of [a,b]){s.overrides.set(current.overrides);s.reset();}
    const timestamp=device.features.has('timestamp-query'),queries=timestamp?device.createQuerySet({type:'timestamp',count:4}):null;
    const resolved=timestamp?device.createBuffer({size:32,usage:516}):null,readback=timestamp?device.createBuffer({size:32,usage:9}):null;
    async function trial(s,count,draw){
        view.bind(s);
        const start=performance.now(),e=device.createCommandEncoder();s.advance(count,e,queries);
        if(draw)view.draw(e,queries);
        if(queries){e.resolveQuerySet(queries,0,draw?4:2,resolved,0);e.copyBufferToBuffer(resolved,0,readback,0,draw?32:16);}
        device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();const wall_ms=performance.now()-start;
        let gpu_ms=null;
        if(queries){await readback.mapAsync(1);const ns=new BigUint64Array(readback.getMappedRange());gpu_ms={compute:Number(ns[1]-ns[0])/1e6};if(draw)gpu_ms.render=Number(ns[3]-ns[2])/1e6;readback.unmap();}
        return {wall_ms,gpu_ms};
    }
    await trial(a,16,true);await trial(b,16,true);const core=[],frames=[];
    for(const [rows,count,draw] of [[core,128,false],[frames,Math.round(.16/a.dt),true]])for(let i=0;i<3;i++){
        notify(`比较 ${draw?'渲染帧':'求解'}第 ${i+1} 组…`);
        const first=i%2===0,one=await trial(first?a:b,count,draw),two=await trial(first?b:a,count,draw);
        rows.push(first?{reference:one,optimized:two}:{reference:two,optimized:one});
    }
    const frame_steps=Math.round(.16/a.dt);
    a.advance(1024-a.steps);b.advance(1024-b.steps);
    const comparison=await difference(a,b);
    view.bind(current);a.destroy();b.destroy();
    notify('比较较长传播过程中的场值…');
    const c=new Solver(device,k,32,current.preset,current.frequency,current.defect,0,false),d=new Solver(device,k,32,current.preset,current.frequency,current.defect,0,true);
    for(const s of [c,d]){s.overrides.set(current.overrides);s.reset();s.advance(Math.ceil(180/s.dt));}
    const developed=await difference(c,d);c.destroy();d.destroy();
    const report={date:new Date().toISOString(),adapter:k.adapter,implementation:'FP32 fused H/E tile with double-buffered fields; cached coefficients and source factors',grid:[a.nx,a.ny],cells:a.cells,frequency:a.frequency,preset:a.preset,viewport:[view.canvas.width,view.canvas.height],camera:{center:view.center.slice(),zoom:view.zoom,mode:view.mode,gain:view.gain},timestamp_query:timestamp,core_steps:128,frame_steps,frame_note:'Fixed steps per submitted frame; not the wall-clock-paced UI FPS.',core,frames,comparison,developed};
    queries?.destroy();resolved?.destroy();readback?.destroy();return report;
}
async function difference(a,b){
    const A=await a.read(),B=await b.read();let maxE=0,errorE=0,normE=0,errorH=0,normH=0,errorI=0,normI=0,finite=true;
    for(let i=0;i<a.cells;i++){
        const x=A[0][2*i]+A[0][2*i+1],y=B[0][2*i]+B[0][2*i+1];maxE=Math.max(maxE,Math.abs(x-y));errorE+=(x-y)**2;normE+=x*x;
        for(let j=0;j<2;j++){const h=A[1][2*i+j],g=B[1][2*i+j];errorH+=(h-g)**2;normH+=h*h;finite&&=Number.isFinite(h+g);}
        errorI+=(A[2][i]-B[2][i])**2;normI+=A[2][i]**2;finite&&=Number.isFinite(x+y+A[2][i]+B[2][i]);
    }
    return {grid:[a.nx,a.ny],steps:a.steps,time_ct_a:a.time,finite,max_absolute_Ez_difference:maxE,relative_L2_Ez:Math.sqrt(errorE/normE),relative_L2_H:Math.sqrt(errorH/normH),relative_L2_intensity:Math.sqrt(errorI/normI)};
}
