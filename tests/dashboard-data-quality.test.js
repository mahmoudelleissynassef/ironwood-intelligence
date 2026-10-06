'use strict';
// Offline regression tests execute the dashboard's own helpers and renderers.
// No Supabase, browser login, source website or paid request is involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
function between(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'source boundaries exist: ' + start);
  return html.slice(a, b);
}
const quality = between('var CITY_PRICE_MIN_N=', '// One cross-market render');
const tokens = between('var _EP=', '// A retry button');
const crossMarket = between('async function _renderCrossMarket(){', '// Dark basemap: Esri');
const darkBase = between('// Dark basemap: Esri', 'function renderXmMap(');
const signals = between('async function loadMarketSignals(country){', '// ══════════════════════════════════════════════════════════════');
const mapSource = between('async function renderMap(country,K){', 'function _bars(');
const profileSource = between('function _marketKey(city,sub){', 'async function loadBatch2(country){');
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function context(extra = {}) {
  const held = new Set(), nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', removeAttribute() {} }); return nodes.get(id); };
  const c = vm.createContext({ console, Number, Date, Promise, Set, Map,
    ACTIVE_COUNTRY: 'Morocco', COUNTRIES: {}, _newsEsc: escape, _heldRes: r => r?.error?.code === 'PT423',
    _isHeld: country => held.has(country), _cLabel: country => country, _heldSignals: country => { node('sig-ios').textContent = 'Held: ' + country; },
    document: { getElementById: id => nodes.get(id) || null }, ...extra });
  vm.runInContext(tokens + quality, c);
  return { c, held, nodes, node };
}
function city(name, saleN, rentN, valid = true) {
  return { city: name, geography_valid: valid, listings: saleN + rentN,
    sale_count: saleN, rent_count: rentN, sale_median: 1000, rent_median: 10 };
}
function kpi(total, priced, cities) {
  return { total_count: total, raw_count: total * 2, dedup_count: priced,
    coverage: { total_count: total, priced_count: priced }, cities, city_class: [], districts: [] };
}
function overview(payloads, opts = {}) {
  const requests = [], env = context();
  env.node('pg-market-terminal');
  env.c.COUNTRIES = Object.fromEntries(Object.keys(payloads).map(k => [k, { label: k, currency: 'USD', status: 'live' }]));
  Object.assign(env.c, { _fx: async () => ({ USD: 1 }), _usd: (v, cur, fx) => v / fx[cur], _nextMon: () => 'next Monday',
    renderXmMap() {}, _heldSinceTxt: x => x, _heldInfo: () => ({}), _heldTitle: c => c + ' held', _heldNote: () => 'Under review', _HELD_SENTENCE: 'Unavailable.',
    sb: { rpc: async (name, args) => { requests.push([name, args.p_country]); return opts.responses?.[args.p_country] || { data: payloads[args.p_country] }; },
      from: () => ({ select() { return this; }, order() { return this; }, async limit() { return { data: [] }; } }) }
  });
  vm.runInContext(crossMarket, env.c);
  return { ...env, requests, render: () => env.c._renderCrossMarket(), output: () => env.node('pg-market-terminal').innerHTML };
}

test('all inline scripts are valid JavaScript', () => {
  let n = 0;
  for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) { new vm.Script(m[1]); n++; }
  assert.ok(n > 0);
});

test('coverage rejects incompatible populations instead of clamping or using raw counts', () => {
  const { c } = context();
  assert.equal(c._coverageOf({ total_count: 100, raw_count: 105 }), null);
  assert.equal(c._coverageOf({ coverage: { total_count: 100, priced_count: 105 } }), null);
  assert.equal(c._coverageOf({ coverage: { total_count: 100, priced_count: null } }), null);
  assert.equal(c._coverageOf({ coverage: { total_count: 100, priced_count: 0 } }).pct, 0);
  assert.equal(c._coverageOf({ coverage: { total_count: 0, priced_count: 0 } }).pct, null);
  assert.equal(c._coverageOf({ coverage: { total_count: 100, priced_count: 60 } }).pct, 60);
});

