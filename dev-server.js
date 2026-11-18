// Servidor local: node dev-server.js  → http://localhost:3000 (sem DATABASE_URL usa memória)
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const handler = require('./api/game');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === '/api/game') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { req.query = u.query; req.body = body ? JSON.parse(body) : {}; handler(req, res); });
    return;
  }
  const f = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end('404'); } res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(d); });
}).listen(process.env.PORT || 3000, () => console.log('Adedanha em http://localhost:' + (process.env.PORT || 3000)));
