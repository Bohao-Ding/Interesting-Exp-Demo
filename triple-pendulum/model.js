// Angles are absolute, measured from vertically downward. State order:
// [cart x, cart velocity, theta1..3, omega1..3, motor acceleration]. SI units.
import parameters from './parameters.json' with {type:'json'};
export const L=parameters.lengths,RHO=parameters.density,M=parameters.masses,CART_MASS=parameters.cartMass,G=parameters.gravity;
export const R=M.map((m,i)=>Math.sqrt(m/(Math.PI*RHO*L[i])));
export const DAMP=parameters.damping,LIMIT=parameters.limits,MOTOR=parameters.motor,PLANNING=parameters.planning;
export const I=M.map((m,i)=>m*(L[i]*L[i]+3*R[i]*R[i])/12);
const weight=L.map((l,i)=>l*(M[i]/2+M.slice(i+1).reduce((a,b)=>a+b,0)));
const inertia=L.map((l,i)=>I[i]+l*l*(M[i]/4+M.slice(i+1).reduce((a,b)=>a+b,0)));
const coupling=L.map((l,i)=>L.map((_,j)=>i===j?inertia[i]:L[Math.min(i,j)]*L[Math.max(i,j)]*(M[Math.max(i,j)]/2+M.slice(Math.max(i,j)+1).reduce((a,b)=>a+b,0))));
export const W=weight,H=coupling;
export const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