test('overview weights consistent coverage counts and displays eligible sale n, never total city n', async () => {
  const e = overview({ Morocco: kpi(10000, 8000, [city('Rabat', 7000, 411)]),
    Nigeria: kpi(1000, 250, [city('Lagos', 9, 20), city('Abuja', 10, 10), city('Bad advert 4 bed sale', 100, 1, false), city('Solo City', 1, 0)]) });
  await e.render();
  const output = e.output(), saleChart = output.split('Median asking price per m² by city')[1].split('Map Explorer')[0];
  assert.match(output, /Price coverage[\s\S]*?75<span class="unit">%/);
  assert.match(output, /8,250 of 11,000 deduplicated active listings/);
  assert.match(saleChart, /Top 2 of 2 eligible cities/);
  assert.match(saleChart, /n=7,000/);
  assert.doesNotMatch(saleChart, /n=7,411|Lagos|Solo City|Bad advert/);
  assert.doesNotMatch(output, /Bad advert/);
  assert.ok(e.requests.every(([name]) => name === 'market_kpis'), 'overview does not request expensive signals just to obtain another denominator');
});

test('old or inconsistent caches show unavailable coverage and do not invent price sample counts', async () => {
  const old = { total_count: 100, raw_count: 105, dedup_count: 100, cities: [{ city: 'Rabat', listings: 99, sale_median: 5000 }] };
  const e = overview({ Morocco: old }); await e.render();
  assert.match(e.output(), /Price coverage[\s\S]*?Unavailable/);
  assert.match(e.output(), /Top 0 of 0 eligible cities/);
  assert.doesNotMatch(e.output(), /105%|width:105/);
  old.coverage = { total_count: 100, priced_count: 101 };
  await e.render(); assert.match(e.output(), /Comparable counts unavailable/);
});

test('held markets are never queried or counted; failed market reads are explicitly disclosed', async () => {
  const e = overview({ Morocco: kpi(100, 80, [city('Rabat', 20, 10)]), Kenya: kpi(999999, 999999, [city('HeldCity', 999999, 0)]), Nigeria: kpi(100, 50, []) },
    { responses: { Nigeria: { error: { message: 'timeout' }, data: null } } });
  e.held.add('Kenya'); await e.render();
  assert.ok(!e.requests.some(([, country]) => country === 'Kenya'));
  assert.doesNotMatch(e.output(), /999,999|HeldCity/);
  assert.match(e.output(), /Kenya.*publication on hold/s);
  assert.match(e.output(), /Summary unavailable for Nigeria/);
  assert.match(e.output(), /80 of 100 deduplicated active listings/);
});

function signalEnv() {
  const env = context(), queue = [];
  ['sig-ios', 'sig-yield', 'sig-liquidity', 'sig-momentum', 'sig-supply', 'sig-momentum-sub', 'signals-sub'].forEach(env.node);
  env.c.sb = { rpc() { const d = deferred(); queue.push(d); return d.promise; } };
  vm.runInContext(signals, env.c);
  return { ...env, queue };
}
test('a late failure from the same market cannot overwrite a newer signal response', async () => {
  const e = signalEnv(), older = e.c.loadMarketSignals('Morocco'), newer = e.c.loadMarketSignals('Morocco');
  e.queue[1].resolve({ data: { ios_score: 73, supply_change_pct: 4 } }); await newer;
  e.queue[0].resolve({ error: { message: 'old timeout' } }); await older;
  assert.equal(e.node('sig-ios').textContent, 73);
  assert.equal(e.node('sig-supply').textContent, '+4%');
});
test('signal failure clears every card, while a stale market rejection changes nothing', async () => {
  const e = signalEnv(); e.node('sig-supply').textContent = '+9%';
  const load = e.c.loadMarketSignals('Morocco'); e.queue[0].reject(new Error('network unavailable')); await load;
  assert.equal(e.node('sig-supply').textContent, 'Load failed');
  assert.match(e.node('signals-sub').innerHTML, /Retry/);
  const stale = e.c.loadMarketSignals('Morocco'); e.c.ACTIVE_COUNTRY = 'Nigeria'; e.c._EP.mkt++;
  e.node('sig-ios').textContent = 'Nigeria'; e.queue[1].reject(new Error('late failure')); await stale;
  assert.equal(e.node('sig-ios').textContent, 'Nigeria');
});
test('signals received after a hold do not reintroduce figures', async () => {
  const e = signalEnv(), load = e.c.loadMarketSignals('Morocco');
  e.held.add('Morocco'); e.queue[0].resolve({ data: { ios_score: 88 } }); await load;
  assert.equal(e.node('sig-ios').textContent, 'Held: Morocco');
});

