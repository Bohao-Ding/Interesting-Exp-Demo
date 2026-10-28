"""Nominal model and bounded trajectory search. No plant truth is read here."""
import json
import math
import time
from pathlib import Path
import numpy as np
from numba import njit
from scipy.linalg import expm, solve_discrete_are
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parent
PARAM = json.loads((ROOT/'parameters.json').read_text(encoding='utf8'))
L = np.array(PARAM['lengths']); M = np.array(PARAM['masses']); D = np.array(PARAM['damping'])
TAU = PARAM['motor']['tau']; DELAY = PARAM['motor']['delay']; G = PARAM['gravity']
OMEGA = PARAM['planning']['omega']; RELATIVE_OMEGA = PARAM['planning']['relativeOmega']
W = np.array([L[i]*(M[i]/2+sum(M[i+1:])) for i in range(3)])
R = np.sqrt(M/(math.pi*PARAM['density']*L)); I = M*(L*L+3*R*R)/12
H = np.zeros((3,3))
for i in range(3):
    H[i,i] = I[i]+L[i]**2*(M[i]/4+sum(M[i+1:]))
    for j in range(i+1,3):
        H[i,j]=H[j,i]=L[i]*L[j]*(M[j]/2+sum(M[j+1:]))

@njit(nogil=True)
def solve3(a,b):
    l00=math.sqrt(a[0,0]);l10=a[1,0]/l00;l20=a[2,0]/l00
    l11=math.sqrt(a[1,1]-l10*l10);l21=(a[2,1]-l20*l10)/l11;l22=math.sqrt(a[2,2]-l20*l20-l21*l21)
    y0=b[0]/l00;y1=(b[1]-l10*y0)/l11;y2=(b[2]-l20*y0-l21*y1)/l22
    x2=y2/l22;x1=(y1-l21*x2)/l11
    return np.array([(y0-l10*x1-l20*x2)/l00,x1,x2])

@njit(nogil=True)
def derivative(s,command):
    theta=s[2:5];w=s[5:8];matrix=np.empty((3,3));rhs=np.empty(3)
    damping=np.array([D[0]*w[0]-D[1]*(w[1]-w[0]),D[1]*(w[1]-w[0])-D[2]*(w[2]-w[1]),D[2]*(w[2]-w[1])])
    for i in range(3):
        curvature=0.
        for j in range(3):
            angle=theta[i]-theta[j];matrix[i,j]=H[i,j]*math.cos(angle);curvature+=H[i,j]*math.sin(angle)*w[j]*w[j]
        rhs[i]=-curvature-damping[i]-G*W[i]*math.sin(theta[i])-W[i]*math.cos(theta[i])*s[8]
    alpha=solve3(matrix,rhs)
    return np.array([s[1],s[8],w[0],w[1],w[2],alpha[0],alpha[1],alpha[2],(command-s[8])/TAU])

@njit(nogil=True)
def integrate(s,command,h):
    k1=derivative(s,command);k2=derivative(s+h*k1/2,command);k3=derivative(s+h*k2/2,command);k4=derivative(s+h*k3,command)
    return s+h*(k1+2*k2+2*k3+k4)/6

@njit(nogil=True)
def command_at(controls,duration,t):
    return controls[min(len(controls)-1,max(0,int(t*len(controls)/duration+1.e-9)))]

@njit(nogil=True)
def segment(s,controls,duration,start,end,hz,max_step):
    t=start
    while t<end-1.e-10:
        delayed=t-DELAY
        k=math.floor((delayed+1.e-9)*hz)
        boundary=(k+1)/hz+DELAY
        h=min(max_step,end-t,boundary-t)
        if h<1.e-10:h=min(max_step,end-t)
        u=0. if k<0 else command_at(controls,duration,k/hz)
        s=integrate(s,u,h);t+=h
    return s

@njit(nogil=True)
def rollout(initial,controls,duration,hz=100):
    n=len(controls);states=np.empty((n+1,9));states[0]=initial;s=initial.copy()
    for i in range(n):
        s=segment(s,controls,duration,i*duration/n,(i+1)*duration/n,hz,.002);states[i+1]=s
    return states

