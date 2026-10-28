import {wrap} from './model.js';
function rng(seed){let x=seed>>>0||1;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
function normal(random){return Math.sqrt(-2*Math.log(Math.max(random(),1e-12)))*Math.cos(2*Math.PI*random());}
export class Signals{
    constructor(seed=7201){this.seed=seed;this.settings={hz:100,bits:12,delay:10,ideal:false,version:0};this.reset();}
    reset(){this.randomField=rng(this.seed);this.randomSensor=rng(this.seed^0x9e3779b9);this.noise=[0,0,0];this.pending=[];}
    configure(settings){this.settings={...this.settings,...settings,version:this.settings.version+1};this.pending=[];}
    force(amplitude,dt=.001){for(let i=0;i<3;i++)this.noise[i]=Math.max(-1,Math.min(1,this.noise[i]-this.noise[i]*dt/.4+Math.sqrt(2*dt/.4)*normal(this.randomField)));
        return this.noise.map(v=>v*amplitude);}
    sample(state,time){const s=this.settings,relative=[state[2],state[3]-state[2],state[4]-state[3]],q=2*Math.PI/(2**s.bits);
        const angles=relative.map(a=>s.ideal?wrap(a):wrap(Math.round((wrap(a)+.02*Math.PI/180*normal(this.randomSensor))/q)*q));
        const x=s.ideal?state[0]:Math.round((state[0]+.00002*normal(this.randomSensor))/.0001)*.0001;
        this.pending.push({deliver:time+(s.ideal?0:s.delay/1000),value:{type:'sample',t:time,x,angles,hz:s.hz,bits:s.bits,delay:s.ideal?0:s.delay,version:s.version,ideal:s.ideal}});
    }
    take(time){const out=[];while(this.pending.length&&this.pending[0].deliver<=time+1e-9)out.push(this.pending.shift().value);return out;}
}
