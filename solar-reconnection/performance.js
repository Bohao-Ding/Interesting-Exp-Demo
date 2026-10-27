import {Solver} from './solver.js';
export async function benchmark(device,k,progress){
    const results={description:'WebGPU wall time: 128 simulation steps, queue submit to completion, no rendering',grids:{}};
    for(const n of [256,512,1024]){
        progress(`性能测量：${n} × ${n}…`);
        const s=new Solver(device,k,n,.003),times=[];
        for(let trial=0;trial<4;trial++){
            const e=device.createCommandEncoder();s.advance(128,e);await device.queue.onSubmittedWorkDone();
            const start=performance.now();device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
            if(trial)times.push(performance.now()-start);
        }
        results.grids[n]={steps:128,wallMs:times,medianMs:[...times].sort((a,b)=>a-b)[1]};s.destroy();
    }
    return results;
}
