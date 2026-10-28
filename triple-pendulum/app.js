import {View,drawCharts,chartPoint} from './view.js';
import {Presentation,FrameMeter} from './presentation.js';
const $=id=>document.getElementById(id),physics=new Worker('physics.worker.js',{type:'module'}),controller=new Worker('controller.worker.js',{type:'module'}),channel=new MessageChannel();
physics.postMessage({type:'connect',port:channel.port1},[channel.port1]);controller.postMessage({type:'connect',port:channel.port2},[channel.port2]);
let running=true,data=null,visual=null,control=null,history=[],lastFPS=performance.now(),lastChart=0,lastPanel=0,lastPoint=-1,renderMs=0,motionTime=-Infinity;
const presentation=new Presentation(),meter=new FrameMeter(),performanceLog=[];
const view=new View($('scene')),names=mask=>[0,1,2].map(i=>mask&(1<<i)?'上':'下').join('');
function fail(e){$('error').style.display='block';$('error').textContent=String(e.message||e);$('status').textContent='运行出错';physics.postMessage({type:'run',value:false});running=false;}
physics.onerror=controller.onerror=fail;
physics.onmessage=e=>{
    const message=e.data;if(message.type==='error'){fail(message.message);return;}
    if(message.type==='pose'){presentation.push(message);return;}if(message.type!=='physics')return;
    if(data&&message.t<data.t){presentation.reset();history=[];lastPoint=-1;motionTime=-Infinity;}
    if(message.motion)presentation.push(message);data=message;
    visual??={};Object.assign(visual,data);visual.state=presentation.state;if(!running)view.dirty=true;
    if(data.t-lastPoint>=.049){history.push(chartPoint(data,Number($('target').value)));lastPoint=data.t;while(history.length&&history[0].t<data.t-20)history.shift();}
};
controller.onmessage=e=>{
    if(e.data.type==='ready'){physics.postMessage({type:'run',value:running});return;}
    if(e.data.type==='fallback'){$('target').value=String(e.data.mask);$('status').textContent=e.data.reason;return;}
    if(e.data.type!=='control')return;control=e.data;$('status').textContent=control.status;
    $('planner').textContent='请求 '+names(control.desired)+' · 控制参考 '+names(control.active)+' · 传感延迟 '+($('ideal').checked?0:$('delay').value)+' ms';
    if(control.route?.length)$('planner').textContent+=' · 后续 '+control.route.map(names).join(' → ');
};
function panel(){
    if(!data)return;
    for(const [id,value] of Object.entries({time:data.t.toFixed(2),rate:(running?data.stepsPerSecond:0).toFixed(0),x:data.state[0].toFixed(3),v:data.state[1].toFixed(3),
        command:data.command.toFixed(2),actual:data.actual.toFixed(2),energy:data.energy.total.toFixed(3),impacts:data.impacts,lag:(data.lag*1000).toFixed(0),
        drive:data.drive.toFixed(2),age:(data.commandAge*1000).toFixed(0),physicsCost:(data.physicsMs||0).toFixed(3),controlCost:(control?.controlMs||0).toFixed(3),renderCost:renderMs.toFixed(2),displayDelay:presentation.delay.toFixed(1)}))$(id).textContent=value;
    $('angles').textContent='杆角（向下 0°）：'+data.state.slice(2,5).map(a=>(Math.atan2(Math.sin(a),Math.cos(a))*180/Math.PI).toFixed(1)+'°').join(' / ');
    $('omega').textContent='角速度 / rad·s⁻¹：'+data.state.slice(5,8).map(a=>a.toFixed(2)).join(' / ');
    $('reaction').textContent='铰链反力：'+data.reactions.map(r=>Math.hypot(...r).toFixed(2)+' N').join(' / ');
}
function sensor(){physics.postMessage({type:'sensor',settings:{hz:Number($('hz').value),bits:Number($('bits').value),delay:Number($('delay').value),ideal:$('ideal').checked}});}
for(const id of ['hz','bits','ideal'])$(id).onchange=sensor;
$('delay').oninput=()=>{$('delayValue').textContent=$('delay').value+' ms';sensor();};
function disturbance(){physics.postMessage({type:'disturbance',amplitude:Number($('force').value),seed:Number($('seed').value)});}
$('force').oninput=()=>{$('forceValue').textContent=Number($('force').value).toFixed(3)+' N';disturbance();};$('seed').onchange=disturbance;
$('target').onchange=()=>controller.postMessage({type:'target',mask:Number($('target').value)});
$('retry').onclick=()=>controller.postMessage({type:'target',mask:Number($('target').value)});
$('vectors').onchange=()=>{view.forces=$('vectors').checked;view.dirty=true;};
$('pause').onclick=()=>{running=!running;physics.postMessage({type:'run',value:running});$('pause').textContent=running?'暂停':'继续';presentation.reset(data?.t??null);if(data)presentation.push(data);view.dirty=true;};
$('reset').onclick=()=>{history=[];presentation.reset();lastPoint=-1;motionTime=-Infinity;data=visual=null;view.dirty=true;$('target').value='0';physics.postMessage({type:'reset'});};$('home').onclick=()=>view.home();
function frame(time){
    try{
        if(running||view.dirty){const begin=performance.now(),state=running?presentation.sample(time):data?.state;
            if(visual&&state){visual.state=state;view.draw(visual);const cost=performance.now()-begin,advanced=running&&presentation.time>motionTime+1e-9;
                meter.record(time,cost,advanced);if(advanced)motionTime=presentation.time;renderMs=.9*renderMs+.1*cost;
            }else view.draw(null);
        }
        if(time-lastChart>=100){drawCharts($('charts'),history,Number($('force').value));lastChart=time;}
        if(time-lastPanel>=100){panel();lastPanel=time;}
        if(time-lastFPS>=1000){const stats=meter.summary(time);$('fps').textContent=stats.fps.toFixed(0);$('motionFps').textContent=stats.motionFps.toFixed(0);
            $('averageFps').textContent=stats.averageFps.toFixed(0);$('frameP95').textContent=stats.frameP95.toFixed(2);$('paintP95').textContent=stats.paintP95.toFixed(2);
            performanceLog.push({...stats,running,wall:time/1000,t:data?.t,physicsRate:data?.stepsPerSecond,lagMs:(data?.lag||0)*1000,displayDelay:presentation.delay,impacts:data?.impacts,omegaMax:data?Math.max(...data.state.slice(5,8).map(Math.abs)):0,status:control?.status});
            if(performanceLog.length>60)performanceLog.shift();
            $('fps').dataset.report=JSON.stringify({viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,canvasWidth:$('scene').width,canvasHeight:$('scene').height},samples:performanceLog});lastFPS=time;
        }
        requestAnimationFrame(frame);
    }catch(e){fail(e);}
}
requestAnimationFrame(frame);
window.addEventListener('pagehide',()=>{physics.terminate();controller.terminate();});
