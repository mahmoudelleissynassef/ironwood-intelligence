# Held-market UI — rapid-switching test

A deterministic browser test for one rule in `dashboard.html`:

> **An answer is drawn only if the market, page, filter state and currency it
> was requested for are still the ones on screen — and never at all for a market
> whose publication is on hold.**

It drives the **real** page. `server.js` generates its copy at start-up from
`dashboard.html` on disk and changes exactly two things: the supabase-js
`<script>` becomes `/stub.js`, and `/runner.js` is added when the URL asks for a
test run. Nothing in the page's own markup or script is rewritten, so a guard
that exists only in the test cannot make the test pass.

## Running it

For the offline data-quality and response-order regressions, run
`node --test tests/dashboard-data-quality.test.js` from the repository root.

For a headless sweep of the seven scenarios and three rapid-switch seeds, run
`node tests/held-market-ui/run-headless.js` with Playwright on `NODE_PATH`.
Set `IW_TEST_BROWSER` to an existing Chrome/Edge executable if Playwright's
bundled browser is unavailable. This uses the fake client and blocks production
Supabase requests; it does not install browsers or create production data.

```sh
cd tests/held-market-ui
node server.js                 # prints: IWTEST listening <port>
```

Then open one run, or a batch of seeds:

```
http://127.0.0.1:<port>/dashboard?test=rapid&seed=7&steps=40
http://127.0.0.1:<port>/batch?from=1&to=30&steps=40
```

A single run publishes `window.__testResult`:

```js
{ seed, steps, pass, failures: [{kind, msg, step}], requests, market, page, held, trace }
```

and draws a green (pass) or red (fail) summary box in the corner. The batch page
publishes `window.__batchResult = {done, results: [...]}` and prints one line per
seed, so a whole sweep can be read with a single query.

Options: `steps` (actions per run), `seed` (chooses the actions and the latency
of every request), `lat` (maximum simulated latency in ms, default 700 — `lat=0`
makes every answer immediate), `gap` (maximum pause between actions, default 60).

### Against the pre-change page

`--page` points the server at any copy of the dashboard, which is how the same
seeds are run against the version before the guards were added:

```sh
git show HEAD:dashboard.html > /tmp/old-dashboard.html
node server.js --port 8942 --page /tmp/old-dashboard.html
```

## What a run does

`runner.js` performs `steps` random actions, 0–60 ms apart, all chosen from the
seed: switch market (Morocco, Kenya, Tunisia, and the held Ethiopia), navigate
any market page (overview, markets, cities, districts, by bedroom, days on
market, map, heatmaps, data explorer, exports, insights, liquidity index,
investment radar, market reports), change the asset / type / period filter,
toggle the currency, re-read `data_status`. Two actions are scripted: Kenya is
put on hold about a third of the way in, and released about two thirds in
(a release only reaches the page through a status read, so one follows).

Then it waits for every request to settle (plus a margin) and checks:

| # | Check | Failure kinds |
|---|---|---|
| a | The page on screen shows only the selected market's figures, and is labelled with it | `foreign-market`, `label` |
| b | If the selected market is on hold, every listing page shows the hold panel and no figure at all | `held-page-missing`, `held-figure` |
| c | `_B2C`, `_B2K`, `window._kpiInd`, `window._kpiYld` belong to the selected market or are null | `cache` |
| d | Once the page knows a market is held, no listing request is sent for it | `request-to-held` |
| e | The Africa overview and the Coverage Registry never count a held market's figures | `held-figure-cross` |
| f | Nothing is left in its loading state, and no page shows another market's filters or currency | `stuck-loading`, `stale-filter`, `stale-currency` |
| g | Uncaught errors and rejected promises | `page-error` |

Check (a), (b) and (e) also run **continuously**: a MutationObserver watches
every write into a `pg-*` container, so a stale answer that is drawn and then
overwritten a moment later is still caught.

## Named scenarios

The random walk finds races by volume; seven scenarios reproduce the awkward
orderings on purpose by pinning the latency of single requests. One case per
page load, all of them in one sweep:

```
http://127.0.0.1:<port>/batch?mode=scenarios&from=1&to=7
http://127.0.0.1:<port>/dashboard?test=scenarios&case=hold-mid-load
```

| case | what it reproduces |
|---|---|
| `deeplink` | `/dashboard/bedrooms` opened cold: the page must draw the selected market, not "null" |
| `lateboot` | `data_status` answers after boot's 6 s race, without a hold that a refusal recorded in the meantime — the hold must stand |
| `status-order` | two `data_status` reads answering in reverse order — the older one may release nothing |
| `old-retry` | a failure banner drawn for one market, its Retry clicked after switching to another |
| `hold-mid-load` | summary, then a refusal, then the listing sample: the hold stands, the caches are dropped and no CSV is exported |
| `loader-order` | the KPI loader answering before the batch loader must not discard it |
| `registry-currency` | a currency toggle during the Coverage Registry loop — one currency per table |

## How a leaked figure is recognised

`stub.js` gives every market its own digit run and its own text marks, and puts
them in every payload:

| Market | figures | listing-derived marks | other marks |
|---|---|---|---|
| Kenya | `11111x` (e.g. 1,111,150) | `ZQKE` | `ZNKE` |
| Morocco | `22222x` | `ZQMA` | `ZNMA` |
| Tunisia | `33333x` | `ZQTN` | `ZNTN` |
| Ethiopia (held) | `99999x` | `ZQET` | `ZNET` |

So "Kenya's median on the Tunisia page" is a literal string search, and so is
"a held market's figure in a cross-market total". The marks are split in two
families because news, pipeline projects and research figures are *not*
listing-derived and still load for a market on hold; only the listing family may
never appear for a held market.

The filter arguments are echoed back inside district names —
`ZQKE Kilimani [f=apartments/sale/90]` — so a page drawn from an answer to
filters that have since changed is visible in the DOM as well.

`stub.js` also:

- answers `data_status` with the holds, and refuses every listing RPC of a held
  market with HTTP 423 / `PT423` / `market_held`, note and since-date included;
- delays each answer 0–700 ms, by a hash of (seed, request, repeat number), so
  answers arrive out of order but the same seed behaves the same way twice;
- logs every request (`window.__stub.log`), counts the ones outstanding
  (`window.__stub.pending`), and records any listing request sent for a market
  the page already knew was held (`window.__stub.violations`);
- exposes `window.__stub.hold(country)` / `.release(country)` for mid-run changes;
- stubs the FX and World Bank `fetch` calls, so no run depends on the network.

## Notes

- The page is served at `/dashboard`; `history.replaceState` drops the query
  string on boot, so both the stub and the runner read their options at load.
- `tests` is listed in `.railwayignore`, and `server.js` in the repo root blocks
  `/tests/`, so none of this is deployed.
- The test never touches Supabase: the only client the page gets is the stub.
