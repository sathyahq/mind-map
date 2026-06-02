# PRD: Shopify App Store Competitor Copy Analyzer

## Purpose
A web app for Shopify app developers to scrape competitor app store listings,
audit every section of their copy and media, and get a focused AI gap report —
so they know exactly what to fix on their own listing to get more installs.

## Users
Shopify app developers who want to:
- Audit how competitors write each section of their listing (title, description, features)
- See at a glance where they are weak vs the field (scorecard)
- Identify specific keywords and copy patterns they're missing
- Know whether their media assets (screenshots, video, demo store) are competitive

## Core Workflow
1. User sets "Your App" URL once — persisted between sessions
2. User pastes 1–50 competitor URLs
3. App scrapes all listings and extracts structured data + media signals
4. App shows a quick scorecard (your app vs all competitors in one table)
5. App runs section-by-section analysis: title → description → features → media
6. App produces a focused gap report: top 3–5 things to fix, with rewrite suggestions
7. User downloads CSV of raw data for their own analysis

---

## What to Extract Per App

For every URL scraped (your app + competitors), extract:

| Field | Description |
|---|---|
| `app_name` | Display name shown on the listing |
| `url_handle` | The slug from the URL (e.g. `delta-retail-barcode`) |
| `tagline` | Marketing headline shown below the app name |
| `description` | Main description paragraphs (combined) |
| `features` | Bullet-point feature list (semicolon-separated in CSV) |
| `feature_count` | Number of feature bullets |
| `rating` | Average star rating (e.g. 4.8) |
| `review_count` | Total number of reviews |
| `pricing` | Pricing tier(s) visible on the page |
| `screenshot_count` | Number of screenshots in the image carousel |
| `screenshot_alt_texts` | Alt text of each screenshot (semicolon-separated) |
| `has_demo_video` | Boolean — does the listing have a demo video? |
| `has_demo_store` | Boolean — does the listing link to a demo store? |
| `url` | Full URL scraped |

---

## Features

### F1: "Your App" Input (persisted)
- Dedicated input at the top, clearly labeled "Your App"
- Accepts one Shopify App Store URL
- On scrape: save data to `my_app.json` so it survives browser refresh and redeployment
- If saved data exists on load: show a summary card (name, tagline, rating, screenshot count)
- "Clear saved app" button to reset

### F2: Competitor URL Input
- Text area for pasting competitor URLs, one per line
- Validates each line (must contain `apps.shopify.com`)
- Accepts 1–50 URLs per batch
- Shows per-URL scraping progress with a status bar

### F3: Scraping Engine
- **Primary**: Send raw HTML to Gemini Flash 2.5 with a structured JSON extraction prompt
  - More resilient than CSS selectors — Shopify updates their DOM regularly
  - Extracts all fields in the table above in a single LLM call per page
- **Fallback**: If Gemini fails, use BeautifulSoup with known selectors:
  - `#adp-hero h1` → app name
  - `#adp-hero h2` → tagline
  - `#app-details` paragraphs → description
  - `#app-details > ul > li` → features
  - `#adp-hero dd > span.tw-text-fg-secondary` → rating
  - `#reviews-link` → review count
  - Count `<img>` in carousel → screenshot count
  - Look for `<video>` or YouTube embed → has_demo_video
  - Media signals (screenshot count, alt texts, video, demo store) should be extracted by BeautifulSoup regardless — do not skip these even when Gemini handles the copy fields
- **Retry**: On HTTP failure, retry up to 3× with exponential backoff (2s, 4s, 8s), rotating User-Agent strings each attempt
- **Delay**: 2-second pause between requests

### F4: Quick Scorecard (Tab 1)
A single compact table — your app in column 1, each competitor in subsequent columns.

Rows:
- App Name
- URL Handle (is it keyword-rich? flag if it contains no product keywords)
- Tagline (truncated to 60 chars)
- Description length (word count)
- Feature count
- Rating ⭐
- Review count
- Screenshots 📸 (count)
- Demo video 🎬 (✓ / ✗)
- Demo store 🏪 (✓ / ✗)
- Pricing

No color-coding needed — the table itself makes gaps obvious.

### F5: Section-by-Section Analysis (Tabs 2–5)

Each tab covers one section of the listing. All tabs are generated from Gemini output after scraping.

