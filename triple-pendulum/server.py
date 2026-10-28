from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse, parse_qs
import json
import numpy as np
from controller_model import equilibrium_gains, plan, route, warmup

ROOT=Path(__file__).resolve().parent
PLAN_LOCK=Lock()
GENERATION=0

@lru_cache(maxsize=8)
def gains(hz):
    return equilibrium_gains(hz)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def send_json(self,data):
        body=json.dumps(data,allow_nan=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)

    def do_GET(self):
        url=urlparse(self.path)
        if url.path=='/gains':
            hz=int(parse_qs(url.query).get('hz',['100'])[0])
            return self.send_json(gains(hz))
        return super().do_GET()

    def do_POST(self):
        global GENERATION
        if self.path=='/cancel':
            GENERATION+=1
            return self.send_json({'cancelled':True})
        if self.path not in ('/plan','/route'): return self.send_error(404)
        request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        initial=np.array(request['state'],dtype=float);mask=int(request['target'])
        GENERATION+=1;mine=GENERATION
        with PLAN_LOCK:
            if mine!=GENERATION: return self.send_json({'ok':False,'reason':'规划已被新目标替代'})
            result=(route(initial,mask,cancel=lambda:mine!=GENERATION) if self.path=='/route'
                    else plan(initial,mask,cancel=lambda:mine!=GENERATION,reference_override=request.get('seed'),hz=int(request.get('hz',100))))
        try: self.send_json(result)
        except (BrokenPipeError,ConnectionResetError): pass

if __name__=='__main__':
    print('正在准备控制器数值内核…',flush=True)
    warmup()
    print('三摆控制实验：http://127.0.0.1:8771/\n关闭网页后按 Ctrl+C 停止服务。',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8771),Handler).serve_forever()
