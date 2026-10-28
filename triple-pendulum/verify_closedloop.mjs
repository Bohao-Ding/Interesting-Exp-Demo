import {Plant,wrap} from './model.js';
import {Signals} from './signals.js';
import {Observer,targetState,feedback,error,releaseControl} from './controller.js';
async function run(mask,settings={},amplitude=.02){
    const hz=settings.hz??100,gains=await(await fetch(`http://127.0.0.1:8771/gains?hz=${hz}`)).json();
    const p=new Plant(),s=new Signals(7201),o=new Observer(),goal=targetState(mask);s.configure(settings);let command=0,maxAngle=0,maxCart=0,maxCommand=0,finite=true,lostAt=null;
    p.state=goal.slice();for(let i=0;i<3;i++)p.state[2+i]+=[.003,-.002,.001][i];
    for(let step=1;step<=20000;step++){
        p.step(command,s.force(amplitude));if(step%(1000/hz)===0)s.sample(p.state,p.time);
        for(const sample of s.take(p.time)){const estimated=o.update(sample,command);
            if(Math.max(...error(estimated,goal).slice(2,5).map(Math.abs))>.7)lostAt??=p.time;
            command=lostAt===null?feedback(estimated,goal,gains[String(mask)].gain,0,command):releaseControl(estimated);}
        finite=p.state.every(Number.isFinite)&&Number.isFinite(command);if(!finite)break;
        maxAngle=Math.max(maxAngle,...p.state.slice(2,5).map((a,i)=>Math.abs(wrap(a-goal[2+i]))));maxCart=Math.max(maxCart,Math.abs(p.state[0]));maxCommand=Math.max(maxCommand,Math.abs(command));
    }
    return {mask,settings:{hz,bits:settings.bits??12,delay:settings.delay??10,ideal:settings.ideal??false,amplitude},time:p.time,finite,lostAt,maxAngleDeg:maxAngle*180/Math.PI,maxCart,maxCommand,impacts:p.impacts,finalErrorDeg:p.state.slice(2,5).map((a,i)=>wrap(a-goal[2+i])*180/Math.PI)};
}
const normal=[];for(let mask=0;mask<8;mask++)normal.push(await run(mask));
const stress=[await run(7,{hz:50,bits:10,delay:50},.10),await run(7,{},.10)];
console.log(JSON.stringify({normal,stress},null,2));
