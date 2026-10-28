import fs from 'node:fs';
import {Worker,MessageChannel} from 'node:worker_threads';
const shim=`const {parentPort,workerData}=require('node:worker_threads');
global.onmessage=null;global.postMessage=v=>parentPort.postMessage(v);
const fetchOriginal=global.fetch;global.fetch=(url,init)=>fetchOriginal(new URL(url,workerData.base),init);
const loaded=import(workerData.module);
parentPort.on('message',async m=>{await loaded;if(workerData.delay&&m.type==='connect'){const real=m.port;m.port={postMessage:v=>real.postMessage(v),set onmessage(fn){real.onmessage=e=>setTimeout(()=>fn(e),workerData.delay);}};}global.onmessage({data:m});});`;
async function run(delay){
    const physics=new Worker(shim,{eval:true,workerData:{module:new URL('./physics.worker.js',import.meta.url).href}});
    const controller=new Worker(shim,{eval:true,workerData:{module:new URL('./controller.worker.js',import.meta.url).href,base:'http://127.0.0.1:8771',delay}});
    const channel=new MessageChannel();let start=0;
    const result=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('worker timing run did not finish')),15000);
        physics.on('error',reject);controller.on('error',reject);
        controller.on('message',m=>{if(m.type==='ready'){start=performance.now();physics.postMessage({type:'run',value:true});}});
        physics.on('message',m=>{if(m.type==='error')reject(Error(m.message));if(m.type==='physics'&&m.t>=2-1e-9){clearTimeout(timeout);resolve({injectedWallDelayMs:delay,simulationSeconds:m.t,wallSeconds:(performance.now()-start)/1000,state:m.state,lagSeconds:m.lag,stepsPerSecond:m.stepsPerSecond});}});
        physics.postMessage({type:'connect',port:channel.port1},[channel.port1]);controller.postMessage({type:'connect',port:channel.port2},[channel.port2]);
    }).finally(async()=>{await physics.terminate();await controller.terminate();});
    return result;
}
const normal=await run(0),delayed=await run(20),difference=Math.max(...normal.state.map((v,i)=>Math.abs(v-delayed.state[i])));
const result={normal,delayed,maxStateDifference:difference};fs.writeFileSync('validation/timing.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