export function solve3(a,b){
    const l00=Math.sqrt(a[0][0]), l10=a[1][0]/l00, l20=a[2][0]/l00;
    const l11=Math.sqrt(a[1][1]-l10*l10),l21=(a[2][1]-l20*l10)/l11;
    const l22=Math.sqrt(a[2][2]-l20*l20-l21*l21);
    const y0=b[0]/l00,y1=(b[1]-l10*y0)/l11,y2=(b[2]-l20*y0-l21*y1)/l22;
    const x2=y2/l22,x1=(y1-l21*x2)/l11,x0=(y0-l10*x1-l20*x2)/l00;
    return [x0,x1,x2];
}
export function geometry(state){
    const theta=state.slice(2,5),matrix=theta.map((t,i)=>theta.map((u,j)=>coupling[i][j]*Math.cos(t-u)));
    const b=theta.map((t,i)=>weight[i]*Math.cos(t));
    return {theta,matrix,b};
}
export function acceleration(state,a,forces){
    const {theta,matrix,b}=geometry(state),w=state.slice(5,8),relative=[w[0],w[1]-w[0],w[2]-w[1]];
    const joint=relative.map((v,i)=>DAMP[i]*v),damping=[joint[0]-joint[1],joint[1]-joint[2],joint[2]];
    const rhs=theta.map((t,i)=>{
        let curvature=0;for(let j=0;j<3;j++)curvature+=coupling[i][j]*Math.sin(t-theta[j])*w[j]*w[j];
        let external=.5*forces[i];for(let j=i+1;j<3;j++)external+=forces[j];
        return L[i]*Math.cos(t)*external-curvature-damping[i]-G*weight[i]*Math.sin(t)-b[i]*a;
    });
    return solve3(matrix,rhs);
}
export function derivative(s,input,f,locked=false){const a=locked?0:s[8],z=acceleration(s,a,f);return [s[1],a,s[5],s[6],s[7],...z,(input-s[8])/MOTOR.tau];}
export function rk4(state,input,forces,dt,locked=false){
    const k1=derivative(state,input,forces,locked),add=(s,k,t)=>s.map((v,i)=>v+k[i]*t);
    const k2=derivative(add(state,k1,dt/2),input,forces,locked),k3=derivative(add(state,k2,dt/2),input,forces,locked),k4=derivative(add(state,k3,dt),input,forces,locked);
    return state.map((v,i)=>v+dt*(k1[i]+2*k2[i]+2*k3[i]+k4[i])/6);
}
export function energy(state){
    const {theta,matrix,b}=geometry(state),v=state[1],w=state.slice(5,8);
    let kinetic=.5*(CART_MASS+M.reduce((a,b)=>a+b,0))*v*v,potential=0;
    for(let i=0;i<3;i++){
        kinetic+=v*b[i]*w[i];potential+=G*weight[i]*(1-Math.cos(theta[i]));
        for(let j=0;j<3;j++)kinetic+=.5*w[i]*matrix[i][j]*w[j];
    }
    return {kinetic,potential,total:kinetic+potential};
}
export function diagnostics(state,a,forces){
    const {theta,b}=geometry(state),w=state.slice(5,8),alpha=acceleration(state,a,forces);
    const centers=[],reactions=Array.from({length:3},()=>[0,0]);let ax=a,ay=0,drive=(CART_MASS+M.reduce((s,x)=>s+x,0))*a;
    for(let i=0;i<3;i++){
        const xx=Math.cos(theta[i])*alpha[i]-Math.sin(theta[i])*w[i]*w[i];
        const yy=Math.sin(theta[i])*alpha[i]+Math.cos(theta[i])*w[i]*w[i];
        centers.push([ax+L[i]*xx/2,ay+L[i]*yy/2]);ax+=L[i]*xx;ay+=L[i]*yy;
        drive+=b[i]*alpha[i]-weight[i]*Math.sin(theta[i])*w[i]*w[i]-forces[i];
    }
    for(let i=2;i>=0;i--){
        reactions[i]=[M[i]*centers[i][0]-forces[i]+(i<2?reactions[i+1][0]:0),M[i]*(centers[i][1]+G)+(i<2?reactions[i+1][1]:0)];
    }
    return {alpha,reactions,drive,energy:energy(state)};
}
export class Plant{
    constructor(){this.reset();}
    reset(){this.state=Array(9).fill(0);this.time=0;this.impacts=0;this.impactLoss=0;this.actual=0;this.command=0;this.input=0;this.inputs=[];}
    impact(){
        const before=energy(this.state).total,{matrix,b}=geometry(this.state),v=this.state[1],kick=solve3(matrix,b);
        this.state[0]=Math.sign(this.state[0])*LIMIT.x;this.state[1]=0;
        for(let i=0;i<3;i++)this.state[5+i]+=kick[i]*v;
        this.impactLoss+=before-energy(this.state).total;this.impacts++;
    }
    step(command,forces,dt=.001){
        command=Math.max(-LIMIT.a,Math.min(LIMIT.a,command));
        if(command!==this.command){this.inputs.push({t:this.time+MOTOR.delay,value:command});this.command=command;}
        const end=this.time+dt;
        while(end-this.time>1e-12){
            while(this.inputs.length&&this.inputs[0].t<=this.time+1e-10)this.input=this.inputs.shift().value;
            const s=this.state,a=s[8];
            if(Math.abs(s[0])>=LIMIT.x-1e-10&&s[1]*Math.sign(s[0])>1e-10){this.impact();continue;}
            const locked=(s[1]>=LIMIT.v-1e-10&&a>0)||(s[1]<=-LIMIT.v+1e-10&&a<0)||
                (s[0]>=LIMIT.x-1e-10&&s[1]>=-1e-10&&a>0)||(s[0]<=-LIMIT.x+1e-10&&s[1]<=1e-10&&a<0);
            let span=Math.min(end-this.time,.006/Math.max(6,...s.slice(5,8).map(Math.abs))),event=null;
            if(this.inputs.length)span=Math.min(span,this.inputs[0].t-this.time);
            if(a*this.input<0){const zero=MOTOR.tau*Math.log((a-this.input)/(-this.input));if(zero>1e-10)span=Math.min(span,zero);}
            let candidate=rk4(s,this.input,forces,span,locked);
            for(const [index,limit,kind] of [[0,LIMIT.x,'rail'],[1,LIMIT.v,'speed']]){
                if(Math.abs(candidate[index])<=limit+1e-12)continue;
                const bound=Math.sign(candidate[index])*limit,sign=Math.sign(bound);let low=0,high=span;
                for(let j=0;j<28;j++){const middle=(low+high)/2;if((rk4(s,this.input,forces,middle,locked)[index]-bound)*sign>0)high=middle;else low=middle;}
                span=(low+high)/2;candidate=rk4(s,this.input,forces,span,locked);event={kind,index,bound};
            }
            this.state=candidate;this.time+=span;this.actual=locked?0:this.state[8];
            if(event){this.state[event.index]=event.bound;if(event.kind==='rail')this.impact();}
        }
        this.time=end;
    }
}