test('map requests and timers stay attached to their own instance across a newer render', async () => {
  const e = context(), maps = [], answers = [], timers = [];
  e.node('pg-map-view');
  const L = { map() { const m = { removed: false, handlers: 0, resized: 0,
    remove() { this.removed = true; }, setView() { assert.ok(!this.removed); return this; },
    on() { assert.ok(!this.removed, 'listener added to removed map'); this.handlers++; },
    getZoom() { return 5; }, hasLayer() { return false; }, addLayer() {}, removeLayer() {}, invalidateSize() { assert.ok(!this.removed); this.resized++; } };
    maps.push(m); return m; }, tileLayer() { return { addTo() {} }; }, layerGroup() { return { getLayers: () => [] }; } };
  Object.assign(e.c, { COUNTRIES: { Morocco: { status: 'live', label: 'Morocco', currency: 'MAD' } },
    window: { L }, L, _liveMap: null, _curFilters: () => ({ asset: 'all', type: 'sale', days: null }), _fx: async () => ({}),
    V2HEAD: () => '', _ccyName: x => x, COUNTRY_VIEW: { Morocco: [[31, -7], 5] }, CITY_COORDS: {},
    setTimeout: fn => { timers.push(fn); }, sb: { rpc() { const d = deferred(); answers.push(d); return d.promise; } } });
  vm.runInContext(darkBase + mapSource, e.c);
  const first = e.c.renderMap('Morocco', { cities: [] }); await new Promise(setImmediate);
  const second = e.c.renderMap('Morocco', { cities: [] }); await new Promise(setImmediate);
  answers[1].resolve({ data: [] }); await second;
  answers[0].resolve({ data: [] }); await first;
  assert.equal(maps[0].handlers, 0); assert.equal(maps[1].handlers, 1);
  // A subsequent render retires the second map before its resize timer fires.
  maps[1].remove(); e.c._liveMap = null; timers.forEach(fn => fn());
  assert.equal(maps[1].resized, 0);
});

test('district profiles preserve city/class/date scope and reject stale same-name city responses', async () => {
  const e = context(), calls = [], answers = [];
  e.node('pr-body');
  e.c.document.querySelectorAll = () => [];
  e.c._SLOT['pg-markets'] = 77;
  Object.assign(e.c, { window: { _mkCtx: { country: 'Morocco', cur: 'MAD', type: 'sale', asset: 'Apartments', days: 30, rid: 77 },
    _mkRows: [{ city: 'Fez', sub: 'Central', n: 10 }, { city: 'Tangier', sub: 'Central', n: 20 }] },
    _fx: async () => ({}), money: v => String(v), _errorState: (title, err) => err,
    _heldPage: () => { e.node('pr-body').innerHTML = 'Held'; },
    _rpc(name, args) { calls.push([name, args]); const d = deferred(); answers.push(d); return d.promise; }
  });
  vm.runInContext(profileSource, e.c);
  await e.c.selectMarket('Central');
  assert.equal(calls.length, 0, 'an ambiguous district name never silently selects the first city');
  const older = e.c.selectMarket('Central', 'Fez'); await new Promise(setImmediate);
  const newer = e.c.selectMarket('Central', 'Tangier'); await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['district_profile_filtered', {
    p_country: 'Morocco', p_submarket: 'Central', p_tt: 'sale', p_city: 'Fez', p_asset: 'Apartments', p_days: 30
  }]);
  assert.equal(calls[1][1].p_city, 'Tangier');
  answers[1].resolve({ ok: false, error: 'Tangier response' }); await newer;
  answers[0].resolve({ ok: false, error: 'Stale Fez response' }); await older;
  assert.equal(e.node('pr-body').innerHTML, 'Tangier response');
  e.held.add('Morocco'); await e.c.selectMarket('Central', 'Tangier');
  assert.equal(calls.length, 2, 'held market makes no profile request');
  assert.equal(e.node('pr-body').innerHTML, 'Held');
});

