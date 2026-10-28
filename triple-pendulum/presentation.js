// A display clock only: it never changes the plant state or controller input.
export class Presentation{
    constructor(){this.state=new Float64Array(9);this.reset();}
    reset(time=null){this.snapshots=[];this.time=time;this.wall=null;this.delay=0;}
    push(pose){
        const previous=this.snapshots[this.snapshots.length-1];
        if(previous&&pose.t<previous.t)this.reset();
        if(previous&&pose.t===previous.t)return;
        this.snapshots.push(pose);if(this.snapshots.length>16)this.snapshots.shift();
    }
    sample(wall){
        if(!this.snapshots.length)return null;
        const newest=this.snapshots[this.snapshots.length-1],oldest=this.snapshots[0],goal=newest.t-.012;
        const dt=this.wall===null?0:Math.min(.05,(wall-this.wall)/1000);this.wall=wall;
        if(this.time===null)this.time=Math.max(oldest.t,goal);
        else this.time=Math.min(newest.t,Math.max(this.time,oldest.t,this.time+dt*Math.max(.85,Math.min(1.15,1+8*(goal-this.time)))));
        this.delay=Math.max(0,(newest.t-this.time)*1000);
        let a=oldest,b=oldest;
        for(let i=1;i<this.snapshots.length;i++){b=this.snapshots[i];if(b.t>=this.time)break;a=b;}
        const h=b.t-a.t,f=h?Math.max(0,Math.min(1,(this.time-a.t)/h)):0;
        for(let i=0;i<9;i++)this.state[i]=a.state[i]+(b.state[i]-a.state[i])*f;
        if(h&&a.impacts===b.impacts){const f2=f*f,f3=f2*f;
            for(const [p,v] of [[0,1],[2,5],[3,6],[4,7]])this.state[p]=(2*f3-3*f2+1)*a.state[p]+(f3-2*f2+f)*h*a.state[v]+(-2*f3+3*f2)*b.state[p]+(f3-f2)*h*b.state[v];
        }
        return this.state;
    }
}
export class FrameMeter{
    constructor(){this.frames=[];this.previous=null;this.start=null;}
    record(time,cost,advanced){
        this.start??=time;this.frames.push({time,cost,advanced,interval:this.previous===null?0:time-this.previous});this.previous=time;
    }
    summary(time){
        while(this.frames.length&&this.frames[0].time<time-10000)this.frames.shift();
        const recent=this.frames.filter(f=>f.time>time-1000),span=Math.max(1,Math.min(1000,time-(this.start??time))),longSpan=Math.max(1,Math.min(10000,time-(this.start??time)));
        const percentile=values=>{values.sort((a,b)=>a-b);return values[Math.max(0,Math.ceil(values.length*.95)-1)]||0;};
        return {fps:recent.length*1000/span,motionFps:recent.filter(f=>f.advanced).length*1000/span,averageFps:this.frames.length*1000/longSpan,
            frameP95:percentile(this.frames.map(f=>f.interval)),paintP95:percentile(this.frames.map(f=>f.cost)),frames:this.frames.length,seconds:longSpan/1000};
    }
}
