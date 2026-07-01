# IRONWOOD INTELLIGENCE — CLAUDE.md
> Read this entire file before doing anything. This is the full context of the project.
> Last updated: July 1, 2026 (reconciled against live infra + all three repos)

---

## WHAT THIS PROJECT IS
Ironwood Intelligence is a B2B SaaS platform — "the CoStar of Africa" — that sells institutional-grade real estate market data for African cities. Users pay for a subscription and get access to a dashboard showing live property prices, yields, pipeline data, and macro indicators scraped from listing websites across Africa.

**Owner:** Mahmoud Nassef (mahmoud.nassef@heirstoneconsulting.com)
**Stage:** Early / PRE-DATA. Scraper CODE is built for 15+ countries (23 portals, 18 parser modules in scraper-factory), but NO data has been ingested into Supabase yet — the DB is currently EMPTY (0 tables, 0 rows, 0 auth users, verified July 1, 2026). The dashboard runs on demo/placeholder values behind a "DEMO DATA — NOT REAL" banner. Nothing is live for customers yet.
**Goal:** Automate scraping for 35 African markets, ingest the FIRST real data into Supabase, get the dashboard onto real data, then grow subscriber base.
**Reality check:** "parser exists in repo" ≠ "data ingested." The next real milestone is the first end-to-end scrape → Supabase → dashboard, NOT more parsers.

---

## LIVE INFRASTRUCTURE

| Service | Details |
|---------|---------|
| Frontend | Single HTML files — no framework, no build step |
| Hosting | Vercel — auto-deploys when you push to GitHub main branch |
| Database | Supabase (Postgres) — ref ujhqkirhfmumvvnfvgnz — ⚠️ currently EMPTY: schema not created, no data, no auth users |
| Payments | Stripe (test mode — not yet live) |
| Domain | ironwoodintelligence.com (DNS on GoDaddy → Vercel) |
| Scraper backend | Railway FastAPI (main.py) |
| Scraper orchestration | n8n cloud |
| Anti-bot proxy | Crawlbase (for sites that block Railway IP) |
| Scraper config + output | Google Sheets |

---

## CREDENTIALS AND KEYS

### Supabase
- URL: https://ujhqkirhfmumvvnfvgnz.supabase.co
- Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqaHFraXJoZm11bXZ2bmZ2Z256Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMjkzMDYsImV4cCI6MjA4ODgwNTMwNn0.m_RPKmKN_GJgsCKDzuWpsSKHrAMITf5gjw8vOesy3ik
- Service Role Key: stored in .mcp.json locally — never push to GitHub
- Admin user: mahmoud.nassef@heirstoneconsulting.com (UID: b3d18733-8f78-4139-a526-5b1b2a8ae80d)

### Railway
- URL: https://web-production-a190d3.up.railway.app
- Endpoint: POST /scrape
- Plan: Hobby ($5/month)
- Repo: scraper-factory on GitHub (auto-deploys on push to main)
- Env var: CRAWLBASE_TOKEN = Crawlbase API token

### n8n
- Instance: https://n8n.srv1007886.hstgr.cloud
- Plan: Free (sequential execution only)

### Crawlbase
- Purpose: Proxy to bypass anti-bot blocking (used for NigeriaPropertyCentre only)
- Token type: Normal Token (not JS token)
- Cost: $29/month for 100,000 requests
- Usage: ~530 requests per Nigeria run
- NOTE: REGENERATE TOKEN — was accidentally shared publicly

### Google Sheets
- Config sheet ID: 1oTWjtmMNCtBjlKWKmi2XYJxXyC3BlwlOsdrsqTiNw4Y (name: "Scraper Config")
- Output sheet ID: 1Ayyee7X0c5akOhhIubHM4SJ8mSx7MtXo8D2MZmrtNQc (name: "Scraped Data")
- Config credential ID in n8n: 607b3ETscFEo9K3Z
- Output credential ID in n8n: wak533hxXCillrky
- SMTP credential ID in n8n: Tj3x4R8hyp1WMNrG
- Email: mahmoud.elleissy.nassef@gmail.com