// ── Price trends: the weekly market_snapshots series builder ──
const trendsSource = between('/* ── PRICE TRENDS', '// ── BY BEDROOM');
function trendsEnv(extra = {}) {
  const env = context({ _ccyMode: 'local', _lsym: cur => (cur === 'USD' ? '$' : cur + ' '), _cap: s => s.charAt(0).toUpperCase() + s.slice(1),
    _normCountry: s => String(s).toLowerCase(), window: {}, ...extra });
  env.c.document.querySelector = () => null; env.c.document.querySelectorAll = () => [];
  vm.runInContext(trendsSource, env.c);
  return env;
}
// One snapshot row, in the shape public.market_snapshots returns.
function snap(d, city, tt, med, n, usd) {
  return { snapshot_date: d, city, asset_class: 'Apartments', transaction_type: tt, median_ppsqm: med, listing_count: n,
    currency: usd == null ? null : 'MAD', median_ppsqm_usd: usd == null ? null : usd };
}
const DAY = 86400000, T = d => Date.parse(d + 'T00:00:00Z');
// Values built inside the vm context carry its own Array prototype: compare plain copies.
const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

test('trend series: a snapshot repeating the previous week is dropped, a real change is kept', () => {
  const { c } = trendsEnv();
  const rows = [snap('2026-08-10', 'Rabat', 'sale', 13000, 900), snap('2026-08-10', 'Casablanca', 'sale', 15000, 2000),
    snap('2026-08-17', 'Rabat', 'sale', 13000, 900), snap('2026-08-17', 'Casablanca', 'sale', 15000, 2000),
    snap('2026-08-24', 'Casablanca', 'sale', 15000, 2000), snap('2026-08-24', 'Rabat', 'sale', 13000, 900),
    snap('2026-09-09', 'Rabat', 'sale', 13100, 950), snap('2026-09-09', 'Casablanca', 'sale', 15000, 2000)];
  const out = c._snapDedupe(rows);
  same([...new Set(out.map(r => r.snapshot_date))], ['2026-08-10', '2026-09-09']);
  same([...out.repeats], ['2026-08-17', '2026-08-24']);
  same(c._snapDedupe([]).length, 0);
});

test('trend series: dates ascend whatever the row order; cities ranked by latest listing count; roll-ups and other types ignored', () => {
  const { c } = trendsEnv();
  const rows = [snap('2026-09-21', 'Rabat', 'sale', 13000, 900), snap('2026-07-13', 'Casablanca', 'sale', 15900, 2100),
    snap('2026-09-21', 'Casablanca', 'sale', 15300, 3800), snap('2026-07-13', 'Rabat', 'sale', 13900, 1200),
    snap('2026-09-14', 'Casablanca', 'Sale ', 15400, 3700), snap('2026-09-21', '(all)', 'sale', 14000, 99999),
    snap('2026-09-21', 'Casablanca', 'rent', 117, 6300), snap('2026-09-21', 'Fes', '', 150, 900)];
  const s = c._snapSeries(rows, { tt: 'sale' });
  same([...s.dates], ['2026-07-13', '2026-09-14', '2026-09-21']);
  same(s.cities.map(x => x.city), ['Casablanca', 'Rabat']);
  same(s.cities[0].points.map(p => p.d), ['2026-07-13', '2026-09-14', '2026-09-21']);
  same(s.cities[0].points.map(p => p.v), [15900, 15400, 15300]);
  assert.equal(c._snapSeries(rows, { tt: 'sale', top: 1 }).cities.length, 1);
  same(c._snapSeries(rows, { tt: 'rent' }).cities.map(x => x.city), ['Casablanca']);
  // A one-listing pseudo-city (advert text in the city field) never takes a line.
  const junk = [snap('2026-10-05', 'Abuja', 'rent', 139, 31), snap('2026-10-05', 'Lagos', 'rent', 333, 13),
    snap('2026-10-05', 'massive beautiful studio Rent 2.3m Agent 230k', 'rent', 383, 1)];
  same(c._snapSeries(junk, { tt: 'rent', top: 5 }).cities.map(x => x.city), ['Abuja', 'Lagos']);
  same(c._snapSeries([snap('2026-10-05', 'Kano', 'rent', 90, 4)], { tt: 'rent', top: 5 }).cities.map(x => x.city), ['Kano'],
    'when nothing qualifies the largest are kept, so their sample sizes can be shown');
});

