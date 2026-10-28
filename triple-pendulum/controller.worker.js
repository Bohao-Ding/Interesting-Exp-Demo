import {Observer,targetState,error,feedback,releaseControl} from './controller.js';
let port,observer=new Observer(),gains={},hz=100,active=0,desired=0,command=0,estimate=null,now=0,trajectory=null,gainsReady=false;
let job=0,planning=false,pending=false,mode='hold',stableSince=null,bridgeSince=null,bridgeWait=null,observationVersion=null,observationStart=0,wasStable=false,failure=null,status='等待编码器',lastReport=0,retries=0,routeSteps=[],releaseStart=0,recovering=false,controlMs=0;
function label(mask){return [0,1,2].map(i=>mask&(1<<i)?'上':'下').join('');}
function setGains(rate){hz=rate;fetch(`/gains?hz=${rate}`).then(r=>r.json()).then(v=>{if(rate!==hz)return;gains=v;if(!gainsReady){gainsReady=true;postMessage({type:'ready'});status='平衡控制';}}).catch(e=>{failure=`反馈增益不可用：${e.message}`;status=failure;});}
setGains(hz);
function sendStatus(metrics){postMessage({type:'control',t:now,active,desired,status,planning,command,controlMs,estimate:estimate?.slice(),metrics,route:routeSteps.map(s=>s.target)});}
function reference(t){const h=trajectory.duration/trajectory.controls.length,k=Math.min(trajectory.controls.length-1,Math.max(0,Math.floor(t/h))),f=Math.max(0,Math.min(1,t/h-k));
    return {state:trajectory.states[k].map((v,i)=>v+(trajectory.states[k+1][i]-v)*f),control:trajectory.controls[k],previous:k?trajectory.controls[k-1]:0,gain:trajectory.gains[k]};}
function startRelease(recovery=false){trajectory=null;mode='release';recovering=recovery;releaseStart=now;stableSince=bridgeSince=bridgeWait=null;wasStable=false;if(!recovery)failure=null;if(estimate)command=releaseControl(estimate);status=recovery?'停止摆起，耗能恢复至下下下':'受控耗能，前往下下下';sendStatus();}
function nextStage(){const stage=routeSteps.shift();if(!stage)return;
    if(stage.kind==='release')startRelease();else requestPlan(stage.target,stage.seed,false);}
