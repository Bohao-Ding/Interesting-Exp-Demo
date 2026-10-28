import {L,M,G,LIMIT,wrap} from './model.js';
const colors=['#70dcde','#ffc781','#f48b9d'];
const surfaces=new WeakMap();
function setup(canvas,onResize){
    if(surfaces.has(canvas))return surfaces.get(canvas);
    const surface={ctx:canvas.getContext('2d'),w:0,h:0,d:0};surfaces.set(canvas,surface);
    const resize=()=>{const d=Math.min(devicePixelRatio,2),w=canvas.clientWidth,h=canvas.clientHeight;
        if(w===surface.w&&h===surface.h&&d===surface.d)return;
        canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);surface.ctx.setTransform(d,0,0,d,0,0);Object.assign(surface,{w,h,d});onResize?.();
    };
    new ResizeObserver(resize).observe(canvas);window.addEventListener('resize',resize);resize();return surface;
}
function arrow(c,x,y,dx,dy,color){const len=Math.hypot(dx,dy);if(len<2)return;const tipx=x+dx,tipy=y+dy,a=Math.atan2(dy,dx);
    c.strokeStyle=color;c.fillStyle=color;c.lineWidth=1.5;c.beginPath();c.moveTo(x,y);c.lineTo(tipx,tipy);c.stroke();c.beginPath();c.moveTo(tipx,tipy);c.lineTo(tipx-7*Math.cos(a-.5),tipy-7*Math.sin(a-.5));c.lineTo(tipx-7*Math.cos(a+.5),tipy-7*Math.sin(a+.5));c.closePath();c.fill();}
