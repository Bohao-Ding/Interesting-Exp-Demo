import {Plant,diagnostics} from './model.js';
import {Signals} from './signals.js';
let plant=new Plant(),port=null,running=false,last=performance.now(),debt=0,steps=0,serial=0,waiting=null;
let signals=new Signals(),forces=[0,0,0],amplitude=.02,seed=7201,lastCommandTime=0,desiredCommand=0;
let statsAt=performance.now(),statsSteps=0,computeMs=0,rate=0,cost=0;
function report(){
    const info=diagnostics(plant.state,plant.actual,forces);
    postMessage({type:'physics',motion:steps%4===0,t:plant.time,state:plant.state.slice(),forces:forces.slice(),...info,command:plant.command,actual:plant.actual,
        impacts:plant.impacts,impactLoss:plant.impactLoss,stepsPerSecond:rate,physicsMs:cost,lag:debt,commandAge:Math.max(0,plant.time-lastCommandTime)});
}
function pose(){postMessage({type:'pose',t:plant.time,state:plant.state.slice(),impacts:plant.impacts});}
function tick(){
    const begin=performance.now();forces=signals.force(amplitude,.001);plant.step(desiredCommand,forces,.001);steps++;statsSteps++;
    if(!plant.state.every(Number.isFinite)){running=false;postMessage({type:'error',message:'物理状态出现非有限值，积分已停止。'});return;}
    if(steps%(1000/signals.settings.hz)===0)signals.sample(plant.state,plant.time);
    const samples=signals.take(plant.time);
    if(samples.length){waiting=++serial;port.postMessage({...samples[0],id:waiting});}
    computeMs+=performance.now()-begin;
    const now=performance.now();if(now-statsAt>=500){rate=statsSteps*1000/(now-statsAt);cost=computeMs/Math.max(1,statsSteps);statsSteps=0;computeMs=0;statsAt=now;}
    if(steps%10===0)report();else if(steps%4===0)pose();
}
function pump(){
    const now=performance.now();if(running)debt+=(now-last)/1000;last=now;
    let count=0;while(running&&waiting===null&&debt>=.001&&count<30){tick();debt-=.001;count++;}
}
function loop(){pump();setTimeout(loop,2);}
onmessage=e=>{
    const m=e.data;
    if(m.type==='connect'){port=m.port;port.onmessage=e=>{const c=e.data;if(c.type==='command'&&c.id===waiting){desiredCommand=c.accel;lastCommandTime=c.t;waiting=null;pump();}};}
    else if(m.type==='run'){running=m.value;last=performance.now();statsAt=last;statsSteps=0;computeMs=0;}
    else if(m.type==='reset'){plant.reset();steps=0;debt=0;waiting=null;lastCommandTime=0;desiredCommand=0;signals.reset();port.postMessage({type:'reset'});report();}
    else if(m.type==='sensor')signals.configure(m.settings);
    else if(m.type==='disturbance'){amplitude=m.amplitude;if(m.seed!==seed){seed=m.seed;signals.seed=seed;signals.reset();}}
};
loop();
