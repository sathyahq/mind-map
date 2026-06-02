# Claude Code Build Prompt

Copy-paste everything below the line into Claude Code in VS Code.

---

## Prompt

Build a Streamlit web app that scrapes Shopify App Store listings and runs a section-by-section copy and media audit — helping a developer improve their own app listing by seeing exactly how competitors compare across every part of the page.

### Before you start

1. Read every existing file in the repo: `scraper.py`, `app.py`, `requirements.txt`, `.streamlit/config.toml`, `.gitignore`
2. Read `PRD.md` — it is the source of truth for what to build
3. Add `.env` to `.gitignore` immediately, then create a `.env` file with `GEMINI_API_KEY=` as a placeholder
4. **Stop and ask me for my `GEMINI_API_KEY`** before writing any Gemini code — I will paste it into the `.env` file myself

### Dependencies to add to requirements.txt
```
google-generativeai>=0.8.0
python-dotenv>=1.0.0
```

---

### Step 1: Create `storage.py`

Handles persistence of the user's own app data between sessions.

```python
# Functions to implement:
save_my_app(data: dict)        # write to my_app.json
load_my_app() -> dict | None   # read from my_app.json, return None if missing
clear_my_app()                 # delete my_app.json
```

- Add `my_app.json` to `.gitignore`

---

### Step 2: Update `scraper.py`

Keep ALL existing BeautifulSoup extraction functions exactly as they are — they are the fallback.

Add these two things:

**A) `fetch_page_with_retry(url, max_retries=3) -> str`**
- Retry on any HTTP error or connection error
- Exponential backoff: wait 2s, then 4s, then 8s between attempts
- Rotate through these User-Agent strings on each attempt:
  1. `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
  2. `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36`
  3. `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36`
  4. `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15`
- Raise the last exception if all retries fail

**B) `extract_media_signals(soup) -> dict`**
A BeautifulSoup-only function that extracts structural signals from the HTML.
Always called directly — never replaced by Gemini. Returns:
```python
{
  "screenshot_count": int,           # count of <img> in the screenshot carousel
  "screenshot_alt_texts": str,       # alt texts joined by "; "
  "has_demo_video": bool,            # True if <video> tag or YouTube iframe found
  "has_demo_store": bool,            # True if any link text/href mentions "demo store" or "try demo"
}
```

For screenshots: look for images inside `[data-media-type="image"]` or `#app-media` or any `<img>` with `src` containing `/cdn/` that is not a logo (skip images smaller than 400px wide if width attr available, or skip the first `<img>` in `#adp-hero` which is typically the app icon).

For demo video: check for `<video>` tag, or `<iframe>` with `src` containing `youtube.com` or `youtu.be` or `vimeo.com`.

For demo store: check for any `<a>` whose text or href contains "demo" or "try it" (case-insensitive).

---

### Step 3: Create `extractor.py`

Gemini-powered structured data extraction. Primary path — BeautifulSoup is the fallback.

**`extract_with_gemini(html: str, url: str) -> dict | None`**

- Load `GEMINI_API_KEY` from environment (use `python-dotenv` to load `.env`)
- Use model `gemini-2.5-flash`
- Trim the HTML before sending: strip `<script>`, `<style>`, `<svg>`, `<head>` tags to reduce token count, keep the rest
- Send the trimmed HTML with this extraction prompt:

```
You are extracting structured data from a Shopify App Store listing page.
Return ONLY a valid JSON object with exactly these fields (use null for missing values):

{
  "app_name": "the app display name",
  "url_handle": "the slug from the URL path, e.g. delta-retail-barcode",
  "tagline": "the marketing headline shown below the app name",
  "description": "the main description paragraphs combined into one string",
  "features": ["feature 1", "feature 2", "feature 3"],
  "rating": 4.8,
  "review_count": 523,
  "pricing": "Free / Free plan available / $9.99/month"
}

The URL is: {url}
```

- Parse the JSON response. If parsing fails, return `None`.
- On any exception (network, quota, etc.), return `None` — never raise.

**`scrape_app(url: str) -> dict`**

Replace the existing `scrape_app` in `scraper.py` with this combined function:

```python
def scrape_app(url):
    html = fetch_page_with_retry(url)
    soup = BeautifulSoup(html, "lxml")

    # Always extract media signals via BeautifulSoup
    media = extract_media_signals(soup)

    # Try Gemini first for copy fields
    gemini_data = extract_with_gemini(html, url)

    if gemini_data:
        copy_data = {
            "app_name": gemini_data.get("app_name") or "N/A",
            "url_handle": gemini_data.get("url_handle") or url.split("/")[-1],
            "tagline": gemini_data.get("tagline") or "N/A",
            "description": gemini_data.get("description") or "N/A",
            "features": "; ".join(gemini_data.get("features") or []) or "N/A",
            "feature_count": len(gemini_data.get("features") or []),
            "rating": str(gemini_data.get("rating") or "N/A"),
            "review_count": str(gemini_data.get("review_count") or "N/A"),
            "pricing": gemini_data.get("pricing") or "N/A",
        }
    else:
        # BeautifulSoup fallback for copy fields
        copy_data = {
            "app_name": extract_app_name(soup),   # add this BS function if missing
            "url_handle": url.split("/")[-1],
            "tagline": extract_title(soup),
            "description": extract_description(soup),
            "features": extract_features(soup),
            "feature_count": len(extract_features(soup).split("; ")) if extract_features(soup) != "N/A" else 0,
            "rating": extract_rating(soup),
            "review_count": extract_review_count(soup),
            "pricing": "N/A",
        }

    return {**copy_data, **media, "url": url}
```