@njit(nogil=True)
def fine_trace(initial,controls,duration,hz=100):
    n=int(round(duration*hz));states=np.empty((n+1,9));actions=np.empty(n);states[0]=initial;s=initial.copy()
    for i in range(n):
        actions[i]=command_at(controls,duration,i/hz)
        s=segment(s,controls,duration,i/hz,(i+1)/hz,hz,.001);states[i+1]=s
    return states,actions

@njit(nogil=True)
def residual(controls,initial,goal,duration,hz):
    states=rollout(initial,controls,duration,hz);n=len(controls);out=np.empty(10+16*n);final=states[n]
    out[0]=4*final[0];out[1]=2*final[1]
    for j in range(3):
        out[2+j]=8*math.sin((final[2+j]-goal[j])/2);out[5+j]=final[5+j]
    out[8]=.12*final[8];out[9]=.08*controls[-1]
    for i in range(n):
        s=states[i+1];k=10+16*i
        out[k]=18*max(0.,abs(s[0])-.62);out[k+1]=5*max(0.,abs(s[1])-2.6)
        for j in range(3):
            out[k+2+j]=.3*max(0.,abs(s[5+j])-(OMEGA-1))
            relative=s[5+j]-(s[4+j] if j else 0.)
            out[k+5+j]=.2*max(0.,abs(relative)-(RELATIVE_OMEGA-1))
            out[k+8+j]=.003*s[5+j]
            out[k+11+j]=.2*max(0.,abs(s[2+j]-initial[2+j])-1.9*math.pi)
        out[k+14]=.002*controls[i]
        out[k+15]=.012*(controls[i]-(controls[i-1] if i else 0.))
    return out

@njit(nogil=True)
def residual_jacobian(controls,initial,goal,duration,hz):
    base=residual(controls,initial,goal,duration,hz);jac=np.empty((len(base),len(controls)))
    for i in range(len(controls)):
        shifted=controls.copy();shifted[i]+=1.e-4
        jac[:,i]=(residual(shifted,initial,goal,duration,hz)-base)/1.e-4
    return jac

def linearize(state,command=0.):
    a=np.empty((9,9));eps=1.e-5
    for i in range(9):
        v=np.zeros(9);v[i]=eps;a[:,i]=(derivative(state+v,command)-derivative(state-v,command))/(2*eps)
    b=np.zeros((9,1));b[8]=1/TAU
    return a,b

def discrete(a,b,dt):
    ab=np.zeros((10,10));ab[:9,:9]=a;ab[:9,9:]=b;z=expm(ab*dt)
    # One previous command state represents the fractional fixed transport delay.
    znew=expm(ab*(dt-DELAY));aa=np.zeros((10,10));bb=np.zeros((10,1))
    aa[:9,:9]=z[:9,:9];aa[:9,9]=z[:9,9]-znew[:9,9]
    bb[:9,0]=znew[:9,9];bb[9,0]=1
    return aa,bb

Q=np.diag([4,2,60,60,60,2,2,2,.02,.02]);RR=np.array([[.4]])
def target_state(mask):
    state=np.zeros(9);state[2:5]=[math.pi if mask&(1<<i) else 0. for i in range(3)]
    return state

def equilibrium_gains(hz):
    gains={}
    for mask in range(8):
        a,b=linearize(target_state(mask));ad,bd=discrete(a,b,1/hz);p=solve_discrete_are(ad,bd,Q,RR)
        gain=np.linalg.solve(RR+bd.T@p@bd,bd.T@p@ad)
        gains[str(mask)]={'gain':gain[0].tolist(),'maxPole':float(max(abs(np.linalg.eigvals(ad-bd@gain))))}
    return gains

