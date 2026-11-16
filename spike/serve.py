"""Serve the spike folder on 127.0.0.1:8765 with CORS, so the Circuit Studio dev server page can fetch inputs.

Usage: python3 spike/serve.py
"""
import functools
import http.server
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer(('127.0.0.1', 8765),
                                functools.partial(Handler, directory=str(Path(__file__).parent))).serve_forever()