### Stripe
- Status: TEST mode — not yet live
- Basic Monthly: https://buy.stripe.com/test_8x228t0En0uUa4OciW4F202
- Basic Annual: https://buy.stripe.com/test_00weVf0EncdCgtc0Ae4F203
- Pro Monthly: https://buy.stripe.com/test_9B600l86PcdC2Cm1Ei4F200
- Webhook: not yet configured

---

## GITHUB REPOS

| Repo | Purpose | Local clone |
|------|---------|-------------|
| mahmoudelleissynassef/ironwood-intelligence | Main — dashboard.html, landing (index.html), admin-*.html, Vercel config | C:\Dev\Ironwood Intelligence |
| mahmoudelleissynassef/ironwood-admin | Admin panel (private) — single index.html | C:\Dev\ironwood-admin |
| mahmoudelleissynassef/scraper-factory | Scraper backend + PARSER FACTORY (main.py dispatcher, parsers/, promote.py) | C:\Dev\scraper-factory |

Note: an older local copy lived at C:\Users\mahmo\OneDrive - Heirstone Consulting\Documents\07_Ironwood Intelligence\Scripts Ironwood Intelligence — C:\Dev is now the working set (all three repos cloned there).

Push command: git add . && git commit -m "message" && git push origin HEAD:main

---

## DATABASE SCHEMA

### Table: properties (main data table)
⚠️ AS OF July 1, 2026 THIS TABLE DOES NOT EXIST IN SUPABASE YET — the DB is empty. The schema below is the canonical/intended shape that the dashboard (loadLiveKPIs) and admin upload expect. It MUST be created before any ingestion — verify database-setup.sql / update-schema.sql actually build it.
One row per listing. All KPIs calculated from this table on the fly.

Valid columns:
id, created_at, country, city, submarket, district, asset_class,
transaction_type, price_raw, price_usd, price_local, currency,
size_sqm, price_per_sqm, bedrooms, bathrooms, floors, year_built,
latitude, longitude, title, description, source_name, source_url,
listing_id, scraped_at, status, data_quality_score, verified, notes

CRITICAL RULES:
- ALWAYS use .ilike('country', name) — NEVER .eq('country', name) — eq is case sensitive and returns 0 rows
- Normalize transaction_type: lowercase + strip non-alpha chars before comparing
- price_per_sqm is the main pricing field for all calculations

Other tables:
- market_averages — pre-aggregated, mostly unused
- price_records — historical snapshots, mostly unused
- profiles — user accounts

---

## DATA IN SUPABASE SO FAR

⚠️ NONE. As of July 1, 2026 the Supabase DB is empty — 0 tables, 0 rows, 0 auth users. No listings have been ingested yet.

The figures this doc previously claimed (Morocco ~62k, Nigeria ~28k) were never confirmed present in this project and are NOT there now. Treat "data ingested" as 0 until a scrape → Supabase load is actually run and verified. Scraper CODE exists for 15+ countries (see Scraper Architecture) — but code existing ≠ data ingested.

---

## SCRAPER ARCHITECTURE

### Full automated pipeline per country

ONE-TIME SETUP per new country:
1. Claude Code creates scraper config tab in Google Sheets
2. Claude Code creates scraped data tab in Google Sheets
3. Claude Code adds scraper logic to main.py on Railway
4. Claude Code creates n8n workflow for that country

EVERY RUN AFTER (fully automated):
1. n8n triggers on schedule
2. Reads config tab (URLs to scrape)
3. Reads existing scraped data (for deduplication)
4. POSTs to Railway /scrape
5. Railway scrapes, deduplicates, returns new listings only
6. n8n appends new rows to scraped data tab
7. n8n uploads data to Supabase
8. n8n sends email summary

### Google Sheets structure

