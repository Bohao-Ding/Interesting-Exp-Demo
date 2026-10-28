import fs from 'node:fs';
import {Plant,wrap} from './model.js';
import {Observer,targetState,feedback,error,releaseControl} from './controller.js';
import {Signals} from './signals.js';
const target=Number(process.argv[2]??2),candidate=process.argv.includes('--candidate');
const plan=candidate?JSON.parse(fs.readFileSync('validation/feedback-0-'+target+'.tmp.json','utf8')):await(await fetch('http://127.0.0.1:8771/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:Array(9).fill(0),target})})).json();
if(plan.ok===false){console.log(JSON.stringify(plan));process.exit(1);}
const gains=await(await fetch('http://127.0.0.1:8771/gains?hz=100')).json();
function run(ideal,amplitude,seed){
    const p=new Plant(),s=new Signals(seed),o=new Observer(),goal=targetState(target);s.configure({ideal});
    let command=0,origin=null,lost=null,peak=[0,0,0],rail=0,tracking=0,stable=null;
    for(let step=1;step<=20000;step++){
        p.step(command,s.force(amplitude));if(step%10===0)s.sample(p.state,p.time);
        for(const sample of s.take(p.time)){
            const estimate=o.update(sample,command),now=sample.t+sample.delay/1000;if(now>=1)origin??=now;const t=origin===null?-1:now-origin;
            if(t<0)command=feedback(estimate,targetState(0),gains['0'].gain,0,command);
            else if(t<plan.duration&&lost===null){
                const h=plan.duration/plan.controls.length,k=Math.min(plan.controls.length-1,Math.floor(t/h)),f=Math.min(1,Math.max(0,t/h-k));
                const ref=plan.states[k].map((v,i)=>v+(plan.states[k+1][i]-v)*f);
                command=feedback(estimate,ref,plan.gains[k],plan.controls[k],command,k?plan.controls[k-1]:0);
                const e=Math.max(...error(p.state,ref).slice(2,5).map(Math.abs));tracking=Math.max(tracking,e);if(e>.5)lost=now;
            }else{
                const e=error(estimate,goal);if(Math.max(...e.slice(2,5).map(Math.abs))>.5)lost??=now;
                command=lost===null?feedback(estimate,goal,gains[String(target)].gain,0,command):releaseControl(estimate);
                if(lost===null&&Math.max(...e.slice(2,5).map(Math.abs))<.087&&Math.max(...e.slice(5,8).map(Math.abs))<.5)stable??=now;
            }
        }
        for(let i=0;i<3;i++)peak[i]=Math.max(peak[i],Math.abs(p.state[5+i]));rail=Math.max(rail,Math.abs(p.state[0]));
        if(!p.state.every(Number.isFinite))break;
    }
    return {ideal,amplitude,seed,lostAt:lost,firstCaptureAt:stable,peakOmegaRadS:peak,railMax:rail,impacts:p.impacts,trackingErrorDeg:tracking*180/Math.PI,finalErrorDeg:p.state.slice(2,5).map((a,i)=>wrap(a-goal[2+i])*180/Math.PI)};
}
const result={target,duration:plan.duration,referenceDefectMax:plan.defectMax??plan.metrics?.localDefectMax,cases:[run(true,0,7201),run(false,.02,7201),run(false,.02,7202)]};
fs.writeFileSync('validation/transition-0-'+target+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
