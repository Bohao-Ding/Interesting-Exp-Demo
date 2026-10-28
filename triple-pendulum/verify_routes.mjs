import fs from 'node:fs';
import {Plant,wrap} from './model.js';
import {Signals} from './signals.js';
import {Observer,targetState,feedback,releaseControl,error} from './controller.js';
const gains=await(await fetch('http://127.0.0.1:8771/gains?hz=100')).json(),plans={};
for(const target of [2]){
    const response=await fetch('http://127.0.0.1:8771/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:Array(9).fill(0),target})});
    plans[target]=await response.json();
}
function test(source,target){
    const p=new Plant(),s=new Signals(7201),o=new Observer();p.state=targetState(source);for(let i=0;i<3;i++)p.state[2+i]+=[.003,-.002,.001][i];
    let mode=source===0?'track':'release',command=0,origin=null,stable=null,bridge=null,stage=mode,captureTime=null,finish=null,maxCart=0,finite=true;
    const result={source,target,route:source===0?[target]:target===0?[0]:[0,target]};
    for(let step=1;step<=60000;step++){
        p.step(command,s.force(.02));if(step%10===0)s.sample(p.state,p.time);
        for(const sensor of s.take(p.time)){
            const estimate=o.update(sensor,command),now=sensor.t+sensor.delay/1000;
            if(mode==='release'){
                command=now<.08?1:releaseControl(estimate);const e=error(estimate,targetState(0));
                if(Math.max(...e.slice(2,5).map(Math.abs))<.15&&Math.max(...e.slice(5,8).map(Math.abs))<.7&&Math.abs(estimate[0])<.65&&Math.abs(estimate[1])<.5){mode='hold0';captureTime=now;stable=null;}
            }
            if(mode==='hold0'){
                const e=error(estimate,targetState(0));command=feedback(estimate,targetState(0),gains['0'].gain,0,command);
                if(Math.max(...e.slice(2,5).map(Math.abs))<5*Math.PI/180&&Math.max(...e.slice(5,8).map(Math.abs))<.5&&Math.abs(estimate[1])<.3){stable??=now;
                    if(now-stable>.5){if(target===0){finish=now;break;}
                        if(Math.max(...e.slice(2,5).map(Math.abs))<.01&&Math.max(...e.slice(5,8).map(Math.abs))<.08&&Math.abs(estimate[0])<.025&&Math.abs(estimate[1])<.04){bridge??=now;if(now-bridge>1){mode='track';origin=now;stable=null;}}
                        else bridge=null;}}
                else stable=bridge=null;
            }
            if(mode==='track'){
                origin??=now;const plan=plans[target],t=now-origin;
                if(t>=plan.duration){mode='holdTarget';stable=null;}
                else{const h=plan.duration/plan.controls.length,k=Math.min(plan.controls.length-1,Math.floor(t/h)),f=t/h-k;
                    const ref=plan.states[k].map((v,i)=>v+(plan.states[k+1][i]-v)*f);command=feedback(estimate,ref,plan.gains[k],plan.controls[k],command,k?plan.controls[k-1]:0);
                    if(Math.max(...error(estimate,ref).slice(2,5).map(Math.abs))>.8){mode='lost';stage='tracking lost';}}
            }
            if(mode==='holdTarget'){
                const goal=targetState(target),e=error(estimate,goal);command=feedback(estimate,goal,gains[String(target)].gain,0,command);
                if(Math.max(...e.slice(2,5).map(Math.abs))<5*Math.PI/180&&Math.max(...e.slice(5,8).map(Math.abs))<.5&&Math.abs(estimate[1])<.3){stable??=now;if(now-stable>.5){finish=now;break;}}
                else stable=null;
                if(Math.max(...e.slice(2,5).map(Math.abs))>.7){mode='lost';stage='capture lost';}
            }
            if(mode==='lost')command=Math.max(-22,Math.min(22,-5*estimate[1]));
        }
        finite=p.state.every(Number.isFinite)&&Number.isFinite(command);maxCart=Math.max(maxCart,Math.abs(p.state[0]));
        if(!finite||finish!==null||mode==='lost')break;
    }
    return {...result,finite,capturedIntermediateAt:captureTime,stabilizedAt:finish,stage:finish!==null?'completed':stage,impacts:p.impacts,maxCart,
        finalErrorDeg:p.state.slice(2,5).map((a,i)=>wrap(a-targetState(target)[2+i])*180/Math.PI)};
}
const results=[];for(let source=0;source<8;source++)for(let target=0;target<8;target++)if(source!==target){
    if(target===0||(target===2&&plans[target].ok))results.push(test(source,target));
    else results.push({source,target,route:null,status:'no reference route tested; online search may still find one'});
}
const result={sensor:'12 bit, 100 Hz, 10 ms',disturbanceN:.02,seed:7201,description:'reference graph survey; targets without a reference were not declared unreachable',results};
fs.writeFileSync('validation/routes.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({total:results.length,simulated:results.filter(r=>r.route).length,stabilized:results.filter(r=>r.stabilizedAt!==null&&r.stabilizedAt!==undefined).length,lost:results.filter(r=>r.stage?.includes('lost')).length}));
