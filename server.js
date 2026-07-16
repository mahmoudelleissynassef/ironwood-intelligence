// Ironwood Intelligence — static site server for Railway.
// Zero dependencies. Replicates the previous Vercel behavior exactly:
//   cleanUrls: true       -> /dashboard serves dashboard.html; /dashboard.html 308s to /dashboard
//   trailingSlash: false  -> /pricing/ 308s to /pricing
//   rewrites:
//     admin.<host>/*        -> admin-index.html
//     /admin, /admin/*      -> admin-index.html
//     /dashboard/:page      -> dashboard.html   (client router reads the path)
//     /en, /en/*, /fr, /fr/* -> index.html      (legacy multi-page URLs)
// Listens on $PORT (Railway) — healthcheck path "/".

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.pdf': 'application/pdf', '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.svg', '.map', '.webmanifest']);

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

function redirect(res, location) {
  send(res, 308, 'Redirecting...', { Location: location, 'Content-Type': 'text/plain' });
}

function serveFile(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html'
        ? 'public, max-age=0, must-revalidate'
        : (filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=86400' : 'public, max-age=3600'),
    };
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && COMPRESSIBLE.has(ext) && data.length > 1024) {
      zlib.gzip(data, (gzErr, gz) => {
        if (gzErr) return send(res, 200, data, headers);
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
        send(res, 200, gz, headers);
      });
    } else {
      send(res, 200, data, headers);
    }
  });
}

// Resolve a URL path to a file inside ROOT, or null. Guards against traversal.
function resolveSafe(urlPath) {
  const resolved = path.normalize(path.join(ROOT, urlPath));
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });

  const host = (req.headers.host || '').toLowerCase();

  // trailingSlash: false
  if (pathname.length > 1 && pathname.endsWith('/')) return redirect(res, pathname.slice(0, -1));
  // cleanUrls: .html URLs redirect to extensionless
  if (pathname.endsWith('.html')) return redirect(res, pathname.slice(0, -5) || '/');

  // ── rewrites (mirror vercel.json) ──
  let file = null;
  if (host.startsWith('admin.')) {
    file = 'admin-index.html';
  } else if (pathname === '/' || pathname === '/en' || pathname.startsWith('/en/') || pathname === '/fr' || pathname.startsWith('/fr/')) {
    file = 'index.html';
  } else if (pathname === '/dashboard' || /^\/dashboard\/[a-z0-9-]+$/i.test(pathname)) {
    file = 'dashboard.html';
  } else if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    file = 'admin-index.html';
  }
  if (file) return serveFile(req, res, path.join(ROOT, file));

  // ── static files ──
  const direct = resolveSafe(pathname);
  if (!direct) return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });

  fs.stat(direct, (err, st) => {
    if (!err && st.isFile()) return serveFile(req, res, direct);
    // cleanUrls: extensionless -> .html
    if (!path.extname(pathname)) {
      const asHtml = resolveSafe(pathname + '.html');
      if (asHtml) {
        return fs.stat(asHtml, (e2, s2) => {
          if (!e2 && s2.isFile()) return serveFile(req, res, asHtml);
          send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
        });
      }
    }
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ironwood site serving on :${PORT}`);
});
