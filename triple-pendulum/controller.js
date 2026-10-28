// Nominal equations share parameters, but this module never receives plant state or forces.
import {DAMP,G,W,H,MOTOR,LIMIT,geometry,acceleration,solve3,rk4,wrap} from './model.js';
export {wrap};
const zero=[0,0,0],N=9;
export function targetState(mask){return [0,0,...[0,1,2].map(i=>mask&(1<<i)?Math.PI:0),0,0,0,0];}
export function error(state,reference){return state.map((v,i)=>i>=2&&i<5?wrap(v-reference[i]):v-reference[i]);}
export function feedback(state,ref,k,feed=0,previous=0,referencePrevious=0){const e=error(state,ref);e.push(previous-referencePrevious);return Math.max(-LIMIT.a,Math.min(LIMIT.a,feed-k.reduce((s,v,i)=>s+v*e[i],0)));}
export function releaseControl(state){const flow=W.reduce((sum,w,i)=>sum+w*Math.cos(state[2+i])*state[5+i],0);return Math.max(-LIMIT.a,Math.min(LIMIT.a,flow-3*state[0]-2*state[1]));}

// Differentiate M(theta) alpha = rhs instead of evaluating 18 RK4 perturbations.
export function jacobian(state){
    const {theta,matrix}=geometry(state),w=state.slice(5,8),alpha=acceleration(state,state[8],zero),f=new Float64Array(N*N);
    f[1]=1;f[N+8]=1;f[8*N+8]=-1/MOTOR.tau;
    const damp=[[DAMP[0]+DAMP[1],-DAMP[1],0],[-DAMP[1],DAMP[1]+DAMP[2],-DAMP[2]],[0,-DAMP[2],DAMP[2]]];
    for(let l=0;l<3;l++){
        f[(2+l)*N+5+l]=1;const qt=[],qw=[];
        for(let i=0;i<3;i++){
            let value=i===l?-G*W[i]*Math.cos(theta[i])+W[i]*Math.sin(theta[i])*state[8]:0;
            for(let j=0;j<3;j++){const d=(i===l?1:0)-(j===l?1:0),angle=theta[i]-theta[j];value+=H[i][j]*d*(-Math.cos(angle)*w[j]*w[j]+Math.sin(angle)*alpha[j]);}
            qt.push(value);qw.push(-2*H[i][l]*Math.sin(theta[i]-theta[l])*w[l]-damp[i][l]);
        }
        const at=solve3(matrix,qt),aw=solve3(matrix,qw);for(let i=0;i<3;i++){f[(5+i)*N+2+l]=at[i];f[(5+i)*N+5+l]=aw[i];}
    }
    const aa=solve3(matrix,theta.map((t,i)=>-W[i]*Math.cos(t)));for(let i=0;i<3;i++)f[(5+i)*N+8]=aa[i];
    return f;
}
function multiply(a,b){const out=new Float64Array(N*N);for(let i=0;i<N;i++)for(let k=0;k<N;k++){const v=a[i*N+k];for(let j=0;j<N;j++)out[i*N+j]+=v*b[k*N+j];}return out;}
function transition(state,h){const f=jacobian(state),a=new Float64Array(N*N),parts=Math.ceil(h/.01),scaled=f.map(v=>v*h/parts);let power=new Float64Array(N*N);for(let i=0;i<N;i++)a[i*N+i]=power[i*N+i]=1;
    for(let n=1;n<=4;n++){power=multiply(power,scaled);for(let i=0;i<N*N;i++){power[i]/=n;a[i]+=power[i];}}let full=a;for(let i=1;i<parts;i++)full=multiply(full,a);return full;}
function advance(state,start,end,inputs){let out=state.slice(),time=start,index=0;while(index+1<inputs.length&&inputs[index+1].t<=time+1e-10)index++;
    while(time<end-1e-10){let h=Math.min(.002,end-time);if(index+1<inputs.length)h=Math.min(h,inputs[index+1].t-time);
        if(h>1e-10){out=rk4(out,inputs[index].value,zero,h);time+=h;}else index++;
        while(index+1<inputs.length&&inputs[index+1].t<=time+1e-10)index++;
    }return out;}
export class Observer{
    constructor(){this.state=null;this.p=null;this.time=0;this.delivery=null;this.inputs=[{t:-Infinity,value:0}];}
    update(sample,previousCommand){
        const {t,x,angles,bits,ideal}=sample;
        if(this.delivery!==null&&this.inputs[this.inputs.length-1].value!==previousCommand)this.inputs.push({t:this.delivery+MOTOR.delay,value:previousCommand});
        this.delivery=t+sample.delay/1000;
        if(!this.state){this.state=[x,0,angles[0],angles[0]+angles[1],angles[0]+angles[1]+angles[2],0,0,0,0];this.p=new Float64Array(N*N);
            for(let i=0;i<N;i++)this.p[i*N+i]=(i===1||i>=5)?.25:.001;this.time=t;}
        const h=t-this.time,prior=this.state;
        if(h>0){
            this.state=advance(prior,this.time,t,this.inputs);const a=transition(prior,h),ap=multiply(a,this.p),next=new Float64Array(N*N);
            for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let k=0;k<N;k++)next[i*N+j]+=ap[i*N+k]*a[j*N+k];
            for(let i=0;i<N;i++)next[i*N+i]+=i===1?1e-6:i>=5?(.35*h)**2:1e-10;this.p=next;
        }
        const rows=[[0,1],[2,1],[2,-1,3,1],[3,-1,4,1]],values=[x,...angles];
        const angularVariance=ideal?1e-12:(2*Math.PI/2**bits)**2/12+(.02*Math.PI/180)**2;
        for(let k=0;k<4;k++){
            const row=rows[k],ph=new Float64Array(N);let predicted=0;
            for(let q=0;q<row.length;q+=2){const j=row[q],sign=row[q+1];predicted+=sign*this.state[j];for(let i=0;i<N;i++)ph[i]+=this.p[i*N+j]*sign;}
            let variance=k?angularVariance:(ideal?1e-12:.0001**2/12+.00002**2);for(let q=0;q<row.length;q+=2)variance+=row[q+1]*ph[row[q]];
            const innovation=k?wrap(values[k]-predicted):values[k]-predicted;for(let i=0;i<N;i++)this.state[i]+=ph[i]/variance*innovation;
            for(let i=0;i<N;i++)for(let j=i;j<N;j++){const v=(this.p[i*N+j]+this.p[j*N+i])/2-ph[i]*ph[j]/variance;this.p[i*N+j]=this.p[j*N+i]=v;}
        }
        this.time=t;while(this.inputs.length>1&&this.inputs[1].t<t-.1)this.inputs.shift();
        return advance(this.state,t,this.delivery,this.inputs);
    }
}
