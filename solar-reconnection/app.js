import {Solver,createKernels} from './solver.js';
import {View} from './view.js';
import {verify} from './verify.js';
import {benchmark} from './performance.js';
const $=id=>document.getElementById(id);
let device,k,s,view,running=true,busy=false,inFlight=0,frames=0,advanced=0,lastStats=performance.now();
function fail(e){running=false;$('error').style.display='block';$('error').textContent=String(e.stack??e);$('status').textContent='已停止 · 请检查错误';}
function lock(value){busy=value;for(const el of document.querySelectorAll('aside input,aside select,aside button'))el.disabled=value;}
function resetStats(){frames=0;advanced=0;lastStats=performance.now();$('time').textContent=s.time.toFixed(2);$('fps').textContent='—';$('rate').textContent='—';}
async function rebuild(){lock(true);await device.queue.onSubmittedWorkDone();s?.destroy();s=new Solver(device,k,Number($('resolution').value),Number($('eta').value),0,Number($('amplitude').value));view.bind(s);
    $('cells').textContent=(s.n*s.n/1e6).toFixed(2);$('status').textContent=running?'GPU MHD · 运行中':'已暂停';resetStats();lock(false);}
function frame(){
    try{if(!busy&&s&&view&&inFlight<1){
        const dpr=Math.min(devicePixelRatio,1.5),resized=view.canvas.width!==Math.round(view.canvas.clientWidth*dpr)||view.canvas.height!==Math.round(view.canvas.clientHeight*dpr);
        if(running||view.dirty||resized){
            const count=running?Number($('steps').value):0,e=device.createCommandEncoder();if(count)s.advance(count,e);const t=s.time;
            view.draw(e);device.queue.submit([e.finish()]);inFlight++;
            device.queue.onSubmittedWorkDone().then(()=>{inFlight--;frames++;advanced+=count*s.dt;const now=performance.now(),duration=now-lastStats;
                if(duration>700){$('time').textContent=t.toFixed(2);$('fps').textContent=running?(frames*1000/duration).toFixed(0):'—';$('rate').textContent=running?(advanced*1000/duration).toFixed(2):'—';frames=0;advanced=0;lastStats=now;}
            }).catch(fail);
        }
    }}catch(e){fail(e);return;}requestAnimationFrame(frame);
}
async function check(){lock(true);await device.queue.onSubmittedWorkDone();const result=await verify(device,k,text=>{$('status').textContent=text;});
    $('report').textContent=JSON.stringify(result,null,2);$('status').textContent='核对完成';view.dirty=true;resetStats();lock(false);}
async function measurePerformance(){lock(true);await device.queue.onSubmittedWorkDone();const result=await benchmark(device,k,text=>{$('status').textContent=text;});
    $('report').textContent=JSON.stringify(result,null,2);$('status').textContent='性能测量完成';view.dirty=true;resetStats();lock(false);}
async function main(){
    if(!navigator.gpu)throw Error('需要支持 WebGPU 的浏览器。');const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw Error('未找到 WebGPU 设备。');device=await adapter.requestDevice();device.addEventListener('uncapturederror',e=>fail(e.error));
    device.lost.then(info=>fail(Error(info.message)));k=await createKernels(device);view=await View.create(device,$('scene'));await rebuild();
    $('resolution').onchange=()=>rebuild().catch(fail);
    $('eta').oninput=()=>{s.eta=Number($('eta').value);$('etaValue').textContent=s.eta.toFixed(4);s.configure();s.needsEuler=true;view.dirty=true;};
    $('amplitude').oninput=()=>{$('amplitudeValue').textContent=Number($('amplitude').value).toFixed(2);};
    $('amplitude').onchange=()=>{s.amplitude=Number($('amplitude').value);s.configure();s.reset();view.dirty=true;resetStats();};
    $('mode').onchange=()=>{view.mode=Number($('mode').value);view.dirty=true;$('legend').textContent=['欧姆耗散代理 ηj²：暗 → 亮','电流密度 j：蓝负 → 橙正','流体涡量 ω：蓝负 → 橙正','磁场强度 |B|：暗 → 亮'][view.mode];
        $('bar').style.background=view.mode===1||view.mode===2?'linear-gradient(90deg,#1773ef,#101a2c,#fa7833)':'linear-gradient(90deg,#0c1830,#66335f,#e7733d,#ffe8aa)';};
    $('gain').oninput=()=>{view.gain=Number($('gain').value);$('gainValue').textContent=view.gain.toFixed(1);view.dirty=true;};
    $('steps').oninput=()=>{$('stepsValue').textContent=$('steps').value;};
    $('pause').onclick=()=>{running=!running;$('pause').textContent=running?'暂停':'继续';$('status').textContent=running?'GPU MHD · 运行中':'已暂停';resetStats();};
    $('reset').onclick=()=>{s.reset();view.dirty=true;resetStats();};$('home').onclick=()=>view.home();$('verify').onclick=()=>check().catch(fail);
    $('benchmark').onclick=()=>measurePerformance().catch(fail);
    frame();
}
main().catch(fail);
