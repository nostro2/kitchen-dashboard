#!/usr/bin/env python3
"""
Serves the kitchen dashboard and proxies /rtt/ to the RTT API.

Usage:
  python3 server.py [port]   (default port: 8080)

Env vars (from .env or shell):
  RTT_TOKEN  — refresh token from data.rtt.io portal (used to get short-lived access tokens)
"""

import http.server
import urllib.request
import urllib.error
import os
import sys
import json
import time
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
SERVE_DIR = Path(__file__).parent
RTT_BASE = 'https://data.rtt.io'

# Load .env
env_file = Path(__file__).parent / '.env'
if env_file.exists():
    for line in env_file.read_text().splitlines():
        m = line.strip()
        if m and not m.startswith('#') and '=' in m:
            k, v = m.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

RTT_TOKEN = os.environ.get('RTT_TOKEN', '')

# Cached short-lived access token
_access_token = None
_access_expiry = 0.0


def get_access_token():
    global _access_token, _access_expiry
    if _access_token and time.time() < _access_expiry - 60:
        return _access_token
    req = urllib.request.Request(
        f'{RTT_BASE}/api/get_access_token',
        headers={'Authorization': f'Bearer {RTT_TOKEN}'},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if not data.get('token'):
        raise RuntimeError('Token exchange failed: no token in response')
    _access_token = data['token']
    if 'validUntil' in data:
        from datetime import datetime, timezone
        _access_expiry = datetime.fromisoformat(data['validUntil']).astimezone(timezone.utc).timestamp()
    else:
        _access_expiry = time.time() + 300
    return _access_token


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SERVE_DIR), **kwargs)

    def do_GET(self):
        if self.path.startswith('/rtt/'):
            self._proxy_rtt()
        else:
            super().do_GET()

    def end_headers(self):
        path = self.path.split('?')[0]
        if path.endswith(('.js', '.css')):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _proxy_rtt(self):
        # /rtt/gb-nr/location?location=HYH → data.rtt.io/gb-nr/location?location=HYH
        rtt_path = self.path[4:]  # strip /rtt → /gb-nr/...
        try:
            token = get_access_token()
        except Exception as e:
            print(f'[RTT] Token exchange error: {e}')
            self.send_error(502, f'RTT token exchange failed: {e}')
            return

        url = f'{RTT_BASE}{rtt_path}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                print(f'[RTT] {rtt_path} → 200')
        except urllib.error.HTTPError as e:
            print(f'[RTT] {rtt_path} → {e.code}')
            self.send_error(e.code, str(e.reason))
        except Exception as e:
            print(f'[RTT] {rtt_path} → error: {e}')
            self.send_error(502, str(e))

    def log_message(self, fmt, *args):
        pass  # suppress static file noise; RTT calls logged above


if __name__ == '__main__':
    if not RTT_TOKEN:
        print('Warning: RTT_TOKEN not set — train times will not work.')

    print(f'Serving {SERVE_DIR} on http://0.0.0.0:{PORT}')
    httpd = http.server.HTTPServer(('', PORT), Handler)
    httpd.serve_forever()
