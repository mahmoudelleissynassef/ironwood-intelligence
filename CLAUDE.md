# IRONWOOD INTELLIGENCE — CLAUDE.md
> Read this entire file before doing anything. This is the full context of the project.

---

## WHAT THIS PROJECT IS
Ironwood Intelligence is a B2B SaaS platform — "the CoStar of Africa" — that sells institutional-grade real estate market data for African cities. Users pay for a subscription and get access to a dashboard showing live property prices, yields, pipeline data, and macro indicators scraped from listing websites across Africa.

**Owner:** Mahmoud Nassef (mahmoud.nassef@heirstoneconsulting.com)  
**Stage:** Early — data for Morocco and Nigeria uploaded. Scraping not yet automated.  
**Goal right now:** Get the dashboard working with live data, automate scraping, expand to 35 markets.

---

## LIVE INFRASTRUCTURE

| Service | Details |
|---------|---------|
| **Frontend** | Single HTML files — no framework, no build step |
| **Hosting** | Vercel — auto-deploys when you push to GitHub main branch |
| **Database** | Supabase (Postgres) |
| **Payments** | Stripe |
| **Domain** | ironwoodintelligence.com (DNS on GoDaddy → Vercel) |

**Supabase URL:** `https://ujhqkirhfmumvvnfvgnz.supabase.co`  
**Supabase Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqaHFraXJoZm11bXZ2bmZ2Z256Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMjkzMDYsImV4cCI6MjA4ODgwNTMwNn0.m_RPKmKN_GJgsCKDzuWpsSKHrAMITf5gjw8vOesy3ik`  
**Admin user:** mahmoud.nassef@heirstoneconsulting.com (UID: b3d18733-8f78-4139-a526-5b1b2a8ae80d)

---

## GITHUB REPOS

| Repo | Purpose |
|------|---------|
| `mahmoudelleissynassef/ironwood-intelligence` | Main — dashboard, landing page, Vercel config |
| `mahmoudelleissynassef/ironwood-admin` | Admin panel (private) |

**Local folder on Mahmoud's PC:**  
`C:\Users\mahmo\OneDrive - Heirstone Consulting\Documents\07_Ironwood Intelligence\Scripts Ironwood Intelligence`

**Push command:** `git add . && git commit -m "message" && git push origin HEAD:main`

---

## FILE STRUCTURE (what matters)

```
ironwood-intelligence/
├── index.html          ← Landing page / marketing site
├── dashboard.html      ← THE MAIN APP (most important file)
├── admin/
│   └── index.html      ← Admin panel for uploading data
└── vercel.json         ← Vercel routing config
```

**IMPORTANT:** The highest-numbered local backup (e.g. dashboard18.html) = latest version. When Mahmoud saves versions locally he increments the number. The file without a number on GitHub is what's live.

---

## DATABASE SCHEMA

### Table: `properties` (main data table)
This is where all scraped listing data lives. One row per listing.

**Valid columns:**
```
id, created_at, country, city, submarket, district, asset_class, 
transaction_type, price_raw, price_usd, price_local, currency, 
size_sqm, price_per_sqm, bedrooms, bathrooms, floors, year_built, 
latitude, longitude, title, description, source_name, source_url, 
listing_id, scraped_at, status, data_quality_score, verified, notes
```

**Key columns for KPI calculations:**
- `country` — stored exactly as scraped (could be 'Morocco', 'morocco', 'Maroc' etc) — ALWAYS use `.ilike('country', name)` not `.eq()` 
- `city` — city name
- `submarket` — district/neighbourhood
- `asset_class` — 'apartment', 'villa', 'office', 'retail', 'riad', etc
- `transaction_type` — 'sale', 'for sale', 'rent', 'for rent', 'rental', etc — normalize to lowercase and strip spaces before comparing
- `price_per_sqm` — the main pricing field used for all calculations
- `scraped_at` — timestamp of when listing was scraped — used for price growth over time

### Table: `market_averages`
Pre-aggregated averages by country/city/asset class. Mostly unused currently.

### Table: `price_records`
Historical price snapshots. Mostly unused currently.

### Table: `profiles`
User accounts linked to Supabase auth.

---

## DATA UPLOADED SO FAR

| Country | Rows | Cities | Status |
|---------|------|--------|--------|
| Morocco | 62,052 | Casablanca, Marrakech, Rabat, Tangiers, Fez | ✅ Live |
| Nigeria | 28,400+ | Lagos, Abuja, Port Harcourt, Kano, Ibadan | ✅ Live |

**Source for Morocco:** Mubawab.ma scrape  
**Source for Nigeria:** NigeriaPropertyCentre + PropertyPro scrape

---

## HOW THE DASHBOARD WORKS

### Country switching
- `ACTIVE_COUNTRY` global variable holds 'Morocco' or 'Nigeria'
- `switchCountry(name)` — called when user clicks a country. Immediately clears stale KPI values, then calls `loadLiveKPIs(name)` asynchronously
- `COUNTRIES` object holds config per country (currency, flag, cities list)

### Live KPI loading (`loadLiveKPIs(country)`)
- Fetches ALL rows from `properties` table for the country using paginated batches of 1000
- Uses `.ilike('country', country)` for case-insensitive matching
- Normalizes `transaction_type` by lowercasing and stripping non-alpha chars
- Calculates: median sale price, prime office rent (95th pctile), listing count, gross yield, price growth by quarter, liquidity proxy score
- Updates ALL KPI cards, city rankings table, key indicators table, yield estimates table, listings page, districts table, price trends table
- **DO NOT use `.eq('country', country)`** — it's case sensitive and will return 0 rows

### Currency symbols
- Morocco → `MAD ` (prefix)
- Nigeria → `₦` (prefix)
- Always derived from `COUNTRIES[country].currency` — never hardcode

### KPI card IDs (for safeSet())
```
kpi-median-price        — median sale price/m²
kpi-price-growth        — price growth % across quarters
kpi-active-listings     — total listing count
kpi-listings-chg        — sub-text under listings count
kpi-yield               — gross yield estimate
kpi-liquidity           — liquidity score
kpi-liquidity-chg       — sub-text under liquidity
kpi-prime-rent          — prime office rent
kpi-prime-rent-chg      — sub-text under prime rent
kpi-pipeline            — pipeline supply (hardcoded '—' for now)
kpi-median-sub          — sub-text under median price
```

### Macro data (`loadMacroData(country)`)
- Fetches from World Bank API (free, no key needed)
- Country codes: MA=Morocco, NG=Nigeria
- Indicators: SP.POP.TOTL, NY.GDP.MKTP.KD.ZG, NY.GDP.PCAP.CD, ST.INT.ARVL, SP.URB.TOTL.IN.ZS
- Called when user navigates to Macro Indicators page or switches country while on that page

---

## WHAT'S REAL DATA vs HARDCODED/FAKE

### Currently LIVE from Supabase:
- Median sale price/m² (country + per city)
- Active listing count
- Prime office rent (95th pctile of office rent rows)
- Gross yield estimate (where both sale + rent data exists)
- Liquidity score (proxy formula)
- Key indicators table (city × asset class × transaction type)
- Districts table (grouped by submarket column)
- Listings page (top 50 raw rows)
- Yield estimates table

### Currently FAKE/HARDCODED (needs fixing later):
- Transactions page — showing asking prices, not completed deals. Should be relabelled "Asking Price Evidence"
- Development Pipeline page — all invented. Real source: anh.ma (Morocco), laspppa.lagosstate.gov.ng (Nigeria)
- Market Signals scores — static numbers
- Investment Radar / IOS scores — static numbers  
- Liquidity Index gauges — static numbers
- Market Reports KPIs — static numbers
- Insights narratives — static text

---

## STRIPE PAYMENT LINKS

| Plan | Link |
|------|------|
| Basic Monthly | https://buy.stripe.com/test_8x228t0En0uUa4OciW4F202 |
| Basic Annual | https://buy.stripe.com/test_00weVf0EncdCgtc0Ae4F203 |
| Pro Monthly | https://buy.stripe.com/test_9B600l86PcdC2Cm1Ei4F200 |

**Status:** Stripe is in TEST mode. Not yet switched to live.  
**Webhook:** Not yet configured. Need to add 4 events + whsec_ signing secret to Vercel env vars.

---

## SCRAPING PLAN (not yet built)

### Target: 35 African markets
Config workbook exists: `ironwood_scraper_configs_v2.xlsx` — 140 sources, real URLs.

### Priority markets (in order):
1. Morocco ✅ (done)
2. Nigeria ✅ (done)  
3. Kenya — Nairobi (Jumia House, BuyRentKenya)
4. Ghana — Accra (Meqasa, Tonaton)
5. Senegal — Dakar (Expat-Dakar, Jumia House)
6. South Africa — Cape Town, Johannesburg (Property24, Private Property)
7. Egypt — Cairo (Aqarmap, OLX Egypt)

### Scraper architecture plan:
- One Python scraper per website
- Output: Excel file with columns matching Supabase schema
- Upload via admin panel Country Replace mode
- Eventually: automate with n8n on a schedule

### Key scraper fields needed:
```python
country, city, submarket, asset_class, transaction_type,
price_raw, currency, size_sqm, price_per_sqm,
title, source_name, source_url, listing_id, scraped_at
```

### Known working sources:
- **Morocco:** mubawab.ma (done), avito.ma, sarouty.ma
- **Nigeria:** nigeriapropertycentre.com (done), propertypro.ng
- **Kenya:** buyrentkenya.com, jumia.com.ke/housing
- **Ghana:** meqasa.com, tonaton.com
- **Egypt:** aqarmap.com, olx.com.eg

---

## ADMIN PANEL

**Location:** `admin/index.html` in ironwood-admin repo  
**Access:** Only Mahmoud's account can log in

### How data upload works:
1. Upload Excel file (one file per country, e.g. Morocco.xlsx)
2. Admin detects country from `country` column in file
3. Country Replace mode: DELETE all rows WHERE country='X', then INSERT all rows from file
4. Other countries are untouched

### Column mapping (COL_MAP):
```javascript
area → size_sqm
location → submarket  
asset_type → asset_class
site_name → source_name
link → source_url
```

### VALID_COLUMNS whitelist:
The admin silently drops any column not in the whitelist before inserting. This fixed the `image` column error from Nigeria upload.

---

## KNOWN BUGS FIXED (don't reintroduce these)

1. **ilike fix** — Always use `.ilike('country', country)` not `.eq('country', country)`. The eq was case-sensitive and returned 0 rows.

2. **Currency not switching** — `updateAllPagesForCountry()` was overwriting KPI cards with stale values. Fixed by stripping all KPI writes from that function. `loadLiveKPIs()` owns all KPI card updates.

3. **+8.3% MoM hardcoded** — Sub-divs under KPI cards had no IDs so JS couldn't update them. Fixed by adding `kpi-listings-chg`, `kpi-liquidity-chg`, `kpi-prime-rent`, `kpi-prime-rent-chg` IDs.

4. **transaction_type matching** — Normalize by lowercasing AND stripping all non-alpha characters before comparing. Real data has 'for sale', 'For Sale', 'forsale' etc.

5. **updateAllPagesForCountry** — This function must NOT write to KPI cards. It only updates structural/country-name references. loadLiveKPIs() handles all live values.

---

## PENDING TASKS (priority order)

1. ⬜ Connect Supabase MCP so Claude can query data directly
2. ⬜ Complete Stripe webhook — add 4 events, get whsec_ secret, add to Vercel env vars
3. ⬜ Add env vars to Vercel: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
4. ⬜ Relabel Transactions page as "Asking Price Evidence"
5. ⬜ Build Kenya scraper (Nairobi — buyrentkenya.com)
6. ⬜ Build Ghana scraper (Accra — meqasa.com)
7. ⬜ Research and upload pipeline data (5 projects per city, Morocco first)
8. ⬜ Run fix-duplicates-v3.sql in Supabase SQL editor
9. ⬜ Switch Stripe from test to live mode
10. ⬜ Build n8n automation for monthly scrape → upload → notify
11. ⬜ Dashboard subscription gating (lock pages by plan tier)
12. ⬜ Define IOS score formula using live inputs
13. ⬜ Wire Market Signals to live data

---

## HOW TO PUSH TO GITHUB

From the project folder:
```bash
git add dashboard.html
git commit -m "describe what changed"
git push origin HEAD:main
```

Vercel auto-deploys within ~60 seconds of push.

---

## CONTACT / BUSINESS INFO
- **Email:** business@ironwoodintelligence.com
- **Phone:** +971 50 123 4567  
- **Office:** Meydan Free Zone, Dubai, UAE
- **Stripe account:** Connected to Mahmoud's email
