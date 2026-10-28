import {Plant,energy,diagnostics,L,DAMP,derivative} from './model.js';
import {Observer,jacobian} from './controller.js';
const start=[0,.02,.23,-.18,.31,.12,-.14,.08,0];
const phases=[{duration:.8,a:.4,forces:[.02,-.015,.01]},{duration:.8,a:-.3,forces:[-.01,.02,.005]},{duration:.8,a:.1,forces:[.012,.01,-.02]}];
function power(s,a,f){const d=diagnostics(s,a,f);let velocity=s[1],p=d.drive*s[1];for(let i=0;i<3;i++){const v=L[i]*Math.cos(s[2+i])*s[5+i];p+=f[i]*(velocity+v/2);velocity+=v;}
    const relative=[s[5],s[6]-s[5],s[7]-s[6]];return p-relative.reduce((sum,v,i)=>sum+DAMP[i]*v*v,0);}
function run(dt,initial=start,program=phases){const p=new Plant();p.state=initial.slice();let work=0,peak=[0,0,0];const before=energy(p.state).total;
    for(const phase of program)for(let i=0;i<Math.round(phase.duration/dt);i++){const p0=power(p.state,p.actual,phase.forces);p.step(phase.a,phase.forces,dt);work+=(p0+power(p.state,p.actual,phase.forces))*dt/2;for(let j=0;j<3;j++)peak[j]=Math.max(peak[j],Math.abs(p.state[5+j]));}
    return {dt,state:p.state,energyChange:energy(p.state).total-before,work,energyResidual:energy(p.state).total-before-work,peakOmega:peak,impacts:p.impacts};}
const fastStart=[0,0,.3,-.4,1,8,-10,28,0],fastProgram=[{duration:2,a:0,forces:[0,0,0]}];
const impact=new Plant();impact.state=[.699,2,.2,.1,-.1,0,0,0,0];const before=energy(impact.state).total;impact.step(0,[0,0,0]);
const motor=new Plant();let motorMaxError=0;for(let i=1;i<=100;i++){motor.step(5,[0,0,0]);const expected=i<=5?0:5*(1-Math.exp(-(i*.001-.005)/.02));motorMaxError=Math.max(motorMaxError,Math.abs(motor.state[8]-expected));}
const state=[.1,.2,.3,-.4,.8,2,-3,4,1.2],f=jacobian(state);let jacobianError=0;
for(let j=0;j<9;j++){const a=state.slice(),b=state.slice(),eps=1e-5;a[j]+=eps;b[j]-=eps;const da=derivative(a,0,[0,0,0]),db=derivative(b,0,[0,0,0]);
    for(let i=0;i<9;i++){const numerical=(da[i]-db[i])/(2*eps);jacobianError=Math.max(jacobianError,Math.abs(numerical-f[i*9+j]));}}
const bench=new Plant();let t=performance.now();for(let i=0;i<20000;i++)bench.step(0,[0,0,0]);const physicsMs=performance.now()-t;
const observer=new Observer();t=performance.now();for(let i=0;i<2000;i++)observer.update({t:i*.01,x:0,angles:[0,0,0],hz:100,bits:12,ideal:false,version:0,delay:10},0);const observerMs=performance.now()-t;
console.log(JSON.stringify({start,phases,standard:run(.001),half:run(.0005),fast:{start:fastStart,phases:fastProgram,standard:run(.001,fastStart,fastProgram),half:run(.0005,fastStart,fastProgram)},impact:{state:impact.state,impacts:impact.impacts,loss:impact.impactLoss,energyChange:before-energy(impact.state).total},motorMaxError,jacobianError,benchmark:{steps:20000,physicsMs,observerSamples:2000,observerMs}},null,2));
