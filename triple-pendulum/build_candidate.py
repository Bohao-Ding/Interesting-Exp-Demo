"""Turn a multiple-shooting iterate into a feedback reference for plant replay."""
import sys
import json
from pathlib import Path
import numpy as np
import controller_model as c

mask=int(sys.argv[1]);saved=json.loads(Path(f'validation/repair-0-{mask}.tmp.json').read_text(encoding='utf8'))
u=np.array(saved['controls']);n=len(u);duration=saved['duration'];h=duration/n
middle=np.array(saved['variables'][:9*(n-1)]).reshape(n-1,9);goal=c.target_state(mask)
goal[2:5]=middle[-1,2:5]+np.arctan2(np.sin(goal[2:5]-middle[-1,2:5]),np.cos(goal[2:5]-middle[-1,2:5]))
states=np.vstack((np.zeros(9),middle,goal))
samples=round(duration*100);trace=[];actions=[]
for k in range(samples+1):
    t=k/100;node=min(n,int(round(t/h))) if abs(t/h-round(t/h))<1e-7 else min(n-1,int(t/h))
    trace.append(states[node] if abs(t-node*h)<1e-8 else c.segment(states[node].copy(),u,duration,node*h,t,100,.001))
    if k<samples:actions.append(c.command_at(u,duration,t))
trace=np.array(trace);actions=np.array(actions)
result={'target':mask,'duration':duration,'states':trace.tolist(),'controls':actions.tolist(),
        'gains':c.trajectory_gains(trace,actions,duration,c.target_state(mask)[2:5]).tolist(),'defectMax':saved['defectMax']}
Path(f'validation/feedback-0-{mask}.tmp.json').write_text(json.dumps(result),encoding='utf8')
print({'target':mask,'duration':duration,'defectMax':saved['defectMax'],'omega':np.max(np.abs(trace[:,5:8]),axis=0).tolist()})
