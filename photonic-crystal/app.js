import {Solver,createKernels} from './solver.js';
import {View} from './view.js';
import {verify} from './verify.js';
import {benchmark} from './performance.js';
const $=id=>document.getElementById(id);
let device,k,s,view,running=true,busy=false,inFlight=0,frames=0,updates=0,lastStats=performance.now(),lastSubmit=performance.now(),nextDraw=performance.now(),credit=0;
function fail(e){running=false;$('error').style.display='block';$('error').textContent=String(e.stack??e);$('status').textContent='已停止 · 请检查错误';}
function lock(value){busy=value;for(const el of document.querySelectorAll('aside input,aside select,aside button'))el.disabled=value;}
function resetStats(){
    frames=0;updates=0;lastStats=performance.now();lastSubmit=lastStats;nextDraw=lastStats;credit=0;
    $('time').textContent=s.time.toFixed(1);$('fps').textContent='—';$('rate').textContent='—';
}
function notice(){
    $('notice').textContent=s.preset===3?'点缺陷微腔：光源位于中心。关闭持续光源可观察场的逸散。':'移除或缩小介质柱形成缺陷；导光与反射由 Maxwell 方程自然演化。';
    $('cells').textContent=(s.cells/1e6).toFixed(2);
}
async function rebuild(){
    lock(true);await device.queue.onSubmittedWorkDone();const edits=s?.overrides.slice();s?.destroy();
    s=new Solver(device,k,Number($('resolution').value),Number($('preset').value),Number($('frequency').value),Number($('defect').value));
    s.source=$('source').checked;
    if(edits)s.overrides.set(edits);s.reset();view?.bind(s);notice();
    $('status').textContent=running?'GPU FDTD · 运行中':'已暂停';resetStats();lock(false);
}
async function restart(clearEdits=false){
    lock(true);await device.queue.onSubmittedWorkDone();s.preset=Number($('preset').value);s.defect=Number($('defect').value);s.frequency=Number($('frequency').value);s.source=$('source').checked;
    if(clearEdits)s.overrides.fill(-1);s.reset();view.dirty=true;notice();resetStats();lock(false);
}
function frame(){
    try{
        if(!busy&&s&&view&&inFlight<2){
            const dpr=Math.min(devicePixelRatio,1.5),resized=view.canvas.width!==Math.round(view.canvas.clientWidth*dpr)||view.canvas.height!==Math.round(view.canvas.clientHeight*dpr);
            const now=performance.now();
            if((running&&now>=nextDraw)||view.dirty||resized){
                if(running)credit+=8*Math.min(.05,(now-lastSubmit)/1000);
                const count=running?Math.min(64,Math.floor(credit/s.dt)):0,cells=s.cells,e=device.createCommandEncoder();
                credit-=count*s.dt;lastSubmit=now;nextDraw=Math.max(nextDraw+1000/120,now);
                if(count)s.advance(count,e);const completedTime=s.time;
                view.draw(e);device.queue.submit([e.finish()]);inFlight++;
                device.queue.onSubmittedWorkDone().then(()=>{
                    inFlight--;frames++;updates+=count*cells;const now=performance.now(),duration=now-lastStats;
                    if(duration>650){$('time').textContent=completedTime.toFixed(1);$('fps').textContent=(frames*1000/duration).toFixed(0);$('rate').textContent=count?(updates/duration/1000).toFixed(0):'—';frames=0;updates=0;lastStats=now;}
                }).catch(fail);
            }
        }
    }catch(e){fail(e);return;}requestAnimationFrame(frame);
}
async function capture(){
    lock(true);await device.queue.onSubmittedWorkDone();view.draw();await device.queue.onSubmittedWorkDone();
    const blob=await new Promise(resolve=>$('scene').toBlob(resolve,'image/png'));await fetch('/save/preview.png',{method:'POST',body:blob});
    $('status').textContent='图片已保存至 output/preview.png';lock(false);
}
async function check(){
    lock(true);await device.queue.onSubmittedWorkDone();
    const report=await verify(device,k,message=>{$('status').textContent=message;});
    $('report').textContent=JSON.stringify(report,null,2);await fetch('/save/validation.json',{method:'POST',body:JSON.stringify(report,null,2)});
    $('status').textContent='核对完成 · 结果已保存';view.dirty=true;resetStats();lock(false);
}
async function performanceCheck(){
    lock(true);await device.queue.onSubmittedWorkDone();
    const report=await benchmark(device,k,view,s,message=>{$('status').textContent=message;});
    $('report').textContent=JSON.stringify(report,null,2);await fetch('/save/performance.json',{method:'POST',body:JSON.stringify(report,null,2)});
    $('status').textContent='性能记录已保存';resetStats();lock(false);
}
async function main(){
    if(!navigator.gpu)throw Error('需要支持 WebGPU 的浏览器。');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('未找到 WebGPU 设备。');
    device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]});device.addEventListener('uncapturederror',e=>fail(e.error));device.lost.then(info=>fail(Error(info.message)));
    k=await createKernels(device);k.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture};await rebuild();
    view=await View.create(device,$('scene'),k,async(x,y)=>{lock(true);await device.queue.onSubmittedWorkDone();s.toggleRod(x,y);view.dirty=true;resetStats();$('notice').textContent=`晶柱 (${x}, ${y}) 已切换，从零场重新演化。`;lock(false);});view.bind(s);
    $('frequency').oninput=()=>{s.frequency=Number($('frequency').value);$('frequencyValue').textContent=s.frequency.toFixed(3);s.configure();view.dirty=true;$('notice').textContent='驱动频率已改变；当前保留切换前的波场与过渡响应。';};
    $('defect').oninput=()=>{$('defectValue').textContent=Number($('defect').value).toFixed(2);};$('defect').onchange=()=>restart().catch(fail);
    $('preset').onchange=()=>{if($('preset').value==='3'){$('frequency').value='.38';$('frequencyValue').textContent='0.380';}restart(true).catch(fail);};
    $('resolution').onchange=()=>rebuild().catch(fail);
    $('mode').onchange=()=>{view.mode=Number($('mode').value);view.dirty=true;$('legend').textContent=view.mode?'平均电场强度：暗蓝 → 橙金':'瞬时电场：蓝色负值 → 橙色正值';$('bar').style.background=view.mode?'linear-gradient(90deg,#0b1735,#2a69ad,#ffae39)':'linear-gradient(90deg,#087eff,#122433,#ff9018)';};
    $('gain').oninput=()=>{view.gain=Number($('gain').value);$('gainValue').textContent=view.gain;view.dirty=true;};
    $('source').onchange=()=>{s.source=$('source').checked;s.configure();view.dirty=true;};
    $('pause').onclick=()=>{running=!running;$('pause').textContent=running?'暂停':'继续';$('status').textContent=running?'GPU FDTD · 运行中':'已暂停';resetStats();};
    $('reset').onclick=()=>restart().catch(fail);$('home').onclick=()=>view.home();$('capture').onclick=()=>capture().catch(fail);$('verify').onclick=()=>check().catch(fail);
    $('performance').onclick=()=>performanceCheck().catch(fail);
    frame();
}
main().catch(fail);
