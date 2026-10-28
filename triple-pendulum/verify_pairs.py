"""Bounded feasibility survey for all directed equilibrium changes."""
import os
os.environ['OPENBLAS_NUM_THREADS']='1'
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
import json
import math
import numpy as np
from controller_model import plan

def run(pair):
    source,target=pair;state=np.zeros(9)
    state[2:5]=[math.pi if source&(1<<i) else 0. for i in range(3)]
    try:
        return {'source':source,'target':target,'plan':plan(state,target,deadline=5.)}
    except Exception as e:
        return {'source':source,'target':target,'plan':{'ok':False,'reason':str(e)}}

if __name__=='__main__':
    pairs=[(i,j) for i in range(8) for j in range(8) if i!=j]
    results=[]
    with ProcessPoolExecutor(max_workers=2) as pool:
        jobs=[pool.submit(run,pair) for pair in pairs]
        for job in as_completed(jobs):
            value=job.result();results.append(value)
            print(f"{len(results):02}/56 {value['source']}->{value['target']} {'candidate' if value['plan']['ok'] else 'no candidate in budget'}",flush=True)
    results.sort(key=lambda r:(r['source'],r['target']))
    output=Path('validation');output.mkdir(exist_ok=True)
    (output/'pair-plans.tmp.json').write_text(json.dumps(results,ensure_ascii=False),encoding='utf8')
