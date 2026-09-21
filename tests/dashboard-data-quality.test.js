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
const crossMarket = between('async function _renderCrossMarket(){', 'function renderXmMap(');
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
  vm.runInContext(mapSource, e.c);
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