Scraper Config sheet (1oTWjtmMNCtBjlKWKmi2XYJxXyC3BlwlOsdrsqTiNw4Y):
- One tab per country/website
- Columns: url, city, asset_type, listing_type, site_name, document_name
- Existing tabs: Morocco - Mubawab (80 URLs), Nigeria - NigeriaPropertyCenter (150 URLs), Senegal - Expat-Dakar

Scraped Data sheet (1Ayyee7X0c5akOhhIubHM4SJ8mSx7MtXo8D2MZmrtNQc):
- One tab per country/website
- Columns: title, price, currency, area, unit, country, location, image, link, retrieved_at, price_per_sqm, city, listing_type, images, images_joined, asset_type, document_name, site_name, bedrooms, bathrooms, details, description, toilet, Last Update
- Existing tabs: Mubawab (Morocco), Nigeria (sheet ID: 1668264261), Senegal (sheet ID: 1946385699)

### Railway API endpoint

POST https://web-production-a190d3.up.railway.app/scrape
Body:
{
  "url": "https://...",
  "city": "Casablanca",
  "asset_type": "Offices",
  "site_name": "Mubawab",
  "listing_type": "sale",
  "document_name": "Morocco - Offices",
  "pages": 25,
  "existing_links": ["https://...", "https://..."]
}
Returns: flat array of listing objects

### Deduplication logic
1. n8n reads all existing links from output sheet before each run
2. Passes them as existing_links array to Railway
3. Railway skips listings whose link already exists
4. Only new listings returned and appended
5. Sheet accumulates over time — never cleared between runs
6. Backup: Google Apps Script runs hourly on Mubawab tab, deletes duplicate rows by link column

### Scraper architecture (scraper-factory repo — reconciled July 1, 2026)

main.py is now a thin DISPATCHER only — no parser logic lives in it. Parsers are modular under parsers/:
- parsers/registry.json — maps domain substring → parser module + function + fetch_method (direct | crawlbase | crawlbase_js | scrapingbee | auto)
- parsers/live/ — production parsers imported at startup
- parsers/candidates/ — staging parsers, gated by an activation check
- parsers/utils.py — shared price/area/date/html helpers
- promote.py — CLI to promote a parser scaffold → candidate → live

LIVE parsers (18 modules, 23 portal domains, 15+ countries):
Morocco (mubawab.ma), Nigeria (nigeriapropertycentre.com, propertypro.ng), Senegal (expat-dakar.com, keur-immo.com), Ghana (tonaton.com, meqasa.com), Tunisia (mubawab.tn), Algeria (mubawab.dz), Egypt (aqarmap.com.eg), Kenya (buyrentkenya.com, property24.co.ke), Ethiopia (ethiopiapropertycentre.com), Uganda (lamudi.co.ug, ugandapropertycentre.com, property24.co.ug), Mauritius (lexpressproperty.com), South Africa (property24.com, privateproperty.co.za), Tanzania (property24.co.tz), Zimbabwe (property24.co.zw, property.co.zw), Mozambique (property24.co.mz).

There is also a larger "factory" (selector auto-discovery, n8n workflow generation, 35-country state registry) that lives on a VPS and is NOT committed to the repo — see scraper-factory/REPO_STRUCTURE.md.

⚠️ "parser exists in repo" does NOT mean it is deployed on Railway, wired to an n8n workflow, or producing data. As of July 1, 2026 no ingestion into Supabase has been confirmed for ANY portal.

Railway config files:
- Procfile: web: uvicorn main:app --host 0.0.0.0 --port $PORT
- railway.toml: healthcheck on /
- requirements.txt: see scraper-factory/requirements.txt (do not hardcode versions here — read the file)

---

## n8n WORKFLOW TEMPLATE (use this for every new country)

Trigger: Daily schedule
Node order:
1. Schedule Trigger
2. Get Existing Listings (Google Sheets — reads output tab)
3. Get Listings Links (Google Sheets — reads config tab)
4. Code (JavaScript) — merges config + existing, builds scraper payload
5. Scraper (HTTP POST to Railway /scrape)
6. Batching (batch=25, wait=5s between batches)
7. Append row in sheet (Google Sheets — appends to output tab)
8. Results for Email (code node)
9. Send email (SMTP)

