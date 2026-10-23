import {Flow,kernels} from './flow.js';
import {View} from './render.js';
const $=id=>document.getElementById(id);
let flow,view,device,k,geometry,gpuInfo,running=true,busy=false,config='devices',resolution=40,frames=0,lastStats=performance.now(),totalCells=0,inFlight=0;
const yieldUI=()=>new Promise(resolve=>requestAnimationFrame(resolve));
function lock(value){busy=value;for(const el of document.querySelectorAll('select,button,#alpha'))el.disabled=value;}
function error(e){running=false;$('error').style.display='block';$('error').textContent=String(e.stack??e);$('status').textContent='计算已停止 · 请检查错误';}
async function loadFlags(resolution,config){
    const response=await fetch(`data/grid-${resolution}-${config}.bin.gz`);
    const data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return new Uint32Array(data);
}
async function rebuild(){
    lock(true);$('status').textContent='建立三维固体边界…';await device.queue.onSubmittedWorkDone();flow?.destroy();
    config=$('configuration').value;resolution=Number($('resolution').value);
    const flags=await loadFlags(resolution,config),grid=geometry.grids[`${resolution}-${config}`].dims;
    const format=$('precision').value,bytes=grid.reduce((a,b)=>a*b,1)*(format==='fp16'?40:76);
    if(bytes>device.limits.maxStorageBufferBindingSize)throw Error('该网格超出浏览器单缓冲区限制，请选择较低网格密度。');
    flow=new Flow(device,k,geometry,grid,flags,Number($('alpha').value),2000,format);flow.init();view?.bind(flow);
    $('cells').textContent=(flow.cells/1e6).toFixed(2);$('status').textContent=running?'GPU CFD · 运行中':'计算已暂停';
    $('notice').textContent=format==='fp16'?'FP16 为精度受损的实验方案；压力与气动力分析请切回 FP32。':'从均匀来流起步，尾迹会随对流时间发展。构型 / 迎角 / 网格改变后重新计算。';lock(false);
}
async function frame(){
    try{
        if(!busy&&flow&&view&&inFlight<2){
            const scale=Math.min(devicePixelRatio,1.5),resized=view.canvas.width!==Math.round(view.canvas.clientWidth*scale)||view.canvas.height!==Math.round(view.canvas.clientHeight*scale);
            if(!running&&!view.dirty&&!resized){requestAnimationFrame(frame);return;}
            const count=resolution===60?8:24,simulated=running,countCells=flow.cells,e=device.createCommandEncoder();
            if(simulated)flow.frame(count,e);
            const completedTime=flow.time;
            view.draw(config==='devices',null,e);device.queue.submit([e.finish()]);inFlight++;
            device.queue.onSubmittedWorkDone().then(()=>{
                inFlight--;if(simulated)totalCells+=count*countCells;frames++;
                const now=performance.now(),duration=now-lastStats;
                if(duration>750){
                    $('time').textContent=completedTime.toFixed(2);$('fps').textContent=(frames*1000/duration).toFixed(0);
                    $('speed').textContent=simulated?(totalCells/duration/1000).toFixed(0):'—';
                    frames=0;totalCells=0;lastStats=now;
                    if(flow.time>8)$('notice').textContent='尾迹已发展。可切换压力分布、降低显示阈值，或转到翼尖后方观察横截面。';
                }
            }).catch(error);
        }
    }catch(e){error(e);return;}
    requestAnimationFrame(frame);
}
function summarize(a,f){
    const [nx,ny,nz]=f.grid,dx=f.dx,origin=f.geometry.domain.origin,U=f.U;
    let finite=true,rhoMin=Infinity,rhoMax=-Infinity,maxSpeed=0,sumRho=0;
    for(let i=0;i<a.length;i+=4){
        if(!Number.isFinite(a[i]+a[i+1]+a[i+2]+a[i+3]))finite=false;
        rhoMin=Math.min(rhoMin,a[i+3]);rhoMax=Math.max(rhoMax,a[i+3]);sumRho+=a[i+3];maxSpeed=Math.max(maxSpeed,Math.hypot(a[i],a[i+1],a[i+2])/U);
    }
    const at=(x,y,z,j)=>a[4*(x+nx*(y+ny*z))+j];
    const x=Math.round((2.3-origin[0])/dx-.5),regions=[];
    for(const sign of [-1,1]){
        let circulation=0,maxOmega=0,core=null;
        for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++){
            const Y=origin[1]+(y+.5)*dx,Z=origin[2]+(z+.5)*dx;
            if(Math.abs(Y-sign*2.12)>.4||Math.abs(Z-.18)>.5)continue;
            const omega=(at(x,y+1,z,2)-at(x,y-1,z,2)-at(x,y,z+1,1)+at(x,y,z-1,1))/(2*dx*U);
            circulation+=omega*dx*dx;
            if(Math.abs(omega)>Math.abs(maxOmega)){maxOmega=omega;core=[Y,Z];}
        }
        regions.push({side:sign,circulation_rootChord_U:circulation,peak_omegaX_rootChord_U:maxOmega,core});
    }
    const pressure=[];
    for(const span of [-1.2,-.6,.6,1.2]){
        const sec=geometry.sections.reduce((a,b)=>Math.abs(b.y-span)<Math.abs(a.y-span)?b:a);
        const sample=z=>{const cell=[sec.x,sec.y,z].map((v,j)=>Math.round((v-origin[j])/dx-.5));return 2*(at(...cell,3)-1)/(3*U*U);};
        pressure.push({span_rootChord:sec.y,upperCp:sample(sec.z+1.5*dx),lowerCp:sample(sec.lower-1.5*dx)});
    }
    return {grid:f.grid,cells:f.cells,format:f.format,steps:f.steps,time_U_MAC:f.time,incidence_deg:f.alpha,Re_MAC:f.re,finite,rhoMin,rhoMax,meanRho:sumRho/f.cells,maxSpeed_U:maxSpeed,maxMach:maxSpeed*U*Math.sqrt(3),wakePlane_rootChord:2.3,regions,pressure};
}
async function verify(){
    lock(true);const resume=running;running=false;$('status').textContent='核对与测速 · GPU 忙碌';$('report').textContent='记录当前流场，比较基准 / 优化实现…';
    await device.queue.onSubmittedWorkDone();flow.update();
    const report={date:new Date().toISOString(),adapter:gpuInfo,configuration:config,current:summarize(await flow.read(),flow),forces:await flow.force()};
    const flags=await loadFlags(40,'devices'),grid=geometry.grids['40-devices'].dims;
    let a=new Flow(device,k,geometry,grid,flags),b=new Flow(device,k,geometry,grid,flags);a.init();b.init();
    async function batch(f,count,fast){const start=performance.now();f.advance(count,fast);await device.queue.onSubmittedWorkDone();return performance.now()-start;}
    await batch(a,16,false);await batch(b,16,true);
    const timing=[];
    for(let repeat=0;repeat<3;repeat++){
        const first=repeat%2===0?[a,false,b,true]:[b,true,a,false];
        const t1=await batch(first[0],96,first[1]),t2=await batch(first[2],96,first[3]);
        timing.push(repeat%2===0?{baseline_ms:t1,optimized_ms:t2}:{baseline_ms:t2,optimized_ms:t1});await yieldUI();
    }
    await batch(a,720,false);await batch(b,720,true);a.update();b.update();const A=await a.read(),B=await b.read();let maximum=0,square=0,velocitySquare=0;
    for(let i=0;i<A.length;i++){maximum=Math.max(maximum,Math.abs(A[i]-B[i]));square+=(A[i]-B[i])**2;if(i%4<3)velocitySquare+=((A[i]-B[i])/a.U)**2;}
    report.optimization={description:'3D 32x2x2 workgroup tiles remove integer coordinate divisions; precomputed wall links and conditional loads. Both FP32.',grid,cells:a.cells,steps:a.steps,timing,max_abs_field_difference:maximum,rms_field_difference:Math.sqrt(square/A.length),rms_velocity_difference_U:Math.sqrt(velocitySquare/(3*a.cells)),reference:summarize(A,a),optimized:summarize(B,b),referenceForce:await a.force(),optimizedForce:await b.force()};
    a.destroy();b.destroy();
    a=new Flow(device,k,geometry,grid,flags);b=new Flow(device,k,geometry,grid,flags);a.init();b.init();
    async function rendered(f,count){
        view.bind(f);const start=performance.now();
        for(let i=0;i<144;i+=count){f.advance(count,false);f.update();view.draw(true);await device.queue.onSubmittedWorkDone();}
        return performance.now()-start;
    }
    const renderTiming=[];
    // Equal 144 fluid steps, with 12 versus 36 steps between field/render updates.
    for(let repeat=0;repeat<3;repeat++){
        const pair=repeat%2===0?[a,12,b,36]:[b,36,a,12];
        const t1=await rendered(pair[0],pair[1]),t2=await rendered(pair[2],pair[3]);
        renderTiming.push(repeat%2===0?{every12_ms:t1,every36_ms:t2}:{every12_ms:t2,every36_ms:t1});
    }
    a.update();b.update();const C=await a.read(),D=await b.read();let renderDifference=0;
    for(let i=0;i<C.length;i++)renderDifference=Math.max(renderDifference,Math.abs(C[i]-D[i]));
    report.display_batching={steps:a.steps,steps_per_trial:144,viewport:[view.canvas.width,view.canvas.height],timing:renderTiming,max_abs_field_difference:renderDifference};
    view.bind(flow);a.destroy();b.destroy();
    const probeGrid=geometry.grids['20-devices'].dims;
    a=new Flow(device,k,geometry,probeGrid,new Uint32Array(probeGrid.reduce((x,y)=>x*y,1)));a.init();await batch(a,104,true);a.update();
    const uniform=await a.read();let cross=0,variation=0;
    for(let i=0;i<uniform.length;i+=4){cross=Math.max(cross,Math.abs(uniform[i+1])/a.U);variation=Math.max(variation,Math.abs(uniform[i+3]-1));}
    report.empty_domain={steps:a.steps,max_spanwise_velocity_U:cross,max_density_error:variation};a.destroy();
    a=new Flow(device,k,geometry,[32,24,24],new Uint32Array(32*24*24),0,2000,'fp32',true);a.init();await batch(a,256,true);a.update();
    const wave=await a.read();let waveError=0,waveNorm=0;
    for(let z=0;z<24;z++){const expected=.1*a.U*Math.sin(2*Math.PI*(z+.5)/24)*Math.exp(-.05*(2*Math.PI/24)**2*256);const actual=wave[4*(16+32*(12+24*z))]-a.U;waveError+=(actual-expected)**2;waveNorm+=expected**2;}
    report.shear_wave={grid:a.grid,steps:256,viscosity_lattice:.05,relative_L2:Math.sqrt(waveError/waveNorm)};a.destroy();
    $('report').textContent=JSON.stringify(report,null,2);await fetch('/save/validation.json',{method:'POST',body:JSON.stringify(report,null,2)});
    $('status').textContent='核对已保存';running=resume;lock(false);
}
async function capture(){
    const before=running;running=false;await device.queue.onSubmittedWorkDone();view.draw(config==='devices');await device.queue.onSubmittedWorkDone();
    const blob=await new Promise(resolve=>$('scene').toBlob(resolve,'image/png'));await fetch('/save/preview.png',{method:'POST',body:blob});
    $('status').textContent='图片已保存至 output/preview.png';running=before;
}
async function performanceCompare(){
    lock(true);const resume=running;running=false;
    $('status').textContent='FP32 性能比较 · 相同网格 / 步数 / 显示';
    await device.queue.onSubmittedWorkDone();
    const flags=await loadFlags(resolution,config),grid=geometry.grids[`${resolution}-${config}`].dims;
    const a=new Flow(device,k,geometry,grid,flags,flow.alpha),b=new Flow(device,k,geometry,grid,flags,flow.alpha);a.init();b.init();
    const timestamp=device.features.has('timestamp-query'),querySet=timestamp?device.createQuerySet({type:'timestamp',count:8}):null;
    const resolved=timestamp?device.createBuffer({size:64,usage:516}):null,readback=timestamp?device.createBuffer({size:64,usage:9}):null;
    async function trial(f,count,display){
        const start=performance.now(),e=device.createCommandEncoder();
        const pass=(index)=>e.beginComputePass(querySet?{timestampWrites:{querySet,beginningOfPassWriteIndex:index,endOfPassWriteIndex:index+1}}:{});
        let p=pass(0);for(let i=0;i<count;i++){f.dispatch(p,'step');f.current=1-f.current;}p.end();f.steps+=count;
        if(display){p=pass(2);f.dispatch(p,'extract');p.end();p=pass(4);f.dispatch(p,'curl');p.end();}
        device.queue.submit([e.finish()]);
        if(display){view.bind(f);view.draw(config==='devices',querySet);}
        let gpu=null;
        if(querySet){const q=device.createCommandEncoder();q.resolveQuerySet(querySet,0,display?8:2,resolved,0);q.copyBufferToBuffer(resolved,0,readback,0,display?64:16);device.queue.submit([q.finish()]);}
        await device.queue.onSubmittedWorkDone();const wall_ms=performance.now()-start;
        if(querySet){await readback.mapAsync(1);const ns=new BigUint64Array(readback.getMappedRange());gpu={step:Number(ns[1]-ns[0])/1e6};if(display)Object.assign(gpu,{extract:Number(ns[3]-ns[2])/1e6,curl:Number(ns[5]-ns[4])/1e6,render:Number(ns[7]-ns[6])/1e6});readback.unmap();}
        return {wall_ms,gpu_ms:gpu};
    }
    // Warm both pipelines, then alternate order to reduce clock/temperature bias.
    await trial(a,16,true);await trial(b,16,true);
    const core=[],display=[];
    for(const [rows,count,draw] of [[core,96,false],[display,24,true]])for(let repeat=0;repeat<3;repeat++){
        const first=repeat%2===0;const one=await trial(first?a:b,count,draw),two=await trial(first?b:a,count,draw);
        rows.push(first?{reference:one,repeat:two}:{reference:two,repeat:one});
        $('report').textContent=JSON.stringify({core,display},null,2);await yieldUI();
    }
    async function controller(f,pipelined){
        view.bind(f);let sent=0,finished=0,last;
        await yieldUI();const start=performance.now(),count=resolution===60?8:24;
        while(finished<8){
            if(sent<8&&sent-finished<(pipelined?2:1)){
                if(pipelined){const e=device.createCommandEncoder();f.frame(count,e);view.draw(config==='devices',null,e);device.queue.submit([e.finish()]);}
                else{f.advance(count,false);f.update();view.draw(config==='devices');}
                sent++;
                last=device.queue.onSubmittedWorkDone().then(()=>finished++);
                if(!pipelined)await last;
            }
            if(finished<8)await yieldUI();
        }
        await last;return performance.now()-start;
    }
    const scheduling=[];
    for(let repeat=0;repeat<3;repeat++){
        const first=repeat%2===0;
        const one=await controller(first?a:b,!first),two=await controller(first?b:a,first);
        scheduling.push(first?{serial_ms:one,pipelined_ms:two}:{serial_ms:two,pipelined_ms:one});await yieldUI();
    }
    a.advance(1024-a.steps,false);a.update();
    const final=device.createCommandEncoder();b.frame(1024-b.steps,final);device.queue.submit([final.finish()]);
    const A=await a.read(),B=await b.read();let maximum=0,velocitySquare=0;
    for(let i=0;i<A.length;i++){maximum=Math.max(maximum,Math.abs(A[i]-B[i]));if(i%4<3)velocitySquare+=((A[i]-B[i])/a.U)**2;}
    const report={date:new Date().toISOString(),adapter:gpuInfo,implementation:'FP32; fused field extraction on final step, single submission and at most two in-flight frames',grid,cells:a.cells,configuration:config,viewport:[view.canvas.width,view.canvas.height],display:{mode:view.mode,threshold:view.threshold,lines:view.showLines,focus:view.focus},timestamp_query:timestamp,core_steps_per_trial:96,display_steps_per_trial:24,core,rendered:display,scheduling:{frames_per_trial:8,steps_per_frame:resolution===60?8:24,timing:scheduling},comparison:{steps:a.steps,max_abs_field_difference:maximum,rms_velocity_difference_U:Math.sqrt(velocitySquare/(3*a.cells)),reference:summarize(A,a),pipelined:summarize(B,b),referenceForce:await a.force(),pipelinedForce:await b.force()}};
    view.bind(flow);a.destroy();b.destroy();querySet?.destroy();resolved?.destroy();readback?.destroy();
    $('report').textContent=JSON.stringify(report,null,2);await fetch('/save/performance.json',{method:'POST',body:JSON.stringify(report,null,2)});
    $('status').textContent='性能比较已保存';running=resume;frames=0;totalCells=0;lastStats=performance.now();lock(false);
}
async function main(){
    if(!navigator.gpu)throw Error('需要支持 WebGPU 的浏览器。');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('未找到 WebGPU 显卡。');
    device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[],requiredLimits:{maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize}});
    gpuInfo={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description};
    device.addEventListener('uncapturederror',e=>error(e.error));device.lost.then(info=>error(Error(info.message)));
    geometry=await(await fetch('data/geometry.json')).json();k=await kernels(device);
    await rebuild();const mesh=await(await fetch('data/mesh.bin')).arrayBuffer();view=await View.create(device,$('scene'),geometry,mesh);view.bind(flow);
    for(const id of ['configuration','resolution','precision'])$(id).onchange=()=>rebuild().catch(error);
    $('alpha').oninput=()=>{$('alphaValue').textContent=$('alpha').value+'°';};$('alpha').onchange=()=>rebuild().catch(error);
    $('mode').onchange=()=>{view.mode=Number($('mode').value);view.dirty=true;};
    $('threshold').oninput=()=>{view.threshold=Number($('threshold').value);$('thresholdValue').textContent=view.threshold.toFixed(1);view.dirty=true;};
    $('cp').onchange=()=>{view.cp=$('cp').checked;view.dirty=true;};$('lines').onchange=()=>{view.showLines=$('lines').checked;view.dirty=true;};
    $('focus').onchange=()=>{view.focus=$('focus').checked;view.dirty=true;};
    $('pause').onclick=()=>{running=!running;frames=0;totalCells=0;lastStats=performance.now();$('pause').textContent=running?'暂停':'继续';$('status').textContent=running?'GPU CFD · 运行中':'计算已暂停';};
    $('reset').onclick=()=>rebuild().catch(error);$('home').onclick=()=>view.home();
    $('top').onclick=()=>Object.assign(view,{angle:-Math.PI/2,elevation:1.4,distance:7,target:[1.7,0,0],dirty:true});
    $('wake').onclick=()=>Object.assign(view,{angle:0,elevation:.16,distance:7.5,target:[1.8,0,.05],dirty:true});
    $('verify').onclick=()=>verify().catch(error);$('capture').onclick=()=>capture().catch(error);
    $('performance').onclick=()=>performanceCompare().catch(error);
    frame();
}
main().catch(error);