---

### Step 4: Create `analyzer.py`

Two Gemini functions. Both load `GEMINI_API_KEY` from env. Both use `gemini-2.5-flash`. Both return strings (markdown). Neither raises — return an error string on failure.

**`analyze_sections(my_app: dict, competitors: list[dict]) -> dict`**

Returns a dict with four keys, each a markdown string:

- `"title_analysis"` — Analyze all taglines. List them. Which keywords appear most? Which taglines are strongest and why? Flag if the user's tagline is vague or missing the core use case.
- `"description_analysis"` — Compare word counts. What topics/themes appear in competitor descriptions but not the user's? Does the user's description lead with a problem→solution structure?
- `"feature_analysis"` — List feature counts per app. Cluster all features by theme across all apps. Which feature themes does the user cover? Which are they missing? Which are unique to them (potential differentiators)? Flag any vague bullets.
- `"media_analysis"` — Compare screenshot counts and alt text quality. Who has a demo video? Who has a demo store? Is the user's URL handle keyword-rich? (Note: handle is permanent after launch, include as FYI only.)

Send each analysis as a separate Gemini call. Pass only the relevant fields for each section (don't send the full data for every call).

**`generate_gap_report(my_app: dict, competitors: list[dict]) -> str`**

A single Gemini call that produces a tight, actionable gap report.

Prompt:
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

**Page config:**
```python
st.set_page_config(page_title="Shopify App Copy Auditor", page_icon="🛍️", layout="wide")
```

**On startup:**
1. Load `GEMINI_API_KEY` from env. If missing: `st.error("GEMINI_API_KEY not set. Add it to your .env file or environment.")` then `st.stop()`
2. Load saved "Your App" from `my_app.json` into `st.session_state.my_app`
3. Initialize `st.session_state.competitors = []` if not set
4. Initialize `st.session_state.analysis = {}` if not set

**Layout:**

```
Title: "Shopify App Copy Auditor"
Subtitle: "Scrape competitors. Audit every section. Fix what matters."

━━ YOUR APP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[text input: Shopify App Store URL]  [Scrape My App]
(if st.session_state.my_app:)
  → green success card showing: app_name | tagline | rating | screenshots | video
  → small "Clear" button

━━ COMPETITOR APPS ━━━━━━━━━━━━━━━━━━━━━━━━━
[text area: one URL per line, up to 50]
[Scrape Competitors]
[progress bar during scraping]

━━ RESULTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tab 1: Scorecard
Tab 2: Title & Tagline
Tab 3: Description
Tab 4: Features
Tab 5: Media
Tab 6: Gap Report
```

**Tab 1 — Scorecard:**
- Combine `st.session_state.my_app` + `st.session_state.competitors` into a pandas DataFrame
- Columns: App Name, URL Handle, Tagline (60 chars), Description (word count), Features (#), Rating, Reviews, Screenshots, Video, Demo Store, Pricing
- Your app row first, labeled "(Your App)"
- Download CSV button below the table
- CSV includes all raw fields (full description, full features, all alt texts, etc.)

**Tabs 2–5 — Section Analysis:**
- Show the relevant markdown from `st.session_state.analysis`
- If analysis not yet run: show a muted message "Run scrape first"
- Each tab has a "Re-analyze this section" button that re-calls just that Gemini function

**Tab 6 — Gap Report:**
- Show `st.session_state.gap_report` rendered as markdown
- "Re-generate Gap Report" button
- If not yet run: "Run scrape first"

**Behavior after scraping competitors:**
- If `st.session_state.my_app` exists: automatically run `analyze_sections()` and `generate_gap_report()` in sequence, showing a spinner
- Store results in `st.session_state.analysis` and `st.session_state.gap_report`

---

### Step 6: Test it

Run `streamlit run app.py`.

Test with this URL as "Your App": `https://apps.shopify.com/delta-retail-barcode`

Then add 2–3 other barcode/SKU apps from the Shopify App Store as competitors.

Verify:
- All 6 tabs render without errors
- Screenshot count is a number, not N/A
- `has_demo_video` is True or False
- CSV download works and contains all columns
- Gap report produces specific, actionable suggestions

Show me the output of the Gap Report tab.

---

### Important constraints
- Do NOT remove or gut existing BeautifulSoup functions in `scraper.py` — they are the fallback
- Media signals (`screenshot_count`, `has_demo_video`, etc.) are ALWAYS extracted via BeautifulSoup, even when Gemini handles the copy
- `features` in the CSV must be a semicolon-separated string, not a Python list
- All missing fields: use `"N/A"`, never crash
- Keep `.streamlit/config.toml` theme unchanged
- The Scorecard and all tabs must work with just 1 competitor (don't require 2+)
