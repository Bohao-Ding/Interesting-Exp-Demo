import fs from 'node:fs';
import {Plant,wrap} from './model.js';
import {Signals} from './signals.js';
import {Observer,targetState,feedback} from './controller.js';
const pairs=JSON.parse(fs.readFileSync('validation/pair-plans.tmp.json','utf8'));
const gains=await(await fetch('http://127.0.0.1:8771/gains?hz=100')).json(),output=[];
for(const item of pairs){
    const {source,target,plan}=item,entry={source,target,planning:plan.ok?'candidate':'not found in 5 s',reason:plan.reason??null,planningSeconds:plan.seconds??null,planningMetrics:plan.metrics??plan.best??null};
    if(plan.ok){
        const p=new Plant(),s=new Signals(7201),o=new Observer(),goal=targetState(target);p.state=targetState(source);let command=0,start=null,maxCart=0,lastErrors=[],finite=true;
        const count=Math.ceil((plan.duration+5)*1000);
        for(let step=1;step<=count;step++){
            p.step(command,s.force(.02));if(step%10===0)s.sample(p.state,p.time);
            for(const sensor of s.take(p.time)){
                const estimate=o.update(sensor,command),now=sensor.t+sensor.delay/1000;start??=now;const t=now-start;
                if(t<plan.duration){const h=plan.duration/plan.controls.length,k=Math.min(plan.controls.length-1,Math.max(0,Math.floor(t/h))),f=Math.max(0,Math.min(1,t/h-k));
                    const ref=plan.states[k].map((v,i)=>v+(plan.states[k+1][i]-v)*f);command=feedback(estimate,ref,plan.gains[k],plan.controls[k],command,k?plan.controls[k-1]:0);
                }else command=feedback(estimate,goal,gains[String(target)].gain,0,command);
            }
            finite=p.state.every(Number.isFinite)&&Number.isFinite(command);if(!finite)break;maxCart=Math.max(maxCart,Math.abs(p.state[0]));
            if(step>count-1000&&step%10===0)lastErrors.push(Math.max(...p.state.slice(2,5).map((a,i)=>Math.abs(wrap(a-goal[2+i]))))*180/Math.PI);
        }
        entry.closedLoop={finite,impacts:p.impacts,maxCart,finalErrorDeg:p.state.slice(2,5).map((a,i)=>wrap(a-goal[2+i])*180/Math.PI),maxErrorLastSecondDeg:Math.max(...lastErrors,0)};
    }
    output.push(entry);
}
fs.writeFileSync('validation/transitions.json',JSON.stringify({sensor:'12 bit, 100 Hz, 10 ms delay',disturbanceAmplitudeN:.02,seed:7201,planningBudgetSeconds:5,results:output},null,2));
console.log(JSON.stringify({total:output.length,candidates:output.filter(r=>r.closedLoop).length,finite:output.filter(r=>r.closedLoop?.finite).length,withImpacts:output.filter(r=>r.closedLoop?.impacts>0).length}));