async function requestRoute(mask){
    const mine=++job,initial=estimate.slice();planning=true;status=`直接规划未成功，寻找中间姿态至 ${label(mask)}`;sendStatus();
    try{const response=await fetch('/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:initial,target:mask})});
        const result=await response.json();if(mine!==job)return;planning=false;
        if(!result.ok){failure=`路线搜索失败：${result.reason}`;status=failure;sendStatus();return;}
        routeSteps=result.stages;failure=null;status=`经 ${routeSteps.map(s=>label(s.target)).join(' → ')}`;sendStatus();nextStage();
    }catch(e){if(mine!==job)return;planning=false;failure=`路线搜索不可用：${e.message}`;status=failure;sendStatus();}
}
async function requestPlan(mask,seed=null,allowRoute=true){
    if(!estimate||now-observationStart<.5){pending=true;status='等待传感器和速度估计收敛';return;}
    pending=false;const mine=++job,initial=estimate.slice();planning=true;failure=null;status=`正在规划至 ${label(mask)}`;sendStatus();
    try{
        const r=await fetch('/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:initial,target:mask,seed,hz})});
        const result=await r.json();if(mine!==job)return;planning=false;
        if(!result.ok){if(allowRoute)return requestRoute(desired);failure=`中间段规划失败：${result.reason}`;status=failure;routeSteps=[];sendStatus(result.best);return;}
        const d=error(estimate,initial),angle=Math.max(...d.slice(2,5).map(Math.abs)),omega=Math.max(...d.slice(5,8).map(Math.abs));
        if(angle>.035||omega>.25||Math.abs(d[0])>.025||Math.abs(d[1])>.12||Math.abs(d[8])>1){
            if(retries++<2){status='状态已变化，重新规划';return requestPlan(mask,seed,allowRoute);}
            failure='规划结果已过期，当前状态变化过大';status=failure;routeSteps=[];sendStatus();return;
        }
        retries=0;trajectory={...result,start:now,target:mask};mode='track';stableSince=null;wasStable=false;status=`连续切换至 ${label(mask)}`;sendStatus(result.metrics);
    }catch(e){if(mine!==job)return;planning=false;failure=`规划不可用：${e.message}`;status=failure;sendStatus();}
}
function lose(reason){
    const useAlternative=active===5&&desired===5&&wasStable;
    trajectory=null;routeSteps=[];failure=reason;startRelease(true);
    if(useAlternative){desired=2;postMessage({type:'fallback',mask:2,reason:'上下上失稳，先耗能恢复再尝试下上下'});failure=null;routeSteps=[{kind:'plan',target:2}];}
}
function onSample(sample){
    const begin=performance.now();
    if(sample.version!==observationVersion){observationVersion=sample.version;observationStart=sample.t;}
    const rateChanged=sample.hz!==hz;if(rateChanged)setGains(sample.hz);estimate=observer.update(sample,command);now=sample.t+sample.delay/1000;
    if(rateChanged&&trajectory){job++;planning=false;fetch('/cancel',{method:'POST'}).catch(()=>{});startRelease();routeSteps=desired===0?[]:[{kind:'plan',target:desired}];status='采样率改变，先耗能恢复再重新规划';}
    if(!estimate.every(Number.isFinite)){observer=new Observer();estimate=null;command=0;lose('传感估计失效，等待重新捕获');
        port.postMessage({type:'command',accel:0,t:sample.t,id:sample.id});sendStatus();return;}
    if(mode==='release'){
        command=!recovering&&now-releaseStart<.08?1:releaseControl(estimate);
        const d=error(estimate,targetState(0)),angle=Math.max(...d.slice(2,5).map(Math.abs)),omega=Math.max(...d.slice(5,8).map(Math.abs));
        if(angle<.15&&omega<.7&&Math.abs(estimate[0])<.65&&Math.abs(estimate[1])<.5){active=0;mode='capture';stableSince=null;status=failure?`${failure}；已恢复至下下下`:'捕获中间姿态 下下下';}
        else if(now-releaseStart>45){failure='耗能恢复尚未完成';status=failure;}
    }
    if(trajectory){
        const t=Math.max(0,now-trajectory.start);
        if(t>=trajectory.duration){active=trajectory.target;trajectory=null;mode='capture';if(!planning)status=`捕获目标 ${label(active)}`;}
        else{const ref=reference(t),d=error(estimate,ref.state);command=feedback(estimate,ref.state,ref.gain,ref.control,command,ref.previous);
            if(Math.max(...d.slice(2,5).map(Math.abs))>.5||Math.max(...estimate.slice(5,8).map(Math.abs))>26)lose('轨迹偏离或转速过高');}
    }
    if(!trajectory&&mode!=='release'&&gains[String(active)]){
        const delta=error(estimate,targetState(active)),angle=Math.max(...delta.slice(2,5).map(Math.abs)),omega=Math.max(...delta.slice(5,8).map(Math.abs));
        if((mode==='capture'||mode==='hold')&&angle>.5)lose('偏离平衡区域');
        if(mode!=='release'){
            command=feedback(estimate,targetState(active),gains[String(active)].gain,0,command);
            if(angle<5*Math.PI/180&&omega<.5&&Math.abs(estimate[1])<.3){stableSince??=now;
                if(now-stableSince>.5&&!planning&&!failure){mode='hold';wasStable=true;status=`稳定 ${label(active)}`;
                    if(routeSteps.length){bridgeWait??=now;status=`中间姿态 ${label(active)} 收敛中`;
                        if(angle<.01&&omega<.08&&Math.abs(estimate[0])<.025&&Math.abs(estimate[1])<.04){bridgeSince??=now;if(now-bridgeSince>1){bridgeSince=bridgeWait=null;nextStage();}}
                        else bridgeSince=null;
                        if(bridgeWait!==null&&now-bridgeWait>20){failure='中间姿态未充分收敛，无法安全开始下一段';status=failure;routeSteps=[];bridgeSince=bridgeWait=null;}
                    }}}
            else{stableSince=bridgeSince=null;if(!planning&&!failure&&status.startsWith('稳定'))status=`平衡调整 ${label(active)}`;}
        }
    }
    controlMs=.9*controlMs+.1*(performance.now()-begin);port.postMessage({type:'command',accel:command,t:sample.t,id:sample.id});
    if(pending&&!planning)requestPlan(desired);
    if(now-lastReport>.05){sendStatus();lastReport=now;}
}
onmessage=e=>{
    const m=e.data;
    if(m.type==='connect'){port=m.port;port.onmessage=e=>{const d=e.data;if(d.type==='sample')onSample(d);else if(d.type==='reset'){
        observer=new Observer();active=desired=0;command=0;estimate=null;trajectory=null;planning=pending=false;mode='hold';stableSince=bridgeSince=bridgeWait=null;observationVersion=null;wasStable=false;failure=null;routeSteps=[];job++;
        fetch('/cancel',{method:'POST'}).catch(()=>{});status='等待编码器';sendStatus();}};}
    else if(m.type==='target'){
        desired=m.mask;retries=0;routeSteps=[];bridgeSince=bridgeWait=null;failure=null;
        if(desired===0&&(active!==0||trajectory||mode==='lost'||mode==='release')){job++;planning=false;fetch('/cancel',{method:'POST'}).catch(()=>{});startRelease();}
        else if(desired===active&&!trajectory&&mode==='hold'){job++;planning=pending=false;fetch('/cancel',{method:'POST'}).catch(()=>{});status=`平衡调整 ${label(active)}`;sendStatus();}
        else requestPlan(desired);
    }
};
