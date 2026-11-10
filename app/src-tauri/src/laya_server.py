# yatai's Laya helper: answers typed decision questions (choice / noul / score) about a state with a Laya encoder
# checkpoint. No generative model: vega (Laya's LLM reader) is off. Started by src-tauri/src/laya.rs, which writes this
# file next to the virtual environment that app/sidecar/laya/setup.ps1 made.
#   python -I laya_server.py --port 8765 --parent <pid> [--threads 4]
# GET  /health                       -> {"ok": true, "loaded": [...]}
# POST /predict {"model": "english", "email": {subject, body, sender, ...} | "state": ..., "questions": {...}}
#                                    -> what laya.Router.predict returns
# Loopback only, idle CPU priority, exits when the parent (yatai) is gone or after an hour without requests.
import argparse, ctypes, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, default=8765)
ap.add_argument('--parent', type=int, default=0)
ap.add_argument('--threads', type=int, default=max(2, (os.cpu_count() or 4) // 2))
ap.add_argument('--idle-exit', type=int, default=3600)
args = ap.parse_args()

if os.name == 'nt':
    from ctypes import wintypes
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    # handles are pointer-sized: without these, ctypes passes them as 32-bit ints and the calls fail silently
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    k32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    if not k32.SetPriorityClass(k32.GetCurrentProcess(), 0x40):  # IDLE_PRIORITY_CLASS: never in the way
        print(f'could not lower the priority: {ctypes.get_last_error()}', flush=True)

import torch  # noqa: E402

torch.set_num_threads(args.threads)
from laya import Router  # noqa: E402
from laya.email import email_state  # noqa: E402

router = Router(default='english', vega=False, max_loaded=1)
lock = threading.Lock()  # one inference at a time: the threads are already capped
last = time.time()


def alive(pid: int) -> bool:
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = wintypes.DWORD()
    k32.GetExitCodeProcess(h, ctypes.byref(code))
    k32.CloseHandle(h)
    return code.value == 259  # STILL_ACTIVE


def watchdog():
    while True:
        time.sleep(10)
        if (args.parent and not alive(args.parent)) or time.time() - last > args.idle_exit:
            os._exit(0)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'ok': True, 'pid': os.getpid()})
        self.reply(404, {'error': 'not found'})

    def do_POST(self):
        global last
        if self.path != '/predict':
            return self.reply(404, {'error': 'not found'})
        last = time.time()
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('content-length', 0))) or b'{}')
            if 'email' in req:
                e = dict(req['email'])
                state = email_state(e.pop('subject', ''), e.pop('body', ''), sender=e.pop('sender', None), max_chars=int(e.pop('max_chars', 1500)), **e)
            else:
                state = req['state']
            t = time.time()
            with lock:
                out = router.predict(state, req['questions'], model=req.get('model') or 'english')
            out = json.loads(json.dumps(out, default=lambda o: o.item() if hasattr(o, 'item') else str(o)))
            out['x_ms'] = round((time.time() - t) * 1000)
            self.reply(200, out)
        except (KeyError, ValueError, TypeError) as e:
            self.reply(422, {'error': str(e)})
        except Exception as e:  # noqa: BLE001
            self.reply(500, {'error': f'{type(e).__name__}: {e}'})


threading.Thread(target=watchdog, daemon=True).start()
srv = ThreadingHTTPServer(('127.0.0.1', args.port), H)
print(f'laya helper on 127.0.0.1:{args.port}', flush=True)
srv.serve_forever()
