# Claude Code Build Prompt

Copy-paste everything below this line into Claude Code in VS Code.

---

## Prompt

Build a Streamlit web app that scrapes Shopify App Store listings and provides AI-powered competitor copy analysis. The repo already has a working starting point — read every file before changing anything.

### What this app does

A Shopify app developer pastes their own app URL + competitor app URLs. The app scrapes all listings, extracts structured data, shows a comparison table, lets them download a CSV, and uses Gemini Flash 2.5 to analyze the copy and suggest improvements.

### Before you start

1. Read all existing files in the repo (scraper.py, app.py, requirements.txt, .streamlit/config.toml, .gitignore)
2. Read PRD.md for the full product spec
3. Ask me for my `GEMINI_API_KEY` — I'll give it to you to put in a `.env` file (add `.env` to .gitignore first)

### What to build — step by step

**Step 1: Environment setup**
- Add `.env` to `.gitignore`
- Create `.env` with `GEMINI_API_KEY=` placeholder
- Ask me for the actual key before proceeding
- Update `requirements.txt`: add `google-generativeai>=0.8.0` and `python-dotenv>=1.0.0`

**Step 2: Create `extractor.py` — Gemini-powered extraction**
- Function `extract_with_gemini(html: str, url: str) -> dict` that:
  - Takes raw HTML of a Shopify app listing page
  - Sends it to Gemini Flash 2.5 with a prompt asking for JSON with these fields:
    - `app_name` (the app's display name, e.g. "Retail Force—Barcode Generator")
    - `title` (marketing headline/tagline shown below the name)
    - `description` (main description paragraphs, combined)
    - `features` (list of feature bullet points)
    - `rating` (number like 4.8, or null)
    - `review_count` (number like 523, or null)
    - `pricing` (pricing text if visible, or null)
  - Parses the JSON response and returns a dict
  - On failure, returns None (caller will fall back to BeautifulSoup)
- Use `google.generativeai` with model `gemini-2.5-flash`
- Load API key from env var `GEMINI_API_KEY`

**Step 3: Create `storage.py` — Persist "Your App"**
- `save_my_app(data: dict)` — writes to `my_app.json`
- `load_my_app() -> dict | None` — reads from `my_app.json`, returns None if not found
- `clear_my_app()` — deletes `my_app.json`
- Add `my_app.json` to `.gitignore`

**Step 4: Create `analyzer.py` — AI copy analysis**
- Function `analyze_vs_competitors(my_app: dict, competitors: list[dict]) -> str` that:
  - Takes the user's app data and list of competitor data dicts
  - Sends to Gemini Flash 2.5 with a prompt asking for markdown-formatted analysis:
    - Positioning summary (how does their app position itself vs the field)
    - Title/tagline analysis (which competitor headlines are strongest, why)
    - Feature gaps (what competitors mention that the user's app doesn't, and vice versa)
    - Keyword opportunities (common words/phrases in competitor copy missing from user's)
    - 3-5 specific copy rewrite suggestions for the user's title, description, or features
  - Returns the markdown string
- On failure, return an error message string (don't crash)

**Step 5: Update `scraper.py`**
- Keep all existing BeautifulSoup extraction functions as-is (they're the fallback)
- Add `fetch_page_with_retry(url: str, max_retries=3) -> str` that:
  - Retries with exponential backoff (2s, 4s, 8s)
  - Rotates through 3-4 different User-Agent strings on each retry
  - Raises after all retries exhausted
- Update `scrape_app(url)` to:
  1. Fetch HTML with `fetch_page_with_retry()`
  2. Try `extract_with_gemini(html, url)` first
  3. If Gemini fails, fall back to the existing BeautifulSoup extraction
  4. Add `app_name` and `pricing` fields to the returned dict (BeautifulSoup fallback can use "N/A" for these)

**Step 6: Rewrite `app.py` — Full UI**

The Streamlit app should have this layout:

```
[Title: "Shopify App Copy Scraper"]
[Subtitle: "Scrape competitor listings. Analyze copy. Improve your positioning."]

── Your App ──────────────────────────────────
[URL input field]  [Scrape My App button]
(if saved: show app_name, title, rating in a success card)
(small "Clear saved app" link)

── Competitor Apps ────────────────────────────
[Text area: paste URLs, one per line]
[Scrape Competitors button]
[Progress bar during scraping]

── Results ────────────────────────────────────
[Tab 1: Data Table]
  - pandas DataFrame with all scraped data
  - Your app row highlighted at top
  - [Download CSV button]

[Tab 2: Comparison]
  - Side-by-side table: Your App | Competitor 1 | Competitor 2 | ...
  - Rows: App Name, Title, Feature Count, Rating, Reviews, Pricing

[Tab 3: AI Analysis]
  - Rendered markdown from analyzer.py
  - [Re-analyze button]
```

Key behaviors:
- On app startup, check for `GEMINI_API_KEY` env var. If missing, show a `st.error` and stop.
- Load saved "Your App" data from `my_app.json` on startup.
- When "Scrape My App" is clicked: scrape, display, save to `my_app.json`.
- When "Scrape Competitors" is clicked: scrape all, show progress, display results.
- AI Analysis tab: runs automatically after competitors are scraped (if your app data exists). Show a spinner while analyzing.
- All results stored in `st.session_state` so they survive Streamlit reruns.

**Step 7: Test it**
- Run `streamlit run app.py`
- Test with: https://apps.shopify.com/delta-retail-barcode
- Verify extraction returns meaningful data for all fields
- Verify CSV download works
- Show me the output

### Important notes
- Do NOT delete or gut the existing BeautifulSoup extraction logic in scraper.py — it's the fallback
- Gemini is the primary extractor, BeautifulSoup is the safety net
- Keep the .streamlit/config.toml theme as-is
- Features in CSV should be semicolon-separated (not a Python list)
- Handle missing fields gracefully — use "N/A", never crash
- The comparison table should work even with just 1 competitor
