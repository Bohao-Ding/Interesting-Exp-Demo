"""Independent DOP853 reference, including actuator delay and a high-speed case."""
import json
import subprocess
from pathlib import Path
import numpy as np
from scipy.integrate import solve_ivp
from controller_model import derivative,H,W,L,DELAY
data=json.loads(subprocess.check_output(['node','verify_physics.mjs'],text=True,encoding='utf8'))
def reference(initial,phases):
    state=np.array(initial);time=0.;events=[(0.,0.,np.array(phases[0]['forces']))];previous=0.
    for phase in phases:
        events.append((time,previous,np.array(phase['forces'])))
        events.append((time+DELAY,phase['a'],np.array(phase['forces'])))
        previous=phase['a'];time+=phase['duration']
    events.sort(key=lambda e:e[0]);events.append((time,previous,np.array(phases[-1]['forces'])))
    for i in range(len(events)-1):
        begin,u,f=events[i];end=events[i+1][0]
        if end<=begin:continue
        def rhs(t,y):
            out=derivative(y,u);theta=y[2:5];matrix=H*np.cos(theta[:,None]-theta[None,:])
            external=np.array([L[j]*np.cos(theta[j])*(f[j]/2+sum(f[j+1:])) for j in range(3)])
            out[5:8]+=np.linalg.solve(matrix,external)
            return out
        state=solve_ivp(rhs,[begin,end],state,method='DOP853',rtol=1e-12,atol=1e-13).y[:,-1]
    return state
for case in [data,data['fast']]:
    exact=reference(case['start'],case['phases'])
    case['reference']={'method':'SciPy DOP853','state':exact.tolist(),'oneMsMaxError':float(np.max(np.abs(exact-case['standard']['state']))),'halfMsMaxError':float(np.max(np.abs(exact-case['half']['state'])))}
Path('validation/physics.json').write_text(json.dumps(data,indent=2),encoding='utf8')
print(json.dumps({'ordinary':data['reference'],'highSpeed':data['fast']['reference'],'motorError':data['motorMaxError'],'jacobianError':data['jacobianError'],'benchmark':data['benchmark']},indent=2))
