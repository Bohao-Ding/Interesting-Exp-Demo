import {Plant,wrap} from './model.js';
import {Signals} from './signals.js';
import {Observer,targetState,feedback,releaseControl,error} from './controller.js';
const gains=await(await fetch('http://127.0.0.1:8771/gains?hz=100')).json(),results=[];
for(let mask=1;mask<8;mask++){
    const p=new Plant(),s=new Signals(7201),o=new Observer(),goal=targetState(0);p.state=targetState(mask);p.state[2]+=.003;
    let command=0,capturedAt=null,finite=true,maxCart=0;
    for(let step=1;step<=30000;step++){
        p.step(command,s.force(.02));if(step%10===0)s.sample(p.state,p.time);
        for(const sensor of s.take(p.time)){
            const estimate=o.update(sensor,command),d=error(estimate,goal),angle=Math.max(...d.slice(2,5).map(Math.abs)),omega=Math.max(...d.slice(5,8).map(Math.abs));
            if(capturedAt===null&&angle<.15&&omega<.7&&Math.abs(estimate[0])<.65&&Math.abs(estimate[1])<.5)capturedAt=p.time;
            command=capturedAt===null?(p.time<.08?1:releaseControl(estimate)):feedback(estimate,goal,gains['0'].gain,0,command);
        }
        finite=p.state.every(Number.isFinite)&&Number.isFinite(command);if(!finite)break;maxCart=Math.max(maxCart,Math.abs(p.state[0]));
    }
    results.push({source:mask,target:0,capturedAt,time:p.time,finite,impacts:p.impacts,maxCart,finalErrorDeg:p.state.slice(2,5).map(a=>wrap(a)*180/Math.PI)});
}
console.log(JSON.stringify({sensor:'12 bit, 100 Hz, 10 ms',disturbanceN:.02,seed:7201,results},null,2));