export class View{
    constructor(canvas){this.canvas=canvas;this.zoom=1;this.pan=[0,0];this.forces=true;this.dirty=true;let drag=null;
        this.surface=setup(canvas,()=>this.dirty=true);
        canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
        canvas.addEventListener('pointermove',e=>{if(!drag)return;this.pan[0]+=e.clientX-drag[0];this.pan[1]+=e.clientY-drag[1];drag=[e.clientX,e.clientY];this.dirty=true;});
        canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
        canvas.addEventListener('wheel',e=>{e.preventDefault();const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
            const old=this.zoom;this.zoom=Math.max(.6,Math.min(8,this.zoom*Math.exp(-e.deltaY*.0014)));const ratio=this.zoom/old;
            this.pan[0]=x-rect.width/2-(x-rect.width/2-this.pan[0])*ratio;this.pan[1]=y-rect.height*.5-(y-rect.height*.5-this.pan[1])*ratio;this.dirty=true;},{passive:false});
        canvas.addEventListener('dblclick',()=>this.home());}
    home(){this.zoom=1;this.pan=[0,0];this.dirty=true;}
    draw(data){this.dirty=false;const {ctx:c,w,h}=this.surface;c.clearRect(0,0,w,h);
        if(!data)return;const state=data.state,scale=Math.min((w-120)/1.7,(h-20)/(2*L.reduce((a,b)=>a+b,0)))*this.zoom,ox=w*.5+this.pan[0],oy=h*.5+this.pan[1];
        const px=x=>ox+x*scale,py=y=>oy+y*scale;
        c.strokeStyle='#425c68';c.lineWidth=3;c.beginPath();c.moveTo(px(-LIMIT.x),oy+14);c.lineTo(px(LIMIT.x),oy+14);c.stroke();
        for(const x of [-LIMIT.x,LIMIT.x]){c.fillStyle='#6c8590';c.fillRect(px(x)-3,oy+6,6,17);}
        c.fillStyle='#283e4a';c.strokeStyle='#97b5bd';c.lineWidth=1.3;c.beginPath();c.roundRect(px(state[0])-20,oy-9,40,23,5);c.fill();c.stroke();
        let x=state[0],y=0;const segments=[];for(let i=0;i<3;i++){
            const nx=x+L[i]*Math.sin(state[2+i]),ny=y+L[i]*Math.cos(state[2+i]);segments.push({x,y,nx,ny,cx:(x+nx)/2,cy:(y+ny)/2});x=nx;y=ny;
        }
        for(const s of segments){c.lineCap='round';c.strokeStyle='#15242b';c.lineWidth=16;c.beginPath();c.moveTo(px(s.x),py(s.y));c.lineTo(px(s.nx),py(s.ny));c.stroke();}
        for(let i=0;i<3;i++){
            const s=segments[i];c.strokeStyle=colors[i];c.lineWidth=13-i*4;c.beginPath();c.moveTo(px(s.x),py(s.y));c.lineTo(px(s.nx),py(s.ny));c.stroke();
            const offset=[-32,12,35][i],cx=px(s.cx),cy=py(s.cy);c.lineWidth=1;c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+offset,cy-8);c.stroke();
            c.fillStyle=colors[i];c.font='bold 12px system-ui';c.fillText(String(i+1),cx+offset+(offset<0?-8:2),cy-8);
        }
        for(const s of segments){c.beginPath();c.arc(px(s.x),py(s.y),6,0,Math.PI*2);c.fillStyle='#d8e9e5';c.fill();c.lineWidth=2;c.strokeStyle='#283e49';c.stroke();}
        const tip=segments[2];c.beginPath();c.arc(px(tip.nx),py(tip.ny),4,0,Math.PI*2);c.fillStyle='#f8dee0';c.fill();
        if(this.forces){for(let i=0;i<3;i++){
            const s=segments[i],cx=px(s.cx),cy=py(s.cy),r=data.reactions[i];
            arrow(c,cx,cy,0,Math.min(55,M[i]*G*5),'#d7dfe4');
            arrow(c,cx,cy,Math.max(-50,Math.min(50,data.forces[i]*1800)),0,'#ffae73');
            const rx=r[0]*4,ry=-r[1]*4,n=Math.hypot(rx,ry),factor=n>60?60/n:1;arrow(c,px(s.x),py(s.y),rx*factor,ry*factor,'#65dfae');
        }}
        c.fillStyle='#71929b';c.font='10px ui-monospace,monospace';c.fillText('−0.7 m',px(-LIMIT.x)-18,oy+32);c.fillText('+0.7 m',px(LIMIT.x)-18,oy+32);
    }
}
export function drawCharts(canvas,history,amplitude){
    const {ctx:c,w,h}=setup(canvas);c.clearRect(0,0,w,h);const gap=18,pw=(w-2*gap)/3,top=28,bottom=h-23,ph=bottom-top;
    const panels=[{title:'杆角相对目标 / °',range:Math.max(2,...history.flatMap(p=>p.angles.map(v=>Math.abs(v)))),series:3},
        {title:'滑块 x / 命令 a / 实际 a',range:1,series:3},{title:'不规则外力 / N',range:Math.max(.01,amplitude),series:3}];
    panels.forEach((p,index)=>{const x0=index*(pw+gap);c.fillStyle='#9db3bb';c.font='10px system-ui';c.fillText(p.title,x0,14);
        c.strokeStyle='#30434a';c.lineWidth=1;for(let j=0;j<3;j++){let y=top+ph*j/2;c.beginPath();c.moveTo(x0,y);c.lineTo(x0+pw,y);c.stroke();}
        c.fillStyle='#6f8992';c.fillText(index===1?'±0.7 / ±22':`±${p.range.toFixed(p.range<1?2:0)}`,x0,bottom+15);
        if(history.length<2)return;const end=history[history.length-1].t,start=Math.max(0,end-20),range=Math.max(2,end-start);
        for(let j=0;j<p.series;j++){c.strokeStyle=colors[j];c.lineWidth=1.3;c.beginPath();let drawing=false,previous=null;
            for(const point of history){if(point.t<start)continue;let value=index===0?point.angles[j]/p.range:index===1?(j===0?point.x/.7:(j===1?point.command:point.actual)/22):point.forces[j]/p.range;
                if(index===0&&previous&&(Math.abs(point.angles[j]-previous.angles[j])>180||point.mask!==previous.mask))drawing=false;
                value=Math.max(-1,Math.min(1,value));const x=x0+(point.t-start)/range*pw,y=top+ph*(.5-.45*value);if(!drawing){c.moveTo(x,y);drawing=true;}else c.lineTo(x,y);previous=point;}
            c.stroke();}
    });
}
export function chartPoint(data,mask){const goal=[0,1,2].map(i=>mask&(1<<i)?Math.PI:0);return {t:data.t,mask,angles:goal.map((g,i)=>wrap(data.state[2+i]-g)*180/Math.PI),x:data.state[0],command:data.command,actual:data.actual,forces:data.forces.slice()};}