def trajectory_gains(states,controls,duration,goal):
    n=len(controls);dt=duration/n;target=np.zeros(9);target[2:5]=goal;track_r=np.array([[.1]])
    a,b=linearize(target);ad,bd=discrete(a,b,dt);p=solve_discrete_are(ad,bd,Q,track_r);gains=np.empty((n,10))
    for i in range(n-1,-1,-1):
        a,b=linearize(states[i],controls[i]);ad,bd=discrete(a,b,dt)
        k=np.linalg.solve(track_r+bd.T@p@bd,bd.T@p@ad);gains[i]=k[0];p=Q+ad.T@p@(ad-bd@k);p=(p+p.T)/2
    return gains

def assess(initial,controls,duration,mask,hz):
    trace,actions=fine_trace(initial,controls,duration,hz);goal=target_state(mask)[2:5];end=trace[-1]
    angle=np.max(np.abs(np.arctan2(np.sin(end[2:5]-goal),np.cos(end[2:5]-goal))))
    omega=np.max(np.abs(trace[:,5:8]));relative=np.column_stack((trace[:,5],np.diff(trace[:,5:8],axis=1)))
    metrics={'angleMax':float(angle),'angularSpeedMax':float(np.max(np.abs(end[5:8]))),'cartPosition':float(abs(end[0])),'cartSpeed':float(abs(end[1])),
             'railMax':float(np.max(np.abs(trace[:,0]))),'speedMax':float(np.max(np.abs(trace[:,1]))),'omegaMax':float(omega),'relativeOmegaMax':float(np.max(np.abs(relative))),'motorEnd':float(abs(end[8]))}
    ok=(angle<.055 and metrics['angularSpeedMax']<.25 and abs(end[0])<.10 and abs(end[1])<.12 and
        metrics['railMax']<.65 and metrics['speedMax']<2.8 and omega<OMEGA and metrics['relativeOmegaMax']<RELATIVE_OMEGA and abs(end[8])<1.)
    return ok,metrics,trace,actions

def assess_reference(reference,mask):
    trace=np.array(reference['states']);actions=np.array(reference['controls']);duration=reference['duration'];hz=100
    defects=[]
    for i in range(len(actions)):
        predicted=segment(trace[i].copy(),actions,duration,i/hz,(i+1)/hz,hz,.001)
        defects.append(np.max(np.abs(predicted-trace[i+1])))
    end=trace[-1];goal=target_state(mask);angle=float(np.max(np.abs(np.arctan2(np.sin(end[2:5]-goal[2:5]),np.cos(end[2:5]-goal[2:5])))))
    relative=np.column_stack((trace[:,5],np.diff(trace[:,5:8],axis=1)))
    metrics={'angleMax':angle,'angularSpeedMax':float(np.max(np.abs(end[5:8]))),'cartPosition':float(abs(end[0])),'cartSpeed':float(abs(end[1])),
             'railMax':float(np.max(np.abs(trace[:,0]))),'speedMax':float(np.max(np.abs(trace[:,1]))),'omegaMax':float(np.max(np.abs(trace[:,5:8]))),
             'relativeOmegaMax':float(np.max(np.abs(relative))),'localDefectMax':float(max(defects))}
    ok=(angle<.03 and metrics['angularSpeedMax']<.15 and metrics['railMax']<.66 and metrics['speedMax']<2.8 and
        metrics['omegaMax']<OMEGA and metrics['relativeOmegaMax']<RELATIVE_OMEGA and metrics['localDefectMax']<1e-5)
    return ok,metrics,trace,actions