JavaScript merge node (use exactly this pattern):
```javascript
const rows = $input.all();
const existingRows = $('Get Existing Listings').all();
const existingLinks = new Set(
  existingRows.map(r => r.json.link).filter(Boolean)
);
const out = rows
  .map(r => r.json)
  .filter(j => j && j.url)
  .map(j => ({
    json: {
      url: j.url,
      city: j.city,
      asset_type: j.asset_type,
      listing_type: j.listing_type,
      site_name: j.site_name,
      document_name: j.document_name,
      pages: 25,
      existing_links: Array.from(existingLinks)
    }
  }));
return out;
```

---

## SCRAPER EXPANSION PLAN

Parser build status (reconciled July 1, 2026 from parsers/registry.json). "Parser built" = code is live in the registry; it does NOT mean data is ingested.
1. Morocco — mubawab.ma — parser built
2. Nigeria — nigeriapropertycentre.com + propertypro.ng — parser built
3. Senegal — expat-dakar.com + keur-immo.com — parser built (this doc previously said "not built" — that is STALE)
4. Kenya — buyrentkenya.com + property24.co.ke — parser built
5. Ghana — tonaton.com + meqasa.com — parser built
6. Egypt — aqarmap.com.eg — parser built (olx.com.eg not yet)
7. South Africa — property24.com + privateproperty.co.za — parser built
8. Also built: Tunisia, Algeria, Ethiopia, Uganda, Mauritius, Tanzania, Zimbabwe, Mozambique

Remaining toward the 35-market goal: the other "Coming Soon" dropdown countries still need parsers + config + workflows. But the NEXT real milestone is NOT more parsers — it is getting the FIRST country's data actually ingested into Supabase and onto the dashboard.

For each new country, Claude Code must:
1. Add config URLs to Scraper Config sheet (new tab)
2. Create empty output tab in Scraped Data sheet
3. Add scraper function to main.py on Railway
4. Create n8n workflow following the template above
5. Test one manual run before scheduling

---

## DASHBOARD — HOW IT WORKS

Country switching:
- ACTIVE_COUNTRY global holds 'Morocco' or 'Nigeria'
- switchCountry(name) clears stale values immediately, then calls loadLiveKPIs(name) async
- updateAllPagesForCountry() must NEVER write KPI card values — loadLiveKPIs() owns all of that

Live KPI loading (loadLiveKPIs(country)):
- Fetches ALL rows from properties table paginated (1000/batch)
- Uses .ilike('country', country) — case insensitive
- Normalizes transaction_type: lowercase + strip non-alpha
- Calculates: median sale price, prime office rent (95th pctile), count, yield, growth, liquidity
- Updates ALL KPI cards, tables, charts

KPI card IDs (for safeSet()):
kpi-median-price, kpi-price-growth, kpi-active-listings, kpi-listings-chg,
kpi-yield, kpi-liquidity, kpi-liquidity-chg, kpi-prime-rent, kpi-prime-rent-chg,
kpi-pipeline, kpi-median-sub

Currency: Morocco = "MAD " | Nigeria = "NGN " — always from COUNTRIES[country].currency

Macro data: World Bank API (free, no key needed)
- Country codes: MA=Morocco, NG=Nigeria
- Indicators: SP.POP.TOTL, NY.GDP.MKTP.KD.ZG, NY.GDP.PCAP.CD, ST.INT.ARVL, SP.URB.TOTL.IN.ZS

---

## WHAT IS REAL vs FAKE IN DASHBOARD

⚠️ July 1, 2026: right now EVERYTHING is effectively placeholder because the DB is empty. The "live" items below are what WILL be live once data is ingested; today they render demo values behind the DEMO banner. Macro indicators (World Bank API) are the only genuinely live data, since they don't depend on Supabase.

