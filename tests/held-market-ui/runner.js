/* Rapid-switching test runner for the held-market UI.
 *
 * Injected by server.js when the URL carries ?test=rapid&seed=N&steps=M. It
 * drives the real page through M random actions -- switching markets (held and
 * available), navigating every market page, changing the asset / type / period
 * filters, toggling the currency, holding a market mid-run and releasing it --
 * then waits for every request to settle and checks what is on screen.
 *
 * What it looks for, in one sentence: no answer from another market, from an
 * older filter, or from a market on hold may reach the page or a shared cache.
 *
 * Publishes window.__testResult = {seed, steps, pass, failures:[...], requests}
 */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var MODE = qs.get('test');
  if (MODE !== 'rapid' && MODE !== 'scenarios') return;
  var SEED = parseInt(qs.get('seed') || '1', 10) || 1;
  var STEPS = parseInt(qs.get('steps') || '40', 10) || 40;
  var GAP = parseInt(qs.get('gap') || '60', 10);
  try { localStorage.removeItem('iw_ccy'); } catch (e) {}

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rnd = mulberry32(SEED);
  function pick(a) { return a[Math.floor(rnd() * a.length) % a.length]; }

  var MK = {
    Kenya: { d: '1', tag: 'ZQKE', ntag: 'ZNKE' },
    Morocco: { d: '2', tag: 'ZQMA', ntag: 'ZNMA' },
    Tunisia: { d: '3', tag: 'ZQTN', ntag: 'ZNTN' },
    Ethiopia: { d: '9', tag: 'ZQET', ntag: 'ZNET' }
  };
  var KEYS = Object.keys(MK);
  var SWITCHABLE = ['Morocco', 'Kenya', 'Tunisia', 'Ethiopia'];
  var PAGES = ['market-terminal', 'markets', 'cities', 'districts', 'by-bedroom', 'days-on-market', 'map-view',
    'heatmaps', 'data-explorer', 'exports', 'insights', 'liquidity-index', 'investment-radar', 'market-reports'];
  var LISTING_PAGES = ['pg-markets', 'pg-cities', 'pg-districts', 'pg-by-bedroom', 'pg-days-on-market', 'pg-map-view',
    'pg-heatmaps', 'pg-data-explorer', 'pg-exports', 'pg-insights', 'pg-liquidity-index', 'pg-investment-radar', 'pg-market-reports'];
  var CROSS_PAGES = ['pg-market-terminal', 'pg-countries'];

  var failures = [], trace = [], seenFail = {};
  function fail(kind, msg, extra) {
    var key = kind + '|' + msg;
    if (seenFail[key]) { seenFail[key]++; return; }
    seenFail[key] = 1;
    failures.push({ kind: kind, msg: msg, step: trace.length, extra: extra || null });
  }
  window.addEventListener('error', function (e) { fail('page-error', 'uncaught: ' + (e && e.message)); });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; fail('page-error', 'unhandled rejection: ' + ((r && r.message) || r));
  });

  // ── reading the page ───────────────────────────────────────────────────────
  function clean(t) { t = String(t || ''); for (var i = 0; i < 3; i++) t = t.replace(/(\d),(\d{3})/g, '$1$2'); return t; }
  function hasDigits(txt, k) { var d = MK[k].d; return txt.indexOf(d + d + d + d + d) > -1; }
  function hasListing(txt, k) { return hasDigits(txt, k) || txt.indexOf(MK[k].tag) > -1; }
  function hasAny(txt, k) { return hasListing(txt, k) || txt.indexOf(MK[k].ntag) > -1; }
  // ACTIVE_COUNTRY and COUNTRIES are `let`/`const` in the page: shared with this
  // script through the global lexical scope, but not properties of window.
  function active() { try { return ACTIVE_COUNTRY; } catch (e) { return null; } }
  function countries() { try { return COUNTRIES; } catch (e) { return {}; } }
  function isHeld(k) { try { return !!window._isHeld(k); } catch (e) { return false; } }
  function heldNow() { return KEYS.filter(isHeld); }
  function activePg() { return document.querySelector('.pg.active'); }
  function pgOf(node) { while (node) { if (node.nodeType === 1 && node.classList && node.classList.contains('pg')) return node; node = node.parentNode; } return null; }

  // ── the running check: every write into a page container ───────────────────
  function checkContainer(pg) {
    if (!pg || !pg.id) return;
    var raw = pg.textContent || '', txt = clean(raw), A = active();
    if (CROSS_PAGES.indexOf(pg.id) > -1) {
      heldNow().forEach(function (k) {
        if (hasListing(txt, k)) fail('held-figure-cross', k + ' figures drawn on ' + pg.id + ' while it is on hold');
      });
      return;
    }
    KEYS.forEach(function (k) {
      if (k === A) return;
      if (hasAny(txt, k)) fail('foreign-market', k + ' content drawn in ' + pg.id + ' while ' + A + ' is the selected market');
    });
    if (isHeld(A) && hasListing(txt, A)) fail('held-figure', A + ' figures drawn in ' + pg.id + ' while it is on hold');
  }
  function installObserver() {
    var root = document.getElementById('content') || document.body;
    new MutationObserver(function (muts) {
      var set = [];
      muts.forEach(function (m) { var p = pgOf(m.target); if (p && set.indexOf(p) < 0) set.push(p); });
      set.forEach(checkContainer);
    }).observe(root, { childList: true, subtree: true, characterData: true });
  }

  // ── actions ────────────────────────────────────────────────────────────────
  function doSwitch() {
    var to = pick(SWITCHABLE.filter(function (m) { return m !== active(); }));
    trace.push('switch:' + to);
    var opt = document.getElementById('copt-' + to);
    if (opt) opt.click(); else window.switchCountry(to);
  }
  function doNav() {
    var id = pick(PAGES);
    trace.push('nav:' + id);
    window.nav(id);
  }
  function doFilter() {
    var r = rnd();
    if (r < 0.45) { var a = pick(['apartments', 'villas', 'offices']); trace.push('asset:' + a); window.setAsset(a); }
    else if (r < 0.8) { var t = pick(['sale', 'rent']); trace.push('type:' + t); window.setType(t); }
    else { var d = pick([90, 365, null]); trace.push('days:' + d); window.setPeriod(d); }
  }
  function doCcy() {
    var m = (window._ccyMode === 'usd') ? 'local' : 'usd';
    trace.push('ccy:' + m); window.setCcy(m);
  }
  function doStatus() { trace.push('status-read'); try { window.loadHolds(); } catch (e) {} }

  function step(i) {
    // scripted: hold a market mid-run, release it later (with a status read,
    // which is the only way a release reaches the page)
    if (i === Math.floor(STEPS * 0.35)) { trace.push('HOLD:Kenya'); window.__stub.hold('Kenya'); }
    if (i === Math.floor(STEPS * 0.70)) { trace.push('RELEASE:Kenya'); window.__stub.release('Kenya'); doStatus(); return; }
    var r = rnd();
    if (r < 0.30) doSwitch();
    else if (r < 0.66) doNav();
    else if (r < 0.84) doFilter();
    else if (r < 0.93) doCcy();
    else doStatus();
  }

  // ── settle and check ───────────────────────────────────────────────────────
  function settle(cb) {
    var quietSince = null, t0 = Date.now();
    (function poll() {
      var p = window.__stub.pending;
      if (p === 0) { if (quietSince == null) quietSince = Date.now(); }
      else quietSince = null;
      if (quietSince != null && Date.now() - quietSince > 1500) return cb(null);
      if (Date.now() - t0 > 40000) return cb('settle timeout with ' + p + ' requests outstanding');
      setTimeout(poll, 60);
    })();
  }

  function finalChecks() {
    var A = active(), held = isHeld(A), ap = activePg();
    var COUNTRIES = countries();
    var lbl = (COUNTRIES[A] || {}).label || A;

    // (a) the page on screen carries this market's marks and nobody else's
    if (!ap) fail('no-active-page', 'no .pg.active');
    else {
      checkContainer(ap);
      if (CROSS_PAGES.indexOf(ap.id) < 0) {
        var crumb = ap.querySelector('.crumb');
        if (crumb && crumb.textContent.indexOf(lbl) < 0)
          fail('label', 'breadcrumb on ' + ap.id + ' reads "' + crumb.textContent.trim() + '" while ' + lbl + ' is selected');
        if (window._EP && ap.querySelector('[data-iw-loading]'))
          fail('stuck-loading', ap.id + ' still shows its loading state after everything settled');
      }
      var mktLbl = document.getElementById('sb-mkt-label');
      if (mktLbl && mktLbl.textContent.indexOf(lbl) < 0) fail('label', 'market picker reads "' + mktLbl.textContent.trim() + '", expected ' + lbl);
      if (held && mktLbl && mktLbl.textContent.indexOf('on hold') < 0) fail('label', 'market picker does not say ' + lbl + ' is on hold');
    }

    // (b) a held market: every listing page says so and shows no figure
    if (held) {
      LISTING_PAGES.forEach(function (id) {
        var el = document.getElementById(id); if (!el) return;
        var txt = clean(el.textContent || '');
        if (txt.toLowerCase().indexOf('publication on hold') < 0)
          fail('held-page-missing', id + ' does not show the hold for ' + A);
        KEYS.forEach(function (k) { if (hasListing(txt, k)) fail('held-figure', k + ' figures on ' + id + ' while ' + A + ' is on hold'); });
      });
    }

    // (c) shared caches belong to the market on screen, or to nobody
    if (window._B2C != null && window._B2C !== A) fail('cache', '_B2C is ' + window._B2C + ' while ' + A + ' is selected');
    var k2 = window._B2K;
    if (k2) {
      var s = clean(JSON.stringify(k2));
      KEYS.forEach(function (k) { if (k !== A && hasListing(s, k)) fail('cache', '_B2K holds ' + k + ' figures while ' + A + ' is selected'); });
      if (held) fail('cache', '_B2K still holds figures while ' + A + ' is on hold');
    }
    var kpi = window._kpiInd || window._kpiYld;
    if (kpi) {
      var s2 = clean(JSON.stringify([window._kpiInd, window._kpiYld]));
      KEYS.forEach(function (k) { if (k !== A && hasListing(s2, k)) fail('cache', 'the indicator cache holds ' + k + ' rows while ' + A + ' is selected'); });
      if (held) fail('cache', 'the indicator cache still holds rows while ' + A + ' is on hold');
    }

    // (d) no listing request for a market already known to be held
    (window.__stub.violations || []).forEach(function (v) {
      fail('request-to-held', v.name + ' requested for ' + v.country + ' after the page knew it was on hold');
    });

    // (e) cross-market views never count a held market
    CROSS_PAGES.forEach(function (id) { var el = document.getElementById(id); if (el) checkContainer(el); });

    // (f)/(g) the page on screen matches the filters and currency in force
    if (ap && CROSS_PAGES.indexOf(ap.id) < 0 && !held) {
      var raw = ap.textContent || '', txt = clean(raw);
      var f = { asset: window._assetFilter || 'apartments', type: window._typeFilter || 'sale', days: window._periodFilter };
      var wantF = '[f=' + f.asset + '/' + f.type + '/' + (f.days == null ? 'all' : f.days) + ']';
      var wantG = '[g=' + f.asset + '/' + f.type + ']';
      (raw.match(/\[f=[^\]]*\]/g) || []).forEach(function (tok) {
        if (tok !== wantF) fail('stale-filter', ap.id + ' shows data for ' + tok + ' while the filters are ' + wantF);
      });
      (raw.match(/\[g=[^\]]*\]/g) || []).forEach(function (tok) {
        if (tok !== wantG) fail('stale-filter', ap.id + ' shows data for ' + tok + ' while the filters are ' + wantG);
      });
      var cur = (COUNTRIES[A] || {}).currency;
      if (cur && cur !== 'USD') {
        if (window._ccyMode === 'usd' && new RegExp(cur + '\\s?\\d').test(txt))
          fail('stale-currency', ap.id + ' shows ' + cur + ' figures while USD is selected');
        if (window._ccyMode === 'local' && /\$\s?\d/.test(txt))
          fail('stale-currency', ap.id + ' shows USD figures while ' + cur + ' is selected');
      }
    }

    // one live map, and it is the one on the page
    if (ap && ap.id === 'pg-map-view') {
      var maps = ap.querySelectorAll('.leaflet-container');
      if (maps.length > 1) fail('map', maps.length + ' maps left on the map page');
    }
  }

  function publish(err) {
    var res = {
      seed: SEED, steps: STEPS, pass: !err && failures.length === 0,
      failures: failures.slice(0, 40), requests: (window.__stub && window.__stub.log.length) || 0,
      error: err || null, market: active(), page: (activePg() || {}).id || null,
      held: heldNow(), trace: trace
    };
    window.__testResult = res;
    try {
      var box = document.createElement('div');
      box.id = 'iw-test-summary';
      box.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;max-width:560px;max-height:45vh;overflow:auto;' +
        'font:12px/1.5 ui-monospace,monospace;padding:10px 12px;border:2px solid ' + (res.pass ? '#3f7a52' : '#c0603a') +
        ';background:#10141C;color:#F3EEE4;';
      box.innerHTML = '<b>' + (res.pass ? 'PASS' : 'FAIL') + '</b> seed ' + SEED + ' · ' + STEPS + ' steps · ' +
        res.requests + ' requests · market ' + res.market + (err ? ' · ' + err : '') +
        (failures.length ? '<ul style="margin:6px 0 0 14px;padding:0;">' + failures.slice(0, 12).map(function (f) {
          return '<li>[' + f.kind + '] ' + String(f.msg).replace(/</g, '&lt;') + '</li>';
        }).join('') + '</ul>' : '');
      document.body.appendChild(box);
    } catch (e) {}
  }

  function run() {
    installObserver();
    var i = 0;
    (function next() {
      if (i >= STEPS) return settle(function (err) { try { finalChecks(); } catch (e) { fail('runner', String(e && e.stack || e)); } publish(err); });
      try { step(i); } catch (e) { fail('action', String((e && e.message) || e)); }
      i++;
      setTimeout(next, Math.floor(rnd() * GAP));
    })();
  }

  /* ── named scenarios ────────────────────────────────────────────────────────
     The random walk above finds races by volume; these reproduce the awkward
     orderings on purpose, by pinning the latency of single requests. One case
     per page load: ?test=scenarios&case=<name>. */
  var CASE = qs.get('case') || '';
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function settled() { return new Promise(function (r) { settle(function (e) { r(e); }); }); }
  function pageText(id) { var el = document.getElementById(id); return el ? clean(el.textContent || '') : ''; }
  function must(cond, kind, msg) { if (!cond) fail(kind, msg); }
  // Watch a hold for the whole case: once the page knows about it, it must not
  // disappear again (a release may only come from a newer status read).
  function watchHold(country) {
    var sawHeld = false, dropped = false;
    var iv = setInterval(function () {
      if (isHeld(country)) sawHeld = true;
      else if (sawHeld) dropped = true;
    }, 40);
    return function () { clearInterval(iv); return { sawHeld: sawHeld, dropped: dropped }; };
  }
  // The same thing seen from the request log: a listing request sent for a
  // market the page had already recorded as held, believing it no longer was.
  function releasedAfterHold(country) {
    var log = (window.__stub && window.__stub.log) || [], seen = false;
    for (var i = 0; i < log.length; i++) {
      var r = log[i]; if (r.country !== country || !r.listing) continue;
      if (r.knownHeld) seen = true;
      else if (seen) return r.name;
    }
    return null;
  }

  // pre-boot setup, before the page's own script has run a single request
  function preBoot() {
    if (CASE === 'lateboot') {
      // Ethiopia is held, but data_status does not say so and answers slowly:
      // the hold is learned from a refusal AFTER the read was sent.
      // slower than boot's 6 s race, so the terminal is already loading (and a
      // refusal has recorded the hold) by the time the read lands
      window.__stub.hideFromStatus('Ethiopia');
      window.__stub.setLatency('data_status', 8000);
    }
    if (CASE === 'loader-order') {
      // loadLiveKPIs' market_kpis answers first, loadBatch2's long after it
      window.__stub.setLatency('market_kpis', [0, 900]);
    }
  }

  var CASES = {
    // a deep link at boot draws the market that is selected, not "null"
    'deeplink': function () {
      return settled().then(function () {
        var t = pageText('pg-by-bedroom');
        must(t.indexOf('null') < 0, 'deeplink', 'the By Bedroom page names "null" instead of the selected market');
        must(hasListing(t, active()), 'deeplink', 'the By Bedroom page shows no figures for ' + active() + ' after a deep link');
      });
    },
    // a status read that left before the hold existed must not release it
    'lateboot': function () {
      var stop = watchHold('Ethiopia');
      return settled().then(function () {
        var w = stop();
        must(w.sawHeld, 'setup', 'the refusal never recorded the Ethiopia hold');
        must(!w.dropped, 'hold-release', 'a slow data_status read released a hold that a refusal had recorded after the read was sent');
        var rel2 = releasedAfterHold('Ethiopia');
        must(!rel2, 'hold-release', 'after the hold was recorded, ' + rel2 + ' was requested for Ethiopia again -- the hold had been released');
        must(isHeld('Ethiopia'), 'hold-release', 'Ethiopia is not on hold at the end of the run');
      });
    },
    // two status reads answering in reverse order: the older one releases nothing
    'status-order': function () {
      var stop = null;
      window.__stub.hold('Tunisia');
      window.switchCountry('Tunisia');                    // learn the hold from a refusal
      return wait(1200).then(function () {
        must(isHeld('Tunisia'), 'setup', 'Tunisia was not recorded as held');
        stop = watchHold('Tunisia');
        window.__stub.release('Tunisia');
        window.__stub.setLatency('data_status', [2000, 200]);
        window.loadHolds();                               // read A: not held, answers last
        return wait(60);
      }).then(function () {
        window.__stub.hold('Tunisia');
        window.loadHolds();                               // read B: held, answers first
        return settled();
      }).then(function () {
        var w = stop();
        must(!w.dropped, 'hold-release', 'the older data_status read released a hold that a later read and a refusal had confirmed');
        var rel = releasedAfterHold('Tunisia');
        must(!rel, 'hold-release', 'after the hold was recorded, ' + rel + ' was requested for Tunisia again -- the hold had been released');
        must(isHeld('Tunisia'), 'hold-release', 'Tunisia is not on hold at the end of the run');
      });
    },
    // a retry drawn for one market, clicked after switching to another
    'old-retry': function () {
      window.__stub.fail('market_kpis', 'Kenya', 4);
      window.switchCountry('Kenya');
      return wait(1500).then(function () {
        window.switchCountry('Tunisia');
        return wait(400);
      }).then(function () {
        var b = document.getElementById('iw-data-banner');
        if (b) { var btn = b.querySelector('button'); if (btn) btn.click(); }
        return settled();
      }).then(function () {
        must(active() === 'Tunisia', 'setup', 'expected Tunisia to be selected');
        must(window._B2C == null || window._B2C === 'Tunisia', 'old-retry', 'a retry for Kenya reloaded Kenya while Tunisia was selected (_B2C=' + window._B2C + ')');
        var ap = activePg(); if (ap) checkContainer(ap);
      });
    },
    // the market summary lands, then a refusal, then the listing sample:
    // the hold stands and nothing is exported
    'hold-mid-load': function () {
      window.switchCountry('Kenya');
      return wait(1200).then(function () {
        window.__stub.setLatency('properties', 2500);
        window.__stub.hold('Kenya');
        window.nav('districts');                        // the refusal that teaches the page
        return settled();
      }).then(function () {
        must(isHeld('Kenya'), 'setup', 'Kenya was not recorded as held');
        must(pageText('pg-districts').toLowerCase().indexOf('publication on hold') > -1, 'held-page-missing', 'the Districts page does not show the hold');
        must(!window._B2K, 'cache', '_B2K still holds Kenya figures after the hold');
        must(!window._kpiInd, 'cache', 'the indicator cache still holds Kenya rows after the hold');
        var clicked = 0, realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { clicked++; };
        try { window.exportAgg('cities'); } catch (e) {}
        HTMLAnchorElement.prototype.click = realClick;
        must(clicked === 0, 'export', 'exportAgg downloaded a CSV for a market on hold');
      });
    },
    // the KPI loader finishing first must not throw away the batch loader
    'loader-order': function () {
      window.switchCountry('Kenya');
      return settled().then(function () {
        must(window._B2C === 'Kenya' && !!window._B2K, 'loader-order', 'the market summary was discarded when the KPI loader finished first (_B2C=' + window._B2C + ')');
        must(pageText('pg-districts').indexOf('11111') > -1 || pageText('pg-markets').indexOf('11111') > -1,
          'loader-order', 'no market page was drawn after the summary landed');
      });
    },
    // a currency change while the Coverage Registry is loading: one currency per table
    'registry-currency': function () {
      window.__stub.setLatency('market_kpis', 400);
      window.switchCountry('Kenya');                    // starts the registry loop
      return wait(700).then(function () {
        window.setCcy(window._ccyMode === 'usd' ? 'local' : 'usd');
        return settled();
      }).then(function () {
        var el = document.getElementById('pg-countries');
        var cells = el ? Array.prototype.slice.call(el.querySelectorAll('td.mono')) : [];
        var usd = 0, loc = 0;
        cells.forEach(function (c) { var t = c.textContent || ''; if (/\$/.test(t)) usd++; else if (/[A-Z]{3}\s?\d/.test(t)) loc++; });
        must(usd === 0 || loc === 0, 'registry-currency', 'the Coverage Registry mixes currencies (' + usd + ' USD rows, ' + loc + ' local rows)');
      });
    }
  };

  function runScenario() {
    var fn = CASES[CASE];
    if (!fn) { fail('runner', 'unknown scenario "' + CASE + '"'); return publish('unknown case'); }
    trace.push('case:' + CASE);
    installObserver();
    Promise.resolve().then(fn).then(function () { publish(null); },
      function (e) { fail('runner', String((e && e.stack) || e)); publish('threw'); });
  }

  // start once boot has handed the terminal over
  preBoot();
  var t0 = Date.now();
  (function waitBoot() {
    var booted = (typeof window._holdsBooted !== 'undefined' && window._holdsBooted);
    var ld = document.getElementById('loader');
    if (booted && (!ld || ld.classList.contains('out') || ld.style.display === 'none')) return MODE === 'rapid' ? run() : runScenario();
    if (Date.now() - t0 > 30000) { fail('boot', 'the terminal did not finish booting within 30 s'); return publish('boot timeout'); }
    setTimeout(waitBoot, 50);
  })();

  // never let a run hang the batch
  setTimeout(function () { if (!window.__testResult) { fail('timeout', 'run did not finish within 150 s'); publish('timeout'); } }, 150000);
})();
