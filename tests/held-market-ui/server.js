#!/usr/bin/env node
/* Static server for the held-market / rapid-switching test.
 *
 * It serves a COPY of the real dashboard.html, generated at start-up from the
 * file on disk, with two changes and no others:
 *   - the supabase-js <script> is replaced by /stub.js (the fake client)
 *   - /runner.js is added when the URL carries ?test=rapid
 * Everything else -- markup, styles, every line of the page's own script -- is
 * the shipped file, so the test exercises the real page and not a rewrite of it.
 *
 *   node server.js [--port 0] [--page ../../dashboard.html] [--quiet]
 *
 * --port 0 (the default) asks the OS for a free port; the chosen port is
 * printed as "IWTEST listening <port>". --page points at the page to test,
 * which is how the same test is run against the pre-change dashboard:
 *   git show HEAD:dashboard.html > old.html && node server.js --page old.html
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i > -1 && argv[i + 1] != null ? argv[i + 1] : dflt;
}
const QUIET = argv.indexOf('--quiet') > -1;
const PORT = parseInt(arg('port', '0'), 10);
const PAGE = path.resolve(__dirname, arg('page', path.join('..', '..', 'dashboard.html')));

const SUPA_RE = /<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"[^>]*><\/script>/;

function buildPage(withRunner) {
  let html = fs.readFileSync(PAGE, 'utf8');
  if (!SUPA_RE.test(html)) throw new Error('supabase-js script tag not found in ' + PAGE);
  html = html.replace(SUPA_RE, '<script src="/stub.js"></script>' + (withRunner ? '\n<script src="/runner.js"></script>' : ''));
  return html;
}

const FILES = {
  '/stub.js': ['application/javascript', () => fs.readFileSync(path.join(__dirname, 'stub.js'))],
  '/runner.js': ['application/javascript', () => fs.readFileSync(path.join(__dirname, 'runner.js'))],
  '/batch': ['text/html; charset=utf-8', () => fs.readFileSync(path.join(__dirname, 'batch.html'))],
  '/batch.html': ['text/html; charset=utf-8', () => fs.readFileSync(path.join(__dirname, 'batch.html'))]
};

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const q = req.url.indexOf('?') > -1 ? req.url.slice(req.url.indexOf('?') + 1) : '';
  try {
    if (FILES[u]) {
      const [type, read] = FILES[u];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(read());
    }
    if (u === '/dashboard' || u.startsWith('/dashboard/')) {
      const html = buildPage(/(^|&)test=(rapid|scenarios)(&|$)/.test(q));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (u === '/page-info') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ page: PAGE, bytes: fs.statSync(PAGE).size }));
    }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end(String((e && e.stack) || e));
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

srv.listen(PORT, '127.0.0.1', () => {
  const p = srv.address().port;
  if (!QUIET) console.log('IWTEST page ' + PAGE);
  console.log('IWTEST listening ' + p);
});