Live from Supabase (once data exists):
- Median sale price/m2, active listing count, prime office rent
- Gross yield estimate, liquidity score (proxy)
- Key indicators table, districts table, listings page, yield estimates table
- Macro indicators (World Bank API)

Hardcoded / fake (fix later):
- Transactions page — relabel as "Asking Price Evidence"
- Development Pipeline — all invented
- Market Signals scores — static
- Investment Radar / IOS scores — static
- Liquidity Index gauges — static
- Market Reports KPIs — static

---

## BUGS FIXED (never reintroduce)

1. ilike — use .ilike('country', country) never .eq()
2. Currency not switching — updateAllPagesForCountry() must never write KPI cards
3. +8.3% MoM hardcoded — sub-divs now have IDs: kpi-listings-chg, kpi-liquidity-chg, kpi-prime-rent, kpi-prime-rent-chg
4. transaction_type — normalize: lowercase + strip non-alpha before comparing
5. Async race — switchCountry() clears stale values immediately before async fetch

---

## ADMIN PANEL

How upload works:
1. Upload Excel (one file per country)
2. Admin detects country from country column
3. Country Replace: DELETE WHERE country=X, INSERT all rows
4. Other countries untouched

Column mapping: area=size_sqm, location=submarket, asset_type=asset_class, site_name=source_name, link=source_url
VALID_COLUMNS whitelist drops unknown columns silently (fixes image column error from Nigeria upload)

---

## PENDING TASKS (priority order — reconciled July 1, 2026)

BLOCKER — nothing ships until these are done:
1. Create the Supabase schema — the `properties` table (+ profiles) does not exist. Run/verify database-setup.sql + update-schema.sql against the DB.
2. Ingest the FIRST real country's data end-to-end (scrape → Google Sheet → Supabase) and verify row counts. Morocco (mubawab.ma) is the natural first — most mature parser.
3. Recreate the admin auth user (mahmoud.nassef@…) — auth.users is empty, so no one can log into dashboard/admin.

THEN:
4. Verify Railway is actually deployed with the current parsers/ factory, and which n8n workflows are active/scheduled.
5. URGENT (security): Regenerate the Crawlbase token — exposed publicly; references still sit in this file.
6. Complete Stripe webhook (4 events + whsec_) and add Vercel env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY.
7. Once a market has REAL data: remove the "DEMO DATA — NOT REAL" banner for THAT market only, and relabel Transactions page as "Asking Price Evidence".
8. Switch Stripe from test to live mode.
9. Dashboard subscription gating (lock pages by plan tier).
10. Wire Market Signals and IOS scores to live data.

DONE since this doc was originally written (do NOT redo):
- Senegal parser (expat-dakar + keur-immo) — built.
- Kenya, Ghana, Egypt, South Africa, Tunisia, Algeria, Ethiopia, Uganda, Mauritius, Tanzania, Zimbabwe, Mozambique parsers — built.
- Parser factory refactor (main.py dispatcher + parsers/ registry + promote.py) — done.

---

## KNOWN ISSUES

| Issue | Status |
|-------|--------|
| Supabase DB empty — 0 tables, 0 rows, 0 auth users (schema never created / no ingestion) | 🔴 TOP BLOCKER — verified July 1, 2026 |
| Dashboard shows "DEMO DATA — NOT REAL" banner | CORRECT for now — keep until a market has real data |
| Railway/n8n live-deployment state unverified (parsers exist in repo; deployment not confirmed) | TODO — verify |
| Crawlbase token exposed publicly | REGENERATE IMMEDIATELY |
| Google Sheets drops batches at high volume | 5s wait deployed — monitor when scraping resumes |
| Stripe in test mode | TODO |
| ~~Senegal scraper not built~~ | RESOLVED — parser is live in registry.json |

---

## CONTACT
- Email: business@ironwoodintelligence.com
- Phone: +971 50 123 4567
- Office: Meydan Free Zone, Dubai, UAE
