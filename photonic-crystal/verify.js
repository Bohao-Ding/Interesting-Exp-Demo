import {Solver} from './solver.js';
const yieldUI=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function evolve(s,time){
    while(s.time<time){s.advance(Math.min(256,Math.ceil((time-s.time)/s.dt)));await s.device.queue.onSubmittedWorkDone();await yieldUI();}
}
function energy([e,h]){let total=0;for(let i=0;i<e.length;i+=2)total+=.5*((e[i]+e[i+1])**2+h[i]**2+h[i+1]**2);return total;}
function region(s,a,x0,x1,y0,y1){
    let sum=0,count=0;for(let y=0;y<s.ny;y++)for(let x=0;x<s.nx;x++){
        const X=-16+(x+.5)*s.dx,Y=-12+(y+.5)*s.dx;
        if(X>=x0&&X<=x1&&Y>=y0&&Y<=y1){sum+=a[x+s.nx*y];count++;}
    }return sum/count;
}
export async function verify(device,k,notify){
    const report={date:new Date().toISOString(),method:'self-written TM Yee FDTD, FP32',adapter:k.adapter};
    notify('核对周期真空平面波…');
    let s=new Solver(device,k,4,0,.36,0,2);s.advance(256);let a=await s.read(),error=0,norm=0,continuum=0;
    const waveNumber=2*Math.PI*3/32,omega=2*Math.asin(s.dt/s.dx*Math.sin(waveNumber*s.dx/2))/s.dt;
    for(let y=0;y<s.ny;y++)for(let x=0;x<s.nx;x++){
        const i=x+s.nx*y,X=-16+(x+.5)*s.dx,expected=Math.cos(waveNumber*X-omega*s.time),actual=a[0][2*i]+a[0][2*i+1];
        error+=(actual-expected)**2;norm+=expected**2;continuum+=(actual-Math.cos(waveNumber*X-waveNumber*s.time))**2;
    }
    report.periodic_wave={grid:[s.nx,s.ny],steps:s.steps,Courant:s.dt/s.dx,discrete_relative_L2:Math.sqrt(error/norm),continuum_relative_L2:Math.sqrt(continuum/norm)};s.destroy();
    notify('核对吸收层中的真空脉冲…');
    s=new Solver(device,k,4,0,.36,0,1);const initial=energy(await s.read());await evolve(s,100);const remaining=energy(await s.read());
    report.absorption={grid:[s.nx,s.ny],time_ct_a:s.time,initial_energy:initial,remaining_energy:remaining,remaining_fraction:remaining/initial};s.destroy();
    const cases=[];
    for(const preset of [0,1]){
        notify(preset===0?'记录完整晶体对照…':'记录直通道缺陷导光…');
        s=new Solver(device,k,16,preset,.36);await evolve(s,180);a=await s.read();
        let finite=true,peak=0;for(let i=0;i<a[0].length;i++){finite&&=Number.isFinite(a[0][i]);peak=Math.max(peak,Math.abs(a[0][i]));}
        cases.push({preset:preset===0?'bulk':'straight',grid:[s.nx,s.ny],steps:s.steps,time_ct_a:s.time,finite,peak_split_E:peak,output_mean_Ez2:region(s,a[2],9.5,10.5,-.65,.65)});s.destroy();
    }
    report.crystal_comparison={frequency_fa_c:.36,epsilon_rod:12,radius_a:.2,averaging_cycles:3,probe_box_a:[9.5,10.5,-.65,.65],cases,defect_to_bulk_intensity_ratio:cases[1].output_mean_Ez2/cases[0].output_mean_Ez2,note:'Local electric intensity ratio, not power-normalized transmission or a calculated band diagram.'};
    return report;
}