def plan(initial,mask,deadline=25.,cancel=lambda:False,reference_override=None,hz=100):
    initial=np.array(initial,dtype=float);initial[2:5]=np.arctan2(np.sin(initial[2:5]),np.cos(initial[2:5]))
    goal=target_state(mask)[2:5];start=time.monotonic();best=None;rng=np.random.default_rng(1234+mask)
    refs=json.loads((ROOT/'data'/'references.json').read_text(encoding='utf8'))
    source=sum(1<<i for i in range(3) if math.cos(initial[2+i])<0)
    guesses=json.loads((ROOT/'data'/'initial-guesses.json').read_text(encoding='utf8'))
    reference=reference_override or refs.get(f'{source}-{mask}') or guesses.get(f'{source}-{mask}')
    def result(controls,duration,metrics,trace,actions):
        return {'ok':True,'duration':duration,'hz':hz,'states':trace.tolist(),'controls':actions.tolist(),
                'gains':trajectory_gains(trace,actions,duration,goal).tolist(),'metrics':metrics,'seconds':time.monotonic()-start}
    if reference:
        if 'states' in reference and reference.get('validatedFeedback'):
            ok,metrics,trace,actions=assess_reference(reference,mask)
            delta=initial-trace[0];delta[2:5]=np.arctan2(np.sin(delta[2:5]),np.cos(delta[2:5]))
            nearby=(np.max(np.abs(delta[2:5]))<.02 and np.max(np.abs(delta[5:8]))<.12 and abs(delta[0])<.015 and abs(delta[1])<.05 and abs(delta[8])<.5)
            if ok and nearby and hz==100:
                value=result(actions,reference['duration'],metrics,trace,actions);value['mode']='validated-feedback-reference';return value
        controls=np.array(reference['controls']);ok,metrics,trace,actions=assess(initial,controls,reference['duration'],mask,hz)
        if ok:return result(controls,reference['duration'],metrics,trace,actions)
    class Timeout(Exception):pass
    def fun(u,x,g,d,rate):
        if cancel() or time.monotonic()-start>deadline:raise Timeout()
        return residual(u,x,g,d,rate)
    durations=list(dict.fromkeys([4.5,5.5,7.]+([reference['duration']] if reference else [])))
    for duration in durations:
        n=40;grid=np.arange(1,n+1)/n
        seeds=[]
        if reference:
            old=np.array(reference['controls']);oldgrid=np.arange(1,len(old)+1)/len(old);seeds.append(np.interp(grid,oldgrid,old))
        seeds.extend([6*np.sin(2*math.pi*grid*f+rng.uniform(-math.pi,math.pi))*np.sin(math.pi*grid) for f in [1,2]])
        for seed in seeds:
            try:sol=least_squares(fun,np.clip(seed,-20,20),jac=residual_jacobian,bounds=(-20.,20.),args=(initial,goal,duration,hz),max_nfev=150,ftol=1e-7,xtol=1e-7,gtol=1e-7)
            except Timeout:break
            ok,metrics,trace,actions=assess(initial,sol.x,duration,mask,hz);score=float(np.linalg.norm(residual(sol.x,initial,goal,duration,hz)))
            if best is None or score<best[0]:best=(score,metrics)
            if ok:return result(sol.x,duration,metrics,trace,actions)
        if time.monotonic()-start>deadline:break
    return {'ok':False,'reason':'本次搜索未找到同时满足低转速、执行器响应和轨道约束的轨迹','best':best[1] if best else None,'seconds':time.monotonic()-start}

def route(initial,mask,cancel=lambda:False):
    from collections import deque
    source=sum(1<<i for i in range(3) if math.cos(initial[2+i])<0)
    refs=json.loads((ROOT/'data'/'references.json').read_text(encoding='utf8'))
    edges={(i,0):{'kind':'release','target':0} for i in range(1,8)}
    for key,seed in refs.items():
        a,b=map(int,key.split('-'))
        ok,*_=(assess_reference(seed,b) if seed.get('validatedFeedback') else assess(target_state(a),np.array(seed['controls']),seed['duration'],b,100))
        if ok:edges[(a,b)]={'kind':'plan','target':b,'seed':seed}
    queue=deque([(source,[],{source})])
    while queue:
        node,stages,visited=queue.popleft()
        if node==mask and len(stages)>=2:return {'ok':True,'source':source,'stages':stages}
        if len(stages)>=3:continue
        for (a,b),stage in edges.items():
            if a==node and b not in visited:queue.append((b,stages+[stage],visited|{b}))
    return {'ok':False,'reason':'当前可用的低转速路线尚不能连接目标；旧的激进轨迹已停用'}

def warmup():
    x=np.zeros(9);u=np.zeros(4);goal=np.zeros(3)
    residual(u,x,goal,1.,100);residual_jacobian(u,x,goal,1.,100);equilibrium_gains(100)
