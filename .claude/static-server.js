const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(root, urlPath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: a clean route like /collection has no matching file,
      // so serve index.html and let the app's own router take over --
      // mirrors the _redirects/vercel.json rule used on real hosting.
      if (path.extname(filePath) === '') {
        fs.readFile(path.join(root, 'index.html'), (err2, indexData) => {
          if (err2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
          res.end(indexData);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}`);
});
