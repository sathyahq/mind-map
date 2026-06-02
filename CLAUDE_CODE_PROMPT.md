# Claude Code Build Prompt

Copy-paste everything below the line into Claude Code in VS Code.

---

## Prompt

Build a web app that scrapes Shopify App Store listings and runs a section-by-section copy and media audit — helping a developer improve their own app listing by seeing exactly how competitors compare across every part of the page.

### Before you start

1. Read every existing file in the repo — understand the current structure and extend it, don't replace it
2. Read `PRD.md` — it is the source of truth for what to build
3. Add `.env` to `.gitignore` immediately, then create a `.env` file with `GEMINI_API_KEY=` as a placeholder
4. **Stop and ask me for my `GEMINI_API_KEY`** before writing any AI-related code — I will paste it in myself

---

### Step 1: Create `storage.py`

Handles persistence of the user's own app data between sessions.

Three functions:
- `save_my_app(data)` — saves app data so it survives a page refresh
- `load_my_app()` — returns saved data, or None if nothing saved yet
- `clear_my_app()` — resets saved data

Add the storage file to `.gitignore`.

---

### Step 2: Update `scraper.py`

Keep ALL existing extraction functions exactly as they are — they remain the fallback.

Add two new functions:

**A) `fetch_page_with_retry(url, max_retries=3)`**
- On HTTP or connection failure, retry up to 3 times
- Exponential backoff: 2s → 4s → 8s between attempts
- Rotate through 4 different browser User-Agent strings on each attempt
- Raise the final exception if all retries fail

**B) `extract_media_signals(html)`**
Extracts structural signals that are always parsed directly from HTML — never delegated to the AI. Returns:
- `screenshot_count` — number of screenshots in the app's media carousel
- `screenshot_alt_texts` — alt text of each screenshot, joined by "; "
- `has_demo_video` — True if the listing contains a video player or video embed
- `has_demo_store` — True if any link on the page points to or mentions a demo store

For screenshots: count listing images in the media section, excluding the app icon.
For demo video: detect a video element or embedded video from a video platform.
For demo store: check link text and URLs for "demo" references.

---

### Step 3: Create `extractor.py`

AI-powered structured data extraction from raw HTML. This is the primary extraction path — the existing scrapers in `scraper.py` are the fallback.

**`extract_with_gemini(html, url)`**

- Load `GEMINI_API_KEY` from environment
- Before sending, strip non-visible HTML (scripts, styles, SVGs, head section) to reduce size
- Send the cleaned HTML to Gemini with a prompt asking it to return ONLY a valid JSON object with these fields (null for anything missing):

```
app_name       — the app's display name
url_handle     — the slug at the end of the URL
tagline        — the marketing headline shown below the app name
description    — the main description paragraphs combined
features       — list of feature bullet points
rating         — numeric star rating
review_count   — total number of reviews
pricing        — pricing tier(s) shown on the page
```

- If the response isn't valid JSON, return None
- On any error, return None — never raise

**Update `scrape_app(url)` in `scraper.py`** to combine both paths:
1. Fetch HTML using `fetch_page_with_retry`
2. Always extract media signals directly from the HTML
3. Try AI extraction for copy fields first
4. If AI extraction returns None, fall back to the existing extraction functions
5. Merge copy fields + media signals + url into one dict and return it

---

### Step 4: Create `analyzer.py`

Two AI functions. Both use `GEMINI_API_KEY` from env. Both return markdown strings. Neither raises — return an error message string on failure.

**`analyze_sections(my_app, competitors)`**

Returns a dict with four markdown strings, one per section. Each is a separate AI call — pass only the fields relevant to that section:

- `title_analysis` — List all taglines. Which keywords appear most across them? Which are strongest and why? Flag if the user's tagline is vague or missing the core use case.
- `description_analysis` — Compare lengths. What topics appear in competitor descriptions but not the user's? Does the user's description follow a problem→solution structure?
- `feature_analysis` — List feature counts. Cluster all features by theme across all apps. What themes does the user cover vs miss? What features are unique to them (potential differentiators)? Flag vague bullets.
- `media_analysis` — Compare screenshot counts and alt text quality. Who has a demo video? Who has a demo store? Is the URL handle keyword-rich? (Flag handle as FYI only — it's hard to change after launch.)

**`generate_gap_report(my_app, competitors)`**

A single AI call. Use this prompt exactly:

```
You are a Shopify App Store listing expert. A developer wants to know the top gaps
between their app listing and their competitors so they can improve their install rate.

Based on the data below, identify the 3–5 most impactful gaps. For each gap:
- State what competitors do that this app doesn't
- Give a specific, concrete rewrite suggestion (not generic advice)
- Focus on things that directly affect discoverability (keywords) or conversion (clarity, benefits)

Format each gap as:
### Gap [N]: [Short title]
**What competitors do:** ...
**What you currently have:** ...
**Suggested fix:** ...

Only include gaps where the fix is specific. Maximum 5 gaps.

Your app:
{my_app}

Competitors:
{competitors}
```

---

### Step 5: Rewrite `app.py` — Full UI

**On startup:**
1. Check for `GEMINI_API_KEY` in environment. If missing: show a clear error and stop — do not proceed.
2. Load saved "Your App" data into session state
3. Initialize session state for competitors, analysis results, and gap report

**Layout:**

```
Title: "Shopify App Copy Auditor"
Subtitle: "Scrape competitors. Audit every section. Fix what matters."

━━ YOUR APP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[URL input field]  [Scrape My App button]
If saved data exists:
  → summary card: app name | tagline | rating | screenshot count | video presence
  → "Clear" button

━━ COMPETITOR APPS ━━━━━━━━━━━━━━━━━━━━━━━━━
[Text area: one URL per line]
[Scrape Competitors button]
[Progress bar + per-URL status during scraping]

━━ RESULTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tab 1: Scorecard
Tab 2: Title & Tagline
Tab 3: Description
Tab 4: Features
Tab 5: Media
Tab 6: Gap Report
```

**Tab 1 — Scorecard:**
- One table with your app in the first row (labeled "Your App"), competitors below
- Columns: App Name, Handle, Tagline (truncated 60 chars), Desc. word count, Features #, Rating, Reviews, Screenshots, Video, Demo Store, Pricing
- CSV download button — full untruncated data, all fields

**Tabs 2–5 — Section Analysis:**
- Render the relevant markdown from session state
- If not yet run: show "Scrape competitors first"
- Each tab has a "Re-analyze" button that re-runs just that section

**Tab 6 — Gap Report:**
- Render the gap report markdown from session state
- "Re-generate" button
- If not yet run: show "Scrape competitors first"

**After scraping competitors completes:**
- If Your App data exists: automatically run `analyze_sections()` and `generate_gap_report()` with a loading spinner
- Store all results in session state

---

### Step 6: Test it

Start the app and test with `https://apps.shopify.com/delta-retail-barcode` as Your App, plus 2–3 other barcode/label apps as competitors.

Verify:
- All 6 tabs render without errors
- `screenshot_count` is a number
- `has_demo_video` is True or False
- CSV downloads with all columns
- Gap Report shows specific, actionable suggestions

Show me the Gap Report output.

---

### Constraints — do not violate
- Do NOT remove or modify existing extraction functions — they are the fallback
- Media signals are ALWAYS extracted directly from HTML, even when AI handles the copy fields
- `features` in the CSV must be a semicolon-separated string, not a list
- All missing fields use `"N/A"` — never crash on missing data
- Everything must work with just 1 competitor