**Tab 2 — Title & Tagline**
- List all taglines scraped (your app + competitors)
- Keyword frequency: which product/benefit keywords appear most across all taglines?
- Which taglines are strongest and why (clarity, specificity, benefit-first)?
- Is your tagline keyword-rich, benefit-focused, or vague?
- Flag: does your tagline mention the core use case?

**Tab 3 — Description**
- Word count comparison across all apps
- Key topics/themes present in competitor descriptions but absent from yours
- Readability notes: does it lead with a problem, then a solution?
- Keyword coverage: top 10 product-category keywords found across all descriptions — which do you use, which do you miss?

**Tab 4 — Features**
- Feature count per app (table)
- All unique feature topics mentioned across all apps (clustered by theme)
- Features competitors mention that you don't
- Features you mention that no one else does (potential differentiators)
- Are your bullets specific ("Generate UPC, EAN, Code 128 barcodes") or vague ("Easy barcode generation")?

**Tab 5 — Media Audit**
- Screenshot count per app
- Screenshot alt text quality: are alt texts keyword-rich or empty/generic?
- Video presence: who has a demo video, who doesn't?
- Demo store presence: who has one?
- Note on URL handle: is it keyword-rich? (only actionable at launch, so flag it as FYI)

### F6: Gap Report — AI Output (Tab 6)
This is the only Gemini-generated narrative output. Keep it tight and actionable.

Format (markdown):
```
## Your Top 3–5 Gaps vs Competitors

### 1. [Gap title]
What competitors do: ...
What you do: ...
Suggested fix: [specific rewrite or action]

### 2. [Gap title]
...
```

- Only include gaps where the fix is specific and actionable (not "improve your copy")
- Maximum 5 gaps — quality over quantity
- Runs automatically after competitors are scraped (if your app data exists)
- "Re-analyze" button to regenerate

### F7: CSV Download
- Available on Tab 1 (Scorecard)
- Exports all raw extracted data for all apps
- Filename: `shopify_apps_data.csv`
- Columns: app_name, url_handle, tagline, description, features, feature_count, rating, review_count, pricing, screenshot_count, screenshot_alt_texts, has_demo_video, has_demo_store, url

---

## Technical Architecture

### Stack (matches existing repo)
- **Python 3.11+**
- **Streamlit** — web UI
- **google-generativeai** — Gemini Flash 2.5 API
- **requests** + **BeautifulSoup4** + **lxml** — HTTP fetching + fallback parsing
- **pandas** — data tables and CSV export

### File Structure
```
├── app.py              # Streamlit UI — main entry point
├── scraper.py          # Page fetching, retry logic, BeautifulSoup fallback extraction
├── extractor.py        # Gemini-powered structured data extraction from raw HTML
├── analyzer.py         # Gemini-powered section analysis + gap report
├── storage.py          # Persist "Your App" data to my_app.json
├── requirements.txt
├── .streamlit/
│   └── config.toml
└── .gitignore
```

### Environment Variables
- `GEMINI_API_KEY` — Required. Check on startup. Show `st.error` and stop if missing.

### Key Design Decisions
- **Gemini extracts, not just analyzes**: One LLM call per page extracts all copy fields as structured JSON. BeautifulSoup is the safety net, not the primary path.
- **Media signals always via BeautifulSoup**: Screenshot count, alt texts, video/demo store presence are scraped directly from HTML regardless of whether Gemini handles the copy fields — these are structural signals, not text, and LLMs are unnecessary for them.
- **No database**: `my_app.json` flat file. Single-user tool.
- **No auth**: Personal tool.
- **Tabs over scrolling**: Each analysis section is a tab, not a long page. Keeps it scannable.

---

## Deployment
Works unchanged on:
- `streamlit run app.py` locally
- Streamlit Cloud (set `GEMINI_API_KEY` as a secret)
- Hugging Face Spaces (Streamlit SDK)
- Any VPS with Python

---

## Validation Test
After building, test with:
**https://apps.shopify.com/delta-retail-barcode**

Expected:
- Tagline contains "Barcode" or "SKU"
- Features include items about barcode generation and SKU creation
- `screenshot_count` is a number > 0
- `has_demo_video` is True or False (not N/A)
- Rating and review_count are numeric
