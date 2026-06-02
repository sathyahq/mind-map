# PRD: Shopify App Store Copy Scraper & Competitor Analyzer

## Purpose
A web app for Shopify app developers to scrape competitor app store listings and get AI-powered copy/positioning analysis — so they can improve their own listing and get more installs.

## Users
Shopify app developers who want to:
- Study how competitors write their titles, descriptions, and feature bullets
- Identify positioning gaps and keyword opportunities
- Get actionable suggestions to improve their own listing copy

## Core Workflow
1. User sets "Your App" URL once (persisted across sessions)
2. User pastes 1–50 competitor URLs
3. App scrapes all listings, extracts structured data
4. App shows results in a table + downloadable CSV
5. App runs AI analysis comparing your app vs competitors
6. User downloads CSV and reads the analysis to improve their copy

---

## Features

### F1: "Your App" Input (persisted)
- Separate input field at the top labeled "Your App"
- Accepts one Shopify App Store URL (e.g. https://apps.shopify.com/my-app)
- Saved to a local JSON file (`my_app.json`) so it survives between sessions
- "Clear saved app" button to reset
- Scraped data displayed in a highlighted card/section

### F2: Competitor URL Input
- Text area for pasting competitor URLs (one per line)
- Validates each URL (must contain `apps.shopify.com`)
- Accepts 1–50 URLs per batch

### F3: Scraping Engine
- For each URL, fetch the page HTML and send it to **Gemini Flash 2.5** to extract:
  - `app_name`: The app's display name
  - `title`: The marketing headline/tagline shown below the app name
  - `description`: The main description paragraph(s)
  - `features`: Bullet-point feature list (semicolon-separated in CSV)
  - `rating`: Average star rating (e.g. 4.8)
  - `review_count`: Total number of reviews (e.g. 523)
  - `pricing`: Pricing info if visible
- **Why Gemini instead of CSS selectors**: Shopify changes their DOM frequently. CSS selectors break. Sending raw HTML to an LLM for structured extraction is more resilient.
- Fallback: If Gemini extraction fails, fall back to BeautifulSoup with known selectors (`#adp-hero h1`, `#app-details`, `#reviews-link`, JSON-LD)
- Retry logic: On HTTP failures, retry up to 3 times with exponential backoff (2s, 4s, 8s) and rotate User-Agent strings
- 2-second polite delay between requests
- Progress bar in UI showing scraping status

### F4: Results Table
- Display all scraped data in a pandas DataFrame table
- Columns: app_name, title, description, features, rating, review_count, pricing, url
- Your app's row highlighted or shown separately at the top

### F5: CSV Download
- Download button that exports all results as a CSV file
- Filename: `shopify_apps_data.csv`
- Header row: app_name, title, description, features, rating, review_count, pricing, url

### F6: Your App vs Competitors Comparison View
- Side-by-side table with your app in the first column and competitors alongside
- Rows: Title, Description (truncated), Feature count, Rating, Review count, Pricing
- Visual indicators (color/emoji) showing where your app is stronger or weaker

### F7: AI Copy Analysis (Gemini Flash 2.5)
- After scraping completes, automatically analyze the extracted copy
- Analysis should cover:
  - **Positioning summary**: How does your app position itself vs competitors?
  - **Title/tagline analysis**: Which competitor titles are strongest and why?
  - **Feature gaps**: Features competitors mention that you don't (and vice versa)
  - **Keyword opportunities**: Common words/phrases in competitor listings missing from yours
  - **Copy improvement suggestions**: 3–5 specific, actionable rewrites for your title, description, or feature bullets
- Displayed in a clean expandable section below the results table
- Analysis is run once after scraping; a "Re-analyze" button lets user re-run it

---

## Technical Architecture

### Stack (matches existing repo)
- **Python 3.11+**
- **Streamlit** — web UI framework
- **google-generativeai** — Gemini Flash 2.5 API client
- **requests** + **BeautifulSoup4** + **lxml** — HTTP fetching and fallback HTML parsing
- **pandas** — data tables and CSV export

### File Structure
```
├── app.py                  # Streamlit web UI (main entry point)
├── scraper.py              # Page fetching + BeautifulSoup fallback extraction
├── extractor.py            # Gemini-powered structured data extraction from HTML
├── analyzer.py             # Gemini-powered copy analysis (your app vs competitors)
├── storage.py              # Persist "Your App" data to my_app.json
├── requirements.txt        # Dependencies
├── .streamlit/
│   └── config.toml         # Streamlit deployment config
└── .gitignore
```

### Environment Variables
- `GEMINI_API_KEY` — Required. Gemini Flash 2.5 API key. The app should check for this on startup and show a clear error if missing.

### Key Design Decisions
- **Gemini for extraction, not just analysis**: Send the raw HTML to Gemini with a structured prompt asking for JSON output. This replaces brittle CSS selectors as the primary extraction method. BeautifulSoup selectors (`#adp-hero`, `#app-details`, `#reviews-link`, JSON-LD) remain as a fallback if the Gemini call fails.
- **No database**: `my_app.json` flat file for persistence. Simple enough for a single-user tool.
- **No auth**: This is a personal tool, not multi-tenant.

---

## Deployment
The app should work on any of these with zero changes:
- `streamlit run app.py` locally
- Streamlit Cloud (connect GitHub repo, set GEMINI_API_KEY as a secret)
- Hugging Face Spaces (Streamlit SDK)
- Any VPS with Python installed

---

## Validation Test
After building, test against this URL:
**https://apps.shopify.com/delta-retail-barcode**

Expected extraction should include:
- Title containing "Generate Barcodes" or "Barcode"
- Features with items about barcode generation and SKU creation
- A numeric rating and review count
