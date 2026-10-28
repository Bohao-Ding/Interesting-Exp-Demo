import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Presentation,FrameMeter} from './presentation.js';
const display=new Presentation(),poses=[];let arrival=0;
for(let i=1;i<=1250;i++){
    const t=i*.004;arrival=Math.max(arrival+.0001,t+.002+[0,.008,.001,.004][i%4]);
    poses.push({arrival,pose:{t,impacts:0,state:[.1*t,.1,3+12*t,-3-6*t,6.2+8*t,12,-6,8,0]}});
}
let index=0,previous=-Infinity,maximumBackstep=0,angleError=0,advanced=0,total=0;
for(let frame=1;frame<=1200;frame++){
    const wall=frame/240;while(index<poses.length&&poses[index].arrival<=wall)display.push(poses[index++].pose);
    const state=display.sample(wall*1000);if(!state)continue;
    maximumBackstep=Math.max(maximumBackstep,previous-display.time);if(display.time>previous+1e-9)advanced++;
    previous=display.time;angleError=Math.max(angleError,Math.abs(state[2]-(3+12*display.time)));total++;
}
assert.equal(maximumBackstep,0);assert.ok(angleError<1e-10);
const meter=new FrameMeter();for(let i=0;i<=200;i++)meter.record(i*5,.2,i%2===0);const counted=meter.summary(1000);
assert.equal(counted.fps,200);assert.equal(counted.motionFps,100);
const result={description:'synthetic 250 Hz poses with delivery jitter and 240 Hz rendering; not a browser FPS benchmark',maximumBackstepSeconds:maximumBackstep,linearMotionInterpolationError:angleError,advancingFrames:advanced,totalFrames:total,counterCheck:{paintFps:counted.fps,motionFps:counted.motionFps}};
fs.writeFileSync('validation/presentation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
