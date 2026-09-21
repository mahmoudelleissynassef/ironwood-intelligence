'use strict';
// Runs the existing full-page scenarios with the fake Supabase client.
// Requires installed Playwright and Chrome/Edge; installs nothing.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const cases = ['deeplink', 'lateboot', 'status-order', 'old-retry', 'hold-mid-load', 'loader-order', 'registry-currency'];
const tasks = cases.map(name => ({ name, query: 'test=scenarios&case=' + name }));
for (const seed of [7, 19, 31]) tasks.push({ name: 'rapid-' + seed, query: 'test=rapid&seed=' + seed + '&steps=40&gap=60' });
if (process.env.IW_TEST_CASES) {
  const only = new Set(process.env.IW_TEST_CASES.split(','));
  for (let i = tasks.length - 1; i >= 0; i--) if (!only.has(tasks[i].name)) tasks.splice(i, 1);
  if (!tasks.length) throw new Error('IW_TEST_CASES matched no scenarios');
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--quiet'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('test server did not start')), 10000);
      server.stdout.on('data', d => { const m = /IWTEST listening (\d+)/.exec(String(d)); if (m) { clearTimeout(timeout); resolve(m[1]); } });
      server.once('error', reject);
      server.once('exit', code => { if (code) reject(new Error('test server exited ' + code)); });
    });
    const options = { headless: true };
    if (process.env.IW_TEST_BROWSER) options.executablePath = process.env.IW_TEST_BROWSER;
    browser = await chromium.launch(options);
    const results = [];
    // Limit concurrency so heavy map/chart initialisation does not create fake timeouts.
    async function worker() {
      while (tasks.length) {
        const task = tasks.shift(), page = await browser.newPage();
        // A broken stub must never turn a regression test into production traffic.
        await page.route('**/*.supabase.co/**', route => route.abort());
        try {
          const route = task.name === 'deeplink' ? '/dashboard/bedrooms' : '/dashboard';
          await page.goto('http://127.0.0.1:' + port + route + '?' + task.query, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.__testResult != null, null, { timeout: 160000 });
          const result = await page.evaluate(() => window.__testResult);
          results.push({ name: task.name, pass: result.pass, failures: result.failures, requests: result.requests });
          console.log(JSON.stringify(results[results.length - 1]));
        } catch (error) {
          results.push({ name: task.name, pass: false, error: error.message });
          console.log(JSON.stringify(results[results.length - 1]));
        } finally { await page.close(); }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    console.log(results.filter(r => r.pass).length + '/' + results.length + ' browser scenarios passed');
    if (results.some(r => !r.pass)) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