test('trend series: a median behind fewer than 10 listings is withheld, counted, and breaks the line', () => {
  const { c } = trendsEnv();
  const rows = [snap('2026-09-07', 'Agadir', 'rent', 70, 12), snap('2026-09-14', 'Agadir', 'rent', 999, 9),
    snap('2026-09-21', 'Agadir', 'rent', 71, 10)];
  const s = c._snapSeries(rows, { tt: 'rent' });
  const pts = s.cities[0].points;
  same(pts.map(p => p.st), ['ok', 'small', 'ok']);
  assert.equal(pts[1].v, null, 'the small-sample value is not carried');
  assert.equal(pts[1].n, 9, 'its sample size is still reported');
  assert.equal(s.dropped, 1); assert.equal(s.shown, 2);
  const line = c._snapLine(pts);
  same(line.map(p => p.y), [70, null, 71]);
  assert.ok(!JSON.stringify(line).includes('999'), 'no withheld figure reaches the chart');
});

test('trend series: the time axis keeps irregular gaps, and a missing week breaks the line', () => {
  const { c } = trendsEnv();
  const dates = ['2026-08-17', '2026-08-24', '2026-09-09', '2026-09-14', '2026-09-21', '2026-10-05'];
  const s = c._snapSeries(dates.map((d, i) => snap(d, 'Casablanca', 'sale', 15000 + i, 3000)), { tt: 'sale' });
  const line = c._snapLine(s.cities[0].points);
  const real = line.filter(p => p.y != null);
  same(real.map(p => p.x), dates.map(T), 'x is the snapshot date itself, not an index');
  assert.equal(real[3].x - real[2].x, 5 * DAY, '9 Sep -> 14 Sep stays 5 days apart');
  assert.equal(real[2].x - real[1].x, 16 * DAY, '24 Aug -> 9 Sep stays 16 days apart');
  const breaks = line.filter(p => p.y == null).map(p => p.x);
  same(breaks, [T('2026-08-25'), T('2026-09-22')], 'breaks only after 24 Aug and after 21 Sep');
  // Weekly cadence on its own never breaks the line.
  const weekly = c._snapSeries(['2026-07-13', '2026-07-20', '2026-07-27'].map(d => snap(d, 'Rabat', 'sale', 1, 50)), { tt: 'sale' });
  assert.equal(c._snapLine(weekly.cities[0].points).filter(p => p.y == null).length, 0);
});

test('trend series: USD comes only from the rate stored with each snapshot; local uses the local median', () => {
  const { c } = trendsEnv();
  const rows = [snap('2026-08-24', 'Casablanca', 'sale', 15570, 2966, null), snap('2026-09-09', 'Casablanca', 'sale', 15447, 3537, 1645.49),
    snap('2026-10-05', 'Casablanca', 'sale', 15259, 4273, 1538.28)];
  const loc = c._snapSeries(rows, { tt: 'sale', usd: false });
  same(loc.cities[0].points.map(p => p.v), [15570, 15447, 15259]);
  assert.equal(loc.noUsd, 0);
  const usd = c._snapSeries(rows, { tt: 'sale', usd: true });
  same(usd.cities[0].points.map(p => p.v), [null, 1645.49, 1538.28], 'no live-FX back-fill for a week without a stored rate');
  same(usd.cities[0].points.map(p => p.st), ['nousd', 'ok', 'ok']);
  assert.equal(usd.noUsd, 1); assert.equal(usd.usdFrom, '2026-09-09');
  assert.equal(c._snapFmt(1538.28, 'MAD', true), '$1,538');
  assert.equal(c._snapFmt(15259, 'MAD', false), 'MAD 15,259');
  assert.equal(c._snapFmt(11.8, 'MAD', true), '$11.8');
  assert.equal(c._snapUsd('MAD'), false); c._ccyMode = 'usd';
  assert.equal(c._snapUsd('MAD'), true); assert.equal(c._snapUsd('USD'), false);
});

