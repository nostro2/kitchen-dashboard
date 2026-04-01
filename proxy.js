#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const RTT_TOKEN = process.env.RTT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const RTT_BASE = 'data.rtt.io';

let accessToken = null;
let accessExpiry = 0;

function getRttAccessToken() {
  return new Promise((resolve, reject) => {
    if (accessToken && Date.now() < accessExpiry - 60000) return resolve(accessToken);
    const options = {
      hostname: RTT_BASE,
      path: '/api/get_access_token',
      headers: { 'Authorization': `Bearer ${RTT_TOKEN}` },
    };
    https.get(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.token) return reject(new Error('Token exchange failed'));
          accessToken = data.token;
          accessExpiry = new Date(data.validUntil).getTime();
          resolve(accessToken);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function proxyRtt(rttPath, res) {
  getRttAccessToken().then(token => {
    const options = {
      hostname: RTT_BASE,
      path: rttPath,
      headers: { 'Authorization': `Bearer ${token}` },
    };
    https.get(options, rttRes => {
      res.writeHead(rttRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      rttRes.pipe(res);
    }).on('error', e => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: e.message }));
    });
  }).catch(e => {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  });
}

function serveStatic(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' });
    res.end();
    return;
  }

  if (req.url.startsWith('/rtt/')) {
    proxyRtt(req.url.slice(4), res);
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      serveStatic(filePath, res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  });
}).listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
