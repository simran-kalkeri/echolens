"""Renders every architectures/*.excalidraw to SVG + PNG with the official @excalidraw/excalidraw exporter.

    python architectures/_build/render_server.py      # then open http://localhost:8765/_build/render.html
The page exports each scene in the browser and PUTs the results back into architectures/exports/.
"""
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "exports"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        if self.path == "/list":
            names = sorted(p.stem for p in ROOT.glob("*.excalidraw"))
            body = json.dumps(names).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_PUT(self):
        name = Path(self.path).name
        if not self.path.startswith("/exports/") or not name.endswith((".svg", ".png")):
            self.send_error(400)
            return
        EXPORTS.mkdir(exist_ok=True)
        (EXPORTS / name).write_bytes(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    print("http://localhost:8765/_build/render.html")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
