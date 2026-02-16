"""
Shopify App Store Scraper — Core Library

Extracts structured data (title, description, features, rating,
review count) from Shopify App Store listing pages.
"""

import json
import re
import time

import requests
from bs4 import BeautifulSoup

CSV_FIELDS = ["title", "description", "features", "rating", "review_count", "url"]
REQUEST_DELAY = 2  # seconds between requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


def fetch_page(url):
    """Fetch the HTML content of a Shopify app listing page."""
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    return response.text


def extract_title(soup):
    """
    Extract the app's marketing headline/tagline.

    Looks for the full marketing headline shown below the app name,
    not just the app name itself.
    """
    # Strategy 1: Look in the hero section (#adp-hero)
    hero = soup.select_one("#adp-hero")
    if hero:
        h2 = hero.select_one("h2")
        if h2 and h2.get_text(strip=True):
            return h2.get_text(strip=True)

        for p in hero.select("p"):
            text = p.get_text(strip=True)
            if text and len(text) > 10:
                return text

    # Strategy 2: Parse from <title> tag
    # Format: "App Name - Tagline | Shopify App Store"
    title_tag = soup.select_one("title")
    if title_tag:
        title_text = title_tag.get_text(strip=True)
        title_text = re.sub(r"\s*\|\s*Shopify App Store\s*$", "", title_text)
        if " - " in title_text:
            tagline = title_text.split(" - ", 1)[1].strip()
            if tagline:
                return tagline
        return title_text

    # Strategy 3: og:description meta tag
    og_desc = soup.select_one('meta[property="og:description"]')
    if og_desc and og_desc.get("content", "").strip():
        return og_desc["content"].strip()

    # Strategy 4: meta description
    meta_desc = soup.select_one('meta[name="description"]')
    if meta_desc and meta_desc.get("content", "").strip():
        return meta_desc["content"].strip()

    return "N/A"


def extract_description(soup):
    """Extract the main app description paragraph(s) from #app-details."""
    app_details = soup.select_one("#app-details")
    if app_details:
        paragraphs = []
        for child in app_details.children:
            if hasattr(child, "name"):
                if child.name == "ul":
                    continue
                if child.name in ("p", "div", "h2", "h3"):
                    text = child.get_text(strip=True)
                    if text:
                        paragraphs.append(text)
            elif isinstance(child, str) and child.strip():
                paragraphs.append(child.strip())

        if paragraphs:
            return " ".join(paragraphs)

        text = app_details.get_text(separator=" ", strip=True)
        if text:
            return text

    og_desc = soup.select_one('meta[property="og:description"]')
    if og_desc and og_desc.get("content", "").strip():
        return og_desc["content"].strip()

    meta_desc = soup.select_one('meta[name="description"]')
    if meta_desc and meta_desc.get("content", "").strip():
        return meta_desc["content"].strip()

    return "N/A"


def extract_features(soup):
    """Extract the bullet-point feature list as a semicolon-separated string."""
    features = []

    # Strategy 1: Direct children ul > li in #app-details
    benefit_items = soup.select("#app-details > ul > li")
    if benefit_items:
        for li in benefit_items:
            text = li.get_text(strip=True)
            if text:
                features.append(text)

    # Strategy 2: Any ul within #app-details
    if not features:
        app_details = soup.select_one("#app-details")
        if app_details:
            for ul in app_details.select("ul"):
                for li in ul.select("li"):
                    text = li.get_text(strip=True)
                    if text:
                        features.append(text)

    if features:
        return "; ".join(features)
    return "N/A"


def extract_rating(soup):
    """Extract the average star rating (e.g. 4.8)."""
    # Strategy 1: Hero section rating element
    rating_el = soup.select_one("#adp-hero dd > span.tw-text-fg-secondary")
    if rating_el:
        text = rating_el.get_text(strip=True)
        match = re.search(r"(\d+\.?\d*)", text)
        if match:
            return match.group(1)

    # Strategy 2: aria-label on star elements
    for el in soup.select("[aria-label]"):
        label = el.get("aria-label", "")
        match = re.match(r"^(\d+\.?\d*)\s*out\s*of\s*\d+\s*stars?", label)
        if match:
            return match.group(1)

    # Strategy 3: Any dd in hero with a rating-like number
    hero = soup.select_one("#adp-hero")
    if hero:
        for dd in hero.select("dd"):
            text = dd.get_text(strip=True)
            match = re.search(r"(\d+\.\d+)", text)
            if match:
                val = float(match.group(1))
                if 0 < val <= 5:
                    return match.group(1)

    # Strategy 4: JSON-LD structured data
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string)
            if isinstance(data, dict):
                agg = data.get("aggregateRating", {})
                if agg.get("ratingValue"):
                    return str(agg["ratingValue"])
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    return "N/A"


def extract_review_count(soup):
    """Extract the total number of reviews (e.g. 523)."""
    # Strategy 1: #reviews-link element
    reviews_link = soup.select_one("#reviews-link")
    if reviews_link:
        text = reviews_link.get_text(strip=True)
        match = re.search(r"(\d[\d,]*)", text)
        if match:
            return match.group(1).replace(",", "")

    # Strategy 2: Links with "review" text in hero
    hero = soup.select_one("#adp-hero")
    if hero:
        for a in hero.select("a"):
            text = a.get_text(strip=True)
            if "review" in text.lower():
                match = re.search(r"(\d[\d,]*)", text)
                if match:
                    return match.group(1).replace(",", "")

    # Strategy 3: JSON-LD structured data
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string)
            if isinstance(data, dict):
                agg = data.get("aggregateRating", {})
                if agg.get("reviewCount"):
                    return str(agg["reviewCount"])
                if agg.get("ratingCount"):
                    return str(agg["ratingCount"])
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    # Strategy 4: Any element with "X reviews" text
    for el in soup.select("a, span, div"):
        text = el.get_text(strip=True)
        match = re.match(r"^(\d[\d,]*)\s+reviews?$", text, re.IGNORECASE)
        if match:
            return match.group(1).replace(",", "")

    return "N/A"


def scrape_app(url):
    """
    Scrape a single Shopify app listing page and return structured data.

    Returns a dict with keys matching CSV_FIELDS.
    Raises on network/HTTP errors.
    """
    html = fetch_page(url)
    soup = BeautifulSoup(html, "lxml")

    return {
        "title": extract_title(soup),
        "description": extract_description(soup),
        "features": extract_features(soup),
        "rating": extract_rating(soup),
        "review_count": extract_review_count(soup),
        "url": url,
    }


def validate_url(url):
    """Normalize and validate a Shopify App Store URL."""
    url = url.strip()
    if not url:
        return None
    if not url.startswith("http"):
        url = "https://" + url
    if "apps.shopify.com" not in url:
        return None
    return url