test('trend series: listing supply sums the city rows per snapshot, for sale and for rent', () => {
  const { c } = trendsEnv();
  const sup = c._snapSupply([snap('2026-09-21', 'Casablanca', 'sale', 1, 3800), snap('2026-09-21', 'Rabat', 'sale', 1, 900),
    snap('2026-09-21', '(all)', 'sale', 1, 4700), snap('2026-09-14', 'Rabat', 'rent', 1, 400), snap('2026-09-21', 'Rabat', 'rent', 1, 450)]);
  same([...sup.dates], ['2026-09-14', '2026-09-21']);
  same(sup.sale.map(p => [p.d, p.v]), [['2026-09-21', 4700]]);
  same(sup.rent.map(p => [p.d, p.v]), [['2026-09-14', 400], ['2026-09-21', 450]]);
});

test('trends page: an answer for a market no longer on screen is never drawn, and a held market is never queried', async () => {
  const answers = [], queries = [];
  const env = trendsEnv({
    COUNTRIES: { Morocco: { status: 'live', label: 'Morocco', currency: 'MAD' }, Tunisia: { status: 'live', label: 'Tunisia', currency: 'TND' } },
    _curFilters: () => ({ asset: 'apartments', type: 'sale', days: null }),
    V2HEAD: (country, page) => '<h1>' + country + ' ' + page + '</h1>', _loadingState: country => 'Loading ' + country, _emptyState: m => m,
    _errorState: (what, err) => 'Failed ' + what + ': ' + err, _heldPage: (id, country) => { env.node(id).innerHTML = 'Held ' + country; },
    _q: async p => { const r = await p; return r.error ? { ok: false, error: r.error.message } : { ok: true, data: r.data }; },
    sb: { from(table) {
      const q = { f: { table } };
      ['select', 'in', 'neq', 'order', 'range'].forEach(m => { q[m] = () => q; });
      q.ilike = (col, v) => { q.f[col] = v; return q; };
      q.then = (res, rej) => { queries.push(q.f); const d = deferred(); answers.push(d); return d.promise.then(res, rej); };
      return q; } }
  });
  const { c, node } = env;
  node('pg-price-trends');
  const rows = (city, n) => ['2026-09-14', '2026-09-21'].map(d => snap(d, city, 'sale', 1000 + n, 50));
  const older = c.renderTrendsPage('Morocco'); await new Promise(setImmediate);
  assert.equal(node('pg-price-trends').innerHTML, '<h1>Morocco Price Trends</h1>Loading Morocco');
  c.ACTIVE_COUNTRY = 'Tunisia'; c._EP.mkt++;                    // what switchCountry does
  const newer = c.renderTrendsPage('Tunisia'); await new Promise(setImmediate);
  same(queries.map(q => q.country), ['Morocco', 'Tunisia'], 'country is matched with ilike');
  assert.equal(queries[1].asset_class, 'apartments');
  answers[1].resolve({ data: rows('Tunis', 2) }); await newer;
  answers[0].resolve({ data: rows('Casablanca', 1) }); await older;
  const html = node('pg-price-trends').innerHTML;
  assert.match(html, /Tunis/); assert.doesNotMatch(html, /Casablanca|Morocco/);
  assert.match(html, /Median asking price per m/); assert.match(html, /id="trend-table"/);
  assert.match(html, /Occupancy isn’t directly observed/);
  env.held.add('Tunisia'); c._EP.mkt++;
  await c.renderTrendsPage('Tunisia');
  assert.equal(queries.length, 2, 'no snapshot request for a held market');
  assert.equal(node('pg-price-trends').innerHTML, 'Held Tunisia');
});
