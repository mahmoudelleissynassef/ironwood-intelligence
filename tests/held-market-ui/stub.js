/* Fake supabase-js client for the held-market / rapid-switching test.
 *
 * What it gives the page:
 *   - data_status with publication holds (Ethiopia is held from boot; any
 *     market can be held or released mid-run through window.__stub)
 *   - HTTP 423 / PT423 "market_held" for every listing-derived RPC of a held
 *     market, and withheld (empty) table reads for its listing-derived tables
 *   - SENTINEL figures in every payload, one distinctive digit run per market
 *     (Kenya 11111x, Morocco 22222x, Tunisia 33333x, Ethiopia 99999x), so a
 *     figure that leaks from another market -- or from a held one -- can be
 *     found in the DOM by looking at it
 *   - the filter arguments echoed back inside district names, so a page drawn
 *     from an answer to OLD filters can be spotted the same way
 *   - seeded latency (0-700 ms) per request, so answers arrive out of order
 *   - a request log, and a running count of unanswered requests
 *
 * window.__stub:
 *   hold(country) / release(country)   change the server-side hold
 *   log      [{i,kind,name,country,t0,dt,knownHeld,stubHeld}]
 *   pending  requests not yet answered
 *   violations   listing requests sent for a market the PAGE already knew was held
 */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var SEED = parseInt(qs.get('seed') || '1', 10) || 1;
  var MAXLAT = parseInt(qs.get('lat') || '700', 10);

  // ── deterministic latency: a function of (seed, request key, repeat no.) ──
  function h32(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  var seen = {}, LATO = {};
  function lat(key) { var n = (seen[key] = (seen[key] || 0) + 1); return MAXLAT ? h32(SEED + '|' + key + '|' + n) % (MAXLAT + 1) : 0; }
  // A scenario can pin the latency of one request name (a number, or a list
  // consumed one call at a time) to put two answers in a chosen order.
  function latFor(name, key) {
    if (Object.prototype.hasOwnProperty.call(LATO, name)) {
      var v = LATO[name];
      if (Array.isArray(v)) return v.length ? v.shift() : lat(key);
      return v;
    }
    return lat(key);
  }

  // ── markets ──
  var MK = {
    Kenya:    { d: '1', cur: 'KES', tag: 'ZQKE', ntag: 'ZNKE', cities: ['Nairobi', 'Mombasa'],  ll: [[-1.29, 36.82], [-4.04, 39.66]] },
    Morocco:  { d: '2', cur: 'MAD', tag: 'ZQMA', ntag: 'ZNMA', cities: ['Casablanca', 'Rabat'], ll: [[33.57, -7.58], [33.97, -6.84]] },
    Tunisia:  { d: '3', cur: 'TND', tag: 'ZQTN', ntag: 'ZNTN', cities: ['Tunis', 'Sfax'],       ll: [[36.80, 10.18], [34.74, 10.76]] },
    Ethiopia: { d: '9', cur: 'USD', tag: 'ZQET', ntag: 'ZNET', cities: ['Addis Ababa'],         ll: [[9.03, 38.74]] }
  };
  // every live market in the page's COUNTRIES list; the ones without sentinels
  // answer with nothing to show, so they never add figures to a cross-market total
  var LIVE = ['Morocco', 'Nigeria', 'Egypt', 'SouthAfrica', 'Kenya', 'Ethiopia', 'Uganda', 'Tunisia'];
  var HELD = { Ethiopia: 1 };
  var NOTE = function (c) { return c + ' figures are unavailable while the underlying listing data is corrected and re-verified.'; };

  function P(m, n) { return Number(m.d + m.d + m.d + m.d + m.d + String(n)); }        // price   e.g. 1111150
  function R(m, n) { return Number(m.d + m.d + m.d + m.d + m.d + String(n % 10)); }   // rent    e.g. 111115
  function C(m) { return Number(m.d + m.d + m.d + m.d + m.d + '5'); }                 // count   e.g. 111115
  function D5(m) { return Number(m.d + m.d + m.d + m.d + m.d); }                      // days    e.g. 11111
  function fecho(a) { a = a || {}; return '[f=' + (a.p_asset || '-') + '/' + (a.p_type || '-') + '/' + (a.p_days == null ? 'all' : a.p_days) + ']'; }
  function gecho(a) { a = a || {}; return '[g=' + (a.p_asset || '-') + '/' + (a.p_type || '-') + ']'; }

  var LISTING_RPC = ['market_kpis', 'market_signals', 'market_filtered', 'districts_filtered', 'district_profile', 'district_profile_filtered',
    'market_by_bedroom', 'market_dom', 'market_dom_summary', 'listed_area'];
  var LISTING_TABLE = ['properties', 'market_averages', 'market_reports', 'market_snapshots'];

  // ── weekly market_snapshots history ──────────────────────────────────────
  // Two flavours. Under the rapid-switch runner (?test=rapid|scenarios) every
  // value carries the market's sentinel digit run, so a series drawn for the
  // wrong market -- or for a held one -- is found by the same text search as
  // every other figure. Otherwise the series is realistic: plausible levels,
  // slow drift and noise, the real snapshot calendar (two missing weeks, a
  // Wednesday snapshot on 9 Sep), carried-forward weeks in August, USD only
  // from 9 Sep (when the snapshot began storing its FX rate), and small
  // cities whose weekly sample sometimes falls under 10 listings.
  var SENTINEL = /^(rapid|scenarios)$/.test(qs.get('test') || '');
  var SNAP_FULL = ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24',
    '2026-09-09', '2026-09-14', '2026-09-21', '2026-10-05'];
  var SNAP_SHORT = ['2026-09-09', '2026-09-14', '2026-09-21', '2026-10-05'];
  var SNAP_FX = { MAD: [9.39, 9.40, 9.54, 9.92], TND: [2.93, 2.94, 2.97, 3.02], KES: [129.2, 129.1, 129.3, 129.4], EGP: [48.4, 48.6, 48.9, 49.3] };
  var SNAPR = {
    Morocco: { cur: 'MAD', dates: SNAP_FULL, cities: [
      { c: 'Casablanca', s: 15940, r: 115.4, n: 2158, nr: 2416, d: -0.0035 }, { c: 'Rabat', s: 13850, r: 98.2, n: 1240, nr: 1310, d: 0.0012 },
      { c: 'Marrakech', s: 12600, r: 92.5, n: 1105, nr: 870, d: 0.0021 }, { c: 'Tangier', s: 10900, r: 78.0, n: 640, nr: 520, d: 0.0008 },
      { c: 'Agadir', s: 9800, r: 70.4, n: 410, nr: 9, d: -0.001 }, { c: 'Fes', s: 8200, r: 55.1, n: 280, nr: 7, d: 0.0015 }] },
    Tunisia: { cur: 'TND', dates: SNAP_FULL, cities: [
      { c: 'Tunis', s: 3150, r: 13.2, n: 1820, nr: 960, d: 0.0018 }, { c: 'Ariana', s: 2950, r: 12.1, n: 990, nr: 610, d: 0.0011 },
      { c: 'Sousse', s: 2700, r: 11.0, n: 720, nr: 380, d: 0.0024 }, { c: 'Nabeul', s: 2400, r: 10.5, n: 430, nr: 140, d: -0.0006 },
      { c: 'Sfax', s: 2250, r: 9.4, n: 310, nr: 8, d: 0.0009 }] },
    Kenya: { cur: 'KES', dates: SNAP_FULL, cities: [
      { c: 'Nairobi', s: 165000, r: 720, n: 640, nr: 1180, d: 0.0007 }, { c: 'Mombasa', s: 118000, r: 520, n: 120, nr: 210, d: -0.0012 },
      { c: 'Kiambu', s: 92000, r: 400, n: 60, nr: 11, d: 0.002 }] },
    Egypt: { cur: 'EGP', dates: SNAP_SHORT, cities: [
      { c: 'Cairo', s: 52000, r: 310, n: 2900, nr: 1400, d: 0.004 }, { c: 'Giza', s: 47000, r: 280, n: 1500, nr: 700, d: 0.003 },
      { c: 'Alexandria', s: 38000, r: 230, n: 900, nr: 320, d: 0.002 }] }
  };
  var SNAP_ASSET = { apartments: ['Apartments', 1, 1, 1], villas: ['Villas', 1.42, 1.3, 0.22], houses: ['Houses', 0.94, 0.88, 0.35],
    offices: ['Offices', 1.16, 1.38, 0.18], land: ['Land', 0.28, 0.05, 0.3] };
  function jit(key) { return (h32(key) % 2001) / 1000 - 1; }   // deterministic, -1..1
  function snapRows(country, assetPat) {
    var a = String(assetPat || '').toLowerCase(), out = [];
    if (SENTINEL) {
      var m = MK[country]; if (!m) return [];
      SNAP_FULL.forEach(function (d, i) {
        var rep = i === 5 || i === 6 ? 4 : i;   // carried-forward August weeks
        m.cities.forEach(function (c, ci) {
          ['sale', 'rent'].forEach(function (tt) {
            var v = tt === 'sale' ? P(m, 50 + rep % 9) : P(m, 10 + rep % 9);
            var n = ci === 1 && rep % 4 === 1 ? 7 : 40 + rep + ci;
            out.push({ snapshot_date: d, city: c, asset_class: SNAP_ASSET[a] ? SNAP_ASSET[a][0] : a, transaction_type: tt,
              median_ppsqm: v, listing_count: n, currency: i >= 7 ? m.cur : null, median_ppsqm_usd: i >= 7 ? v : null });
          });
        });
      });
      return out;
    }
    var S = SNAPR[country], A = SNAP_ASSET[a]; if (!S || !A) return [];
    S.dates.forEach(function (d, i) {
      var k = i, fi = SNAP_SHORT.indexOf(d);
      if (S.dates === SNAP_FULL && (i === 5 || i === 6)) k = 4;   // the run did not refresh: same figures as 10 Aug
      var dd = S.dates[k];
      S.cities.forEach(function (c) {
        ['sale', 'rent'].forEach(function (tt) {
          var base = (tt === 'sale' ? c.s * A[1] : c.r * A[2]);
          var shift = dd >= '2026-09-21' ? (tt === 'sale' ? 0.988 : 1.006) : 1;   // parser fix moves the level
          var v = base * (1 + c.d * k + 0.006 * jit(country + c.c + tt + dd)) * shift;
          var n0 = tt === 'sale' ? c.n : c.nr;
          var n = n0 < 20 ? Math.max(3, Math.round(n0 + 4 * jit('n' + country + c.c + tt + dd)))
            : Math.max(1, Math.round(n0 * A[3] * (1 + 0.031 * k)));
          var fx = fi > -1 ? SNAP_FX[S.cur][fi] : null;
          out.push({ snapshot_date: d, city: c.c, asset_class: A[0], transaction_type: tt,
            median_ppsqm: Math.round(v * 100) / 100, listing_count: n, currency: fx ? S.cur : null,
            fx_units_per_usd: fx, median_ppsqm_usd: fx ? Math.round(v / fx * 100) / 100 : null });
        });
      });
    });
    return out;
  }

  var log = [], pending = 0, violations = [], nreq = 0, HIDE = {}, FAILQ = {};
  window.__stub = {
    log: log, violations: violations,
    get pending() { return pending; },
    held: HELD,
    hold: function (c) { HELD[c] = 1; return c; },
    release: function (c) { delete HELD[c]; return c; },
    isHeld: function (c) { return !!HELD[c]; },
    // held in fact, but not named by data_status -- the case where a refusal
    // teaches the page something the status read does not know
    hideFromStatus: function (c) { HIDE[c] = 1; return c; },
    showInStatus: function (c) { delete HIDE[c]; return c; },
    setLatency: function (name, ms) { LATO[name] = ms; },
    clearLatency: function () { LATO = {}; },
    fail: function (name, country, times) { FAILQ[name + '|' + (country || '')] = times || 1; }
  };

  function knownHeld(country) {
    try { return !!(country && typeof window._isHeld === 'function' && window._isHeld(country)); } catch (e) { return false; }
  }
  function answer(kind, name, country, payload, listing) {
    var i = ++nreq, t0 = Date.now(), kh = knownHeld(country);
    var rec = { i: i, kind: kind, name: name, country: country || null, t0: t0, dt: null, knownHeld: kh, stubHeld: !!(country && HELD[country]), listing: !!listing };
    log.push(rec);
    if (listing && kh) violations.push({ i: i, name: name, country: country, why: 'listing request sent for a market the page knows is held' });
    pending++;
    var d = latFor(name, kind + ':' + name + ':' + (country || ''));
    var fk = name + '|' + (country || '');
    var body;
    if (FAILQ[fk] > 0) { FAILQ[fk]--; body = { data: null, status: 500, error: { message: 'stub failure' } }; }
    else body = payload();      // computed when the request is made, like a server would
    return new Promise(function (res) {
      setTimeout(function () { pending--; rec.dt = Date.now() - t0; res(body); }, d);
    });
  }
  function ok(d) { return { data: d, error: null, status: 200 }; }
  function heldAnswer(c) {
    return { data: null, status: 423, error: { code: 'PT423', message: 'market_held', details: NOTE(c),
      hint: 'held since 2026-09-17; this view is unavailable until an approved dataset is released' } };
  }

  // ── payloads ───────────────────────────────────────────────────────────────
  function kpis(k) {
    var m = MK[k];
    if (!m) return { total_count: 0, dedup_count: 0, raw_count: 0, cities: [], city_class: [], districts: [], quarters: [], city_quarters: [] };
    var cities = m.cities.map(function (c, i) {
      return { city: c, geography_valid: true, listings: 57 - i * 14,
        sale_count: 40 - i * 10, rent_count: 17 - i * 4,
        sale_median: P(m, 70 - i * 8), rent_median: R(m, 9 - i * 2) };
    });
    var cc = [];
    m.cities.forEach(function (c, i) {
      ['apartments', 'villas', 'offices'].forEach(function (ac, j) {
        cc.push({ city: c, ac: ac, tt: 'sale', med: P(m, 71 - i * 6 - j), count: 31 - j * 7 - i });
        cc.push({ city: c, ac: ac, tt: 'rent', med: R(m, 9 - j), count: 19 - j * 4 - i });
      });
    });
    return {
      total_count: C(m), dedup_count: 90210, raw_count: 90210,
      coverage: { total_count: C(m), priced_count: 90210 },
      median_sale: P(m, 50), median_rent: R(m, 5),
      prime_office_rent: R(m, 7), prime_office_rent_count: 42,
      cities: cities, city_class: cc,
      districts: [{ submarket: m.tag + ' Prime District', city: m.cities[0], med: P(m, 60), count: 21 }],
      quarters: [], city_quarters: []
    };
  }
  function signals(k) {
    var m = MK[k];
    if (!m) return { ios_score: null, gross_yield_pct: null, liquidity_score: null, price_momentum_pct: null,
      momentum_ready: false, supply_change_pct: null, total_listings: 0, listing_count: 0, as_of: '2026-09-15', snapshots: 1 };
    return { ios_score: 55, gross_yield_pct: 6.1, liquidity_score: 41, price_momentum_pct: null, momentum_ready: false,
      supply_change_pct: null, total_listings: C(m), listing_count: C(m), as_of: '2026-09-15', snapshots: 1 };
  }
  function districts(k, a) {
    var m = MK[k]; if (!m) return [];
    var e = fecho(a);
    return [
      { submarket: m.tag + ' Kilimani ' + e,  city: m.cities[0], listings: 25, median_ppsqm: P(m, 60), lat: m.ll[0][0] + 0.02, lng: m.ll[0][1] + 0.02 },
      { submarket: m.tag + ' Westlands ' + e, city: m.cities[0], listings: 18, median_ppsqm: P(m, 62), lat: m.ll[0][0] - 0.03, lng: m.ll[0][1] + 0.05 },
      { submarket: m.tag + ' Seafront ' + e,  city: m.cities[m.cities.length - 1], listings: 12, median_ppsqm: P(m, 58),
        lat: m.ll[m.ll.length - 1][0] + 0.01, lng: m.ll[m.ll.length - 1][1] - 0.02 }
    ];
  }
  function filtered(k) {
    var m = MK[k]; if (!m) return { sale: { median: null, count: 0, cities: [] }, rent: { median: null, count: 0, cities: [] } };
    return {
      sale: { median: P(m, 50), count: 50, cities: m.cities.map(function (c, i) { return { city: c, n: 30 - i * 9, med: P(m, 70 - i * 8) }; }) },
      rent: { median: R(m, 5), count: 20, cities: m.cities.map(function (c, i) { return { city: c, n: 20 - i * 6, med: R(m, 9 - i * 2) }; }) }
    };
  }
  function profile(k, a) {
    var m = MK[k]; if (!m) return null;
    return { count: 20, priced: 18, p10: P(m, 10), p25: P(m, 25), p50: P(m, 50), p75: P(m, 75), p90: P(m, 90),
      sale_count: 15, rent_count: 5, size_med: 120, size_n: 9,
      mix: [{ ac: (a && a.p_tt === 'rent' ? 'apartments' : 'apartments'), n: 18 }, { ac: 'villas', n: 6 }],
      beds: [{ b: 2, n: 10 }, { b: 3, n: 8 }], coords: { lat: m.ll[0][0], lng: m.ll[0][1] } };
  }
  function bedrooms(k) {
    var m = MK[k]; if (!m) return [];
    var out = [];
    m.cities.forEach(function (c, i) {
      [2, 3].forEach(function (b, j) {
        out.push({ city: c, bedrooms: b, n: 40 - i * 11 - j * 5, median_price: P(m, 52 + j), p25: P(m, 42 + j),
          p75: P(m, 62 + j), median_ppsqm: P(m, 55 + j), n_with_area: 30 - i * 8 });
      });
    });
    return out;
  }
  function dom(k, a) {
    var m = MK[k]; if (!m) return [];
    var e = gecho(a);
    return [
      { city: m.cities[0], asset_class: (a && a.p_asset) + ' ' + e, transaction_type: (a && a.p_type) || 'sale',
        n_delisted: 34, median_dom_days: D5(m), p25_days: 7, p75_days: 21, n_still_listed: 12, median_age_days: 30, coverage: 0.81, reliable: true },
      { city: m.cities[m.cities.length - 1], asset_class: (a && a.p_asset) + ' ' + e, transaction_type: (a && a.p_type) || 'sale',
        n_delisted: 17, median_dom_days: D5(m), p25_days: 7, p75_days: 28, n_still_listed: 7, median_age_days: 44, coverage: 0.42, reliable: false }
    ];
  }
  function statusRows() {
    return LIVE.map(function (k) {
      var h = !!HELD[k] && !HIDE[k];
      return { country: k, last_published_at: '2026-09-15T10:00:00Z', coverage: 'full',
        last_run_status: 'succeeded', last_run_at: '2026-09-15T10:00:00Z', stale: false,
        held: h, held_since: h ? '2026-09-17T15:15:00Z' : null, held_note: h ? NOTE(k) : null };
    });
  }

  function rpc(name, args) {
    args = args || {};
    var c = args.p_country || null;
    var listing = LISTING_RPC.indexOf(name) > -1 && !!c;
    return answer('rpc', name, c, function () {
      if (name === 'data_status') return ok(statusRows());
      if (c && HELD[c] && LISTING_RPC.indexOf(name) > -1) return heldAnswer(c);
      if (name === 'market_kpis') return ok(kpis(c));
      if (name === 'market_signals') return ok(signals(c));
      if (name === 'districts_filtered') return ok(districts(c, args));
      if (name === 'market_filtered') return ok(filtered(c));
      if (name === 'district_profile' || name === 'district_profile_filtered') return ok(profile(c, args));
      if (name === 'market_by_bedroom') return ok(bedrooms(c));
      if (name === 'market_dom') return ok(dom(c, args));
      if (name === 'market_dom_summary') { var m = MK[c]; return ok(m ? [{ n_delisted: 51, median_dom_days: D5(m) }] : []); }
      if (name === 'listed_area') return ok([]);
      return ok([]);
    }, listing);
  }

  function tableRows(table, f) {
    var c = f.country || null, m = MK[c];
    if (table === 'market_news') {
      if (!m) return [];
      var rows = [
        { title: m.ntag + ' metro line extension approved', url: 'https://example.invalid/1', source: m.ntag + ' Wire',
          category: 'infrastructure', is_pipeline: true, published_at: '2026-09-12', summary: m.ntag + ' new rail corridor works begin' },
        { title: m.ntag + ' central bank holds rate', url: 'https://example.invalid/2', source: m.ntag + ' Daily',
          category: 'macro', is_pipeline: false, published_at: '2026-09-10', summary: m.ntag + ' policy rate unchanged' }
      ];
      if (f.category) rows = rows.filter(function (r) { return r.category === f.category; });
      return rows;
    }
    if (table === 'pipeline_projects') {
      if (!m) return [];
      var pr = [
        { project_name: m.ntag + ' Riverside Tower', developer: m.ntag + ' Developments', city: m.cities[0], asset_class: 'offices',
          quantum_value: 42000, quantum_unit: 'sqm_gfa', stage: 'under_construction', expected_delivery: 'Q3 2027', citations: [{ url: 'https://example.invalid/p1' }] },
        { project_name: m.ntag + ' Ring Road Phase 2', developer: m.ntag + ' Works', city: m.cities[0], asset_class: 'infrastructure',
          quantum_value: 310000000, quantum_unit: 'usd', stage: 'announced', expected_delivery: '2028', citations: [{ url: 'https://example.invalid/p2' }] }
      ];
      if (f.asset_class) pr = pr.filter(function (r) { return r.asset_class === f.asset_class; });
      return pr;
    }
    if (table === 'market_research_stats') {
      if (!m) return [];
      return [{ country: c, city: m.cities[0], metric: 'total_stock', asset_class: 'offices', value: 480000, unit: 'sqm',
        as_of: '2025', publisher: m.ntag + ' Research', url: 'https://example.invalid/r1', quote: m.ntag + ' published stock figure' },
        { country: c, city: m.cities[0], metric: 'occupancy_pct', asset_class: 'offices', value: 82, unit: 'pct',
          as_of: '2025', publisher: m.ntag + ' Research', url: 'https://example.invalid/r2', quote: m.ntag + ' occupancy figure' }];
    }
    if (table === 'macro_stats') {
      if (!m) return [];
      return [{ country: c, metric: 'ttdi_score', dim: null, value: 3.9, unit: 'score', as_of: '2024', publisher: m.ntag + ' WEF' }];
    }
    if (table === 'market_reports') {
      if (!m || HELD[c]) return [];   // withheld with the figures they are drawn from
      return [{ period: '2026-08', title: m.tag + ' Monthly Market Report', pdf_url: null,
        summary: m.tag + ' median asking ' + P(m, 50).toLocaleString('en-US') + ' per m2.' }];
    }
    if (table === 'market_averages') {
      if (!m || HELD[c]) return [];
      return m.cities.map(function (x) { return { city: x, median_ppsqm: P(m, 60) }; });
    }
    if (table === 'properties') {
      if (f.cols && f.cols.indexOf('scraped_at') === 0 && !c) return [{ scraped_at: '2026-09-15T08:00:00Z' }];
      if (!m || HELD[c]) return [];
      return m.cities.map(function (x, i) {
        return { city: x, submarket: MK[c].tag + ' Kilimani', asset_class: 'apartments', transaction_type: 'sale',
          price_per_sqm: P(m, 60 + i), scraped_at: '2026-09-15T08:00:00Z' };
      });
    }
    if (table === 'market_snapshots') {
      // the cross-market overview's first/last snapshot date probe
      if (!c && f.cols === 'snapshot_date') return [{ snapshot_date: '2026-09-08' }];
      if (!c || HELD[c]) return [];   // RLS hides a held market's rows
      var sr = snapRows(c, f.asset_ilike).filter(function (r) {
        return (!f.tts || f.tts.indexOf(r.transaction_type) > -1) && (f.neq_city == null || r.city !== f.neq_city);
      }).sort(function (a, b) { return a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : (a.city < b.city ? -1 : 1); });
      return f.range ? sr.slice(f.range[0], f.range[1] + 1) : sr;
    }
    if (table === 'usage_events') return [];
    return [];
  }

  function qb(table) {
    var f = { country: null, cols: null, category: null, asset_class: null };
    var q = {};
    ['select', 'eq', 'order', 'limit', 'ilike', 'not', 'gt', 'insert', 'in', 'lt', 'gte', 'lte', 'range', 'neq'].forEach(function (mth) {
      q[mth] = function (a, b) {
        if (mth === 'select' && typeof a === 'string') f.cols = a;
        if ((mth === 'eq' || mth === 'ilike') && a === 'country') f.country = b;
        if (mth === 'eq' && a === 'category') f.category = b;
        if (mth === 'eq' && a === 'asset_class') f.asset_class = b;
        if (mth === 'ilike' && a === 'asset_class') f.asset_ilike = b;
        if (mth === 'in' && a === 'transaction_type') f.tts = b;
        if (mth === 'neq' && a === 'city') f.neq_city = b;
        if (mth === 'range') f.range = [a, b];
        return q;
      };
    });
    q.then = function (res, rej) {
      var listing = LISTING_TABLE.indexOf(table) > -1 && !!f.country;
      return answer('from', table, f.country, function () { return ok(tableRows(table, f)); }, listing).then(res, rej);
    };
    q.catch = function (fn) { return q.then(function (v) { return v; }).catch(fn); };
    q.finally = function (fn) { return q.then(function (v) { return v; }).finally(fn); };
    return q;
  }

  // ── network stubs: FX and the World Bank, so the test never waits on the net ──
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('open.er-api.com') > -1) {
      return answer('fetch', 'fx', null, function () {
        return { ok: true, json: function () { return Promise.resolve({ rates: { USD: 1, KES: 1, MAD: 1, TND: 1, NGN: 1, EGP: 1, ZAR: 1, UGX: 1, ETB: 1 } }); } };
      }, false);
    }
    var wb = /api\.worldbank\.org\/v2\/country\/([A-Z]{2})\/indicator\/([^?]+)/.exec(u);
    if (wb) {
      return answer('fetch', 'wb:' + wb[1], null, function () {
        return { ok: true, json: function () {
          return Promise.resolve([{ page: 1 }, [{ date: '2024', value: 12.5 }, { date: '2023', value: 11.5 }]]);
        } };
      }, false);
    }
    return realFetch ? realFetch(url, opts) : Promise.reject(new Error('no fetch'));
  };

  window.supabase = {
    createClient: function () {
      return {
        rpc: rpc,
        from: qb,
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'u1', email: 'tester@example.com', user_metadata: { full_name: 'Test User' } } } } }); },
          signOut: function () { return Promise.resolve({}); },
          signInWithPassword: function () { return Promise.resolve({ error: null }); },
          resetPasswordForEmail: function () { return Promise.resolve({}); },
          updateUser: function () { return Promise.resolve({ error: null }); }
        }
      };
    }
  };
})();
