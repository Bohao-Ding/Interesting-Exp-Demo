import {Solver} from './solver.js';

export async function verify(device,k,progress){
    const n=128,eta=.003,results={grid:`${n} × ${n}`,eta};
    progress('核对周期泊松求解…');
    const poisson=new Solver(device,k,n,eta,1),e=device.createCommandEncoder(),p=e.beginComputePass();
    poisson.solve(p,poisson.groups[0]);p.end();device.queue.submit([e.finish()]);
    const phi=await poisson.read(poisson.phi);let err=0,norm=0;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
        const exact=Math.sin(2*(x+.5)*poisson.dx)*Math.sin(3*(y+.5)*poisson.dx),d=phi[x+n*y]-exact;err+=d*d;norm+=exact*exact;
    }
    results.poissonRelativeL2=Math.sqrt(err/norm);poisson.destroy();
    progress('核对磁扩散…');
    const diffusion=new Solver(device,k,n,eta,2),steps=256,encoder=device.createCommandEncoder();
    diffusion.advance(steps,encoder);device.queue.submit([encoder.finish()]);const field=await diffusion.read(diffusion.field);
    const eig=4*Math.sin(diffusion.dx)**2/diffusion.dx**2,decay=Math.exp(-eta*eig*diffusion.time);err=0;norm=0;let maxVorticity=0,finite=true;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
        const i=2*(x+n*y),exact=decay*Math.sin(2*(x+.5)*diffusion.dx),d=field[i]-exact;err+=d*d;norm+=exact*exact;
        maxVorticity=Math.max(maxVorticity,Math.abs(field[i+1]));finite&&=Number.isFinite(field[i])&&Number.isFinite(field[i+1]);
    }
    results.diffusion={steps,time:diffusion.time,relativeL2:Math.sqrt(err/norm),maxAbsVorticity:maxVorticity,finite};diffusion.destroy();
    progress('核对耦合电流片演化…');
    const sheet=new Solver(device,k,256,eta),initial=await measure(sheet);
    const target=18,stepsSheet=Math.ceil(target/sheet.dt);
    let last=initial,loss=0;
    for(let done=0;done<stepsSheet;done+=400){const batch=Math.min(400,stepsSheet-done),commands=device.createCommandEncoder();
        sheet.advance(batch,commands);device.queue.submit([commands.finish()]);
        const now=await measure(sheet);loss+=(now.time-last.time)*(last.dissipation+now.dissipation)/2;last=now;}
    const final=last,energyDrop=initial.meanMagneticEnergy+initial.meanKineticEnergy-final.meanMagneticEnergy-final.meanKineticEnergy;
    results.sheet={grid:'256 × 256',initial,final,integratedDissipation:loss,energyBalanceResidual:energyDrop-loss};sheet.destroy();
    progress('核对最大扰动强度…');
    const strong=new Solver(device,k,256,eta,0,.30);
    for(let done=0;done<stepsSheet;done+=400){const e=device.createCommandEncoder();strong.advance(Math.min(400,stepsSheet-done),e);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();}
    results.strongPerturbation={amplitude:.30,final:await measure(strong)};strong.destroy();
    progress('比较时间步与网格…');
    const coarse=new Solver(device,k,128,eta),half=new Solver(device,k,128,eta),fine=new Solver(device,k,256,eta),finer=new Solver(device,k,512,eta),finest=new Solver(device,k,1024,eta);
    half.stepScale=.5;half.configure();const stepsCompare=1024;
    for(const [s,count] of [[coarse,stepsCompare],[half,stepsCompare*2],[fine,stepsCompare*2],[finer,stepsCompare*4],[finest,stepsCompare*8]]){
        for(let done=0;done<count;done+=400){const e=device.createCommandEncoder();s.advance(Math.min(400,count-done),e);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();}
    }
    const [c,h,f,f2,f3]=await Promise.all([coarse.read(coarse.field),half.read(half.field),fine.read(fine.field),finer.read(finer.field),finest.read(finest.field)]);
    results.comparison={time:coarse.time,timeStepRelativeL2:relative(c,h),gridRelativeL2:{'128_vs_256':relativeGrid(c,f,128),'256_vs_512':relativeGrid(f,f2,256),'512_vs_1024':relativeGrid(f2,f3,512)}};
    coarse.destroy();half.destroy();fine.destroy();finer.destroy();finest.destroy();
    progress('核对高扩散率与最高网格…');
    const upper=new Solver(device,k,1024,.008,0,.30);
    for(let done=0;done<4000;done+=400){const e=device.createCommandEncoder();upper.advance(400,e);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();}
    results.highDiffusivity={grid:'1024 × 1024',eta:.008,amplitude:.30,dt:upper.dt,final:await measure(upper)};upper.destroy();
    return results;
}

function relative(a,b){let err=[0,0],norm=[0,0];for(let i=0;i<a.length;i++){const k=i%2;err[k]+=(a[i]-b[i])**2;norm[k]+=b[i]**2;}
    return {flux:Math.sqrt(err[0]/norm[0]),vorticity:Math.sqrt(err[1]/norm[1])};}
function relativeGrid(coarse,fine,n){const down=new Float32Array(coarse.length);for(let y=0;y<n;y++)for(let x=0;x<n;x++)for(let k=0;k<2;k++){
    const j=2*(x+n*y)+k;for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++)down[j]+=fine[2*((2*x+xx)+2*n*(2*y+yy))+k]/4;
}return relative(coarse,down);}

async function measure(s){
    const e=s.device.createCommandEncoder(),p=e.beginComputePass();s.solve(p,s.groups[s.currentIndex]);p.end();s.device.queue.submit([e.finish()]);
    const [field,phi]=await Promise.all([s.read(s.field),s.read(s.phi)]),n=s.n,h=s.dx;
    let magnetic=0,kinetic=0,dissipation=0,maxCurrent=0,maxVorticity=0,finite=true;
    const ix=(x,y)=>((x+n)%n)+n*((y+n)%n);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
        const i=ix(x,y),r=ix(x+1,y),l=ix(x-1,y),u=ix(x,y+1),d=ix(x,y-1);
        const ax=(field[2*r]-field[2*l])/(2*h),ay=(field[2*u]-field[2*d])/(2*h);
        const px=(phi[r]-phi[l])/(2*h),py=(phi[u]-phi[d])/(2*h),w=field[2*i+1];
        const j=-(field[2*r]+field[2*l]+field[2*u]+field[2*d]-4*field[2*i])/(h*h);
        magnetic+=field[2*i]*j/2;kinetic+=phi[i]*w/2;dissipation+=s.eta*j*j+s.nu*w*w;
        maxCurrent=Math.max(maxCurrent,Math.abs(j));maxVorticity=Math.max(maxVorticity,Math.abs(w));
        finite&&=[ax,ay,px,py,w,j].every(Number.isFinite);
    }
    const a=(x,y)=>field[2*ix(x,y)];
    return {time:s.time,finite,meanMagneticEnergy:magnetic/(n*n),meanKineticEnergy:kinetic/(n*n),dissipation:dissipation/(n*n),maxAbsCurrent:maxCurrent,maxAbsVorticity:maxVorticity,
        sheetFluxContrast:Math.abs(a(n/4,0)-a(n/4,n/4))};
}
