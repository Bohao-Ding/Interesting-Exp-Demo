"""Bounded repair of nominal control references with multiple shooting."""
import sys
import json
import math
import time
from pathlib import Path
import numpy as np
from numba import njit
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix
import controller_model as c

@njit(nogil=True)
def defects(z,initial,goal,n,h,weight):
    states=np.empty((n+1,9));states[0]=initial;states[-1]=goal
    states[1:n]=z[:9*(n-1)].reshape((n-1,9));u=z[9*(n-1):]
    out=np.empty(11*n+1)
    for i in range(n):
        s=states[i].copy();t=0.
        while t<h-1e-10:
            delay=t<c.DELAY-1e-10;span=min(.002,h-t,c.DELAY-t if delay else h-t)
            command=(u[i-1] if i else 0.) if delay else u[i]
            s=c.integrate(s,command,span);t+=span
        out[9*i:9*(i+1)]=(states[i+1]-s)*weight
        out[9*n+i]=.002*u[i];out[10*n+i]=.01*(u[i]-(u[i-1] if i else 0.))
    out[-1]=.05*u[-1]
    return out

def optimize(mask,duration,budget=90,omega=19):
    n=round(duration/.02);h=duration/n;initial=np.zeros(9);goal=c.target_state(mask)
    if mask in (5,7):old=json.loads(Path('data/initial-guesses.json').read_text(encoding='utf8'))[f'0-{mask}']
    else:
        q=np.linspace(0,1,201);path=np.zeros((201,8));shape=np.sin(2*math.pi*q)*np.sin(math.pi*q)**2
        path[:,0]=.4*shape;path[:,1]=np.gradient(path[:,0],q*duration)
        path[:,2:5]=np.outer(q*q*(3-2*q),goal[2:5]);path[:,2]+=.8*shape;path[:,4]-=.8*shape
        path[:,5:8]=np.gradient(path[:,2:5],q*duration,axis=0)
        old={'duration':duration,'states':path.tolist(),'controls':np.gradient(path[:,1],q*duration).tolist()}
    grid=np.linspace(0,1,n+1);oldgrid=np.linspace(0,1,len(old['states']));oldstates=np.array(old['states'])
    states=np.zeros((n+1,9))
    for j in range(8):states[:,j]=np.interp(grid,oldgrid,oldstates[:,j])
    scale=old['duration']/duration;states[:,1]*=scale;states[:,5:8]*=scale
    goal[2:5]=np.where(states[-1,2:5]<0,-1,1)*goal[2:5]
    u=np.interp(grid[:-1],np.linspace(0,1,len(old['controls'])),old['controls'])*scale**2
    states[:,8]=np.interp(grid,np.linspace(0,1,len(old['controls'])),old['controls'])*scale**2
    low=np.tile([-.63,-2.8,-5.97,-5.97,-5.97,-omega,-omega,-omega,-22],n-1).tolist()+[-22]*n
    high=np.tile([.63,2.8,5.97,5.97,5.97,omega,omega,omega,22],n-1).tolist()+[22]*n
    z=np.clip(np.concatenate((states[1:n].ravel(),u)),np.array(low)+1e-7,np.array(high)-1e-7)
    sparsity=lil_matrix((11*n+1,len(z)),dtype=int)
    for i in range(n):
        for j in [i-1,i]:
            if 0<=j<n-1:sparsity[9*i:9*(i+1),9*j:9*(j+1)]=1
        sparsity[9*i:9*(i+1),9*(n-1)+max(0,i-1):9*(n-1)+i+1]=1
        sparsity[9*n+i,9*(n-1)+i]=1;sparsity[10*n+i,9*(n-1)+max(0,i-1):9*(n-1)+i+1]=1
    sparsity[-1,-1]=1
    checkpoint=Path(f'validation/repair-0-{mask}.tmp.json')
    if checkpoint.exists():
        saved=json.loads(checkpoint.read_text(encoding='utf8'))
        if 'variables' in saved:
            oldn=len(saved['controls']);previous=np.vstack((initial,np.array(saved['variables'][:9*(oldn-1)]).reshape(oldn-1,9),goal))
            current=np.column_stack([np.interp(grid,np.linspace(0,1,oldn+1),previous[:,j]) for j in range(9)])
            ratio=saved['duration']/duration;current[:,1]*=ratio;current[:,5:8]*=ratio;current[:,8]*=ratio**2
            actions=np.interp(grid[:-1],np.linspace(0,1,oldn),saved['controls'])*ratio**2
            z=np.clip(np.r_[current[1:n].ravel(),actions],np.array(low)+1e-7,np.array(high)-1e-7)
    start=time.monotonic();last=z
    class Timeout(Exception):pass
    def fun(value):
        nonlocal last
        last=value
        if time.monotonic()-start>budget:raise Timeout()
        return defects(value,initial,goal,n,h,1000.)
    def callback(value):
        if np.max(np.abs(defects(value,initial,goal,n,h,1.)[:9*n]))<1e-6:raise StopIteration()
    try:
        sol=least_squares(fun,z,jac_sparsity=sparsity.tocsr(),bounds=(low,high),x_scale='jac',max_nfev=1000,
                          ftol=1e-9,xtol=1e-9,gtol=1e-7,tr_options={'atol':1e-8,'btol':1e-8},callback=callback)
        last=sol.x
    except Timeout:pass
    controls=last[9*(n-1):];ok,metrics,trace,actions=c.assess(initial,controls,duration,mask,100)
    result={'openLoopOk':bool(ok),'duration':duration,'controls':controls.tolist(),'variables':last.tolist(),'metrics':metrics,'defectMax':float(np.max(np.abs(defects(last,initial,goal,n,h,1.)[:9*n]))),'seconds':time.monotonic()-start}
    checkpoint.write_text(json.dumps(result),encoding='utf8')
    print({k:v for k,v in result.items() if k not in ('controls','variables')},flush=True)
    return result

if __name__=='__main__':optimize(int(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3]) if len(sys.argv)>3 else 90.,float(sys.argv[4]) if len(sys.argv)>4 else 19.)
