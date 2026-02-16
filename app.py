"""
Shopify App Store Scraper — Web Interface

A Streamlit app that scrapes Shopify App Store listings
and lets you download the results as CSV.
"""

import io
import csv
import time

import streamlit as st
import pandas as pd

from scraper import scrape_app, validate_url, CSV_FIELDS, REQUEST_DELAY

st.set_page_config(
    page_title="Shopify App Scraper",
    page_icon="🛍️",
    layout="wide",
)

st.title("Shopify App Store Scraper")
st.markdown(
    "Paste one or more Shopify app URLs below, click **Scrape**, "
    "and download the results as CSV."
)

# --- Input ---
urls_input = st.text_area(
    "App URLs (one per line)",
    placeholder=(
        "https://apps.shopify.com/delta-retail-barcode\n"
        "https://apps.shopify.com/some-other-app"
    ),
    height=120,
)

scrape_btn = st.button("Scrape", type="primary")

# --- Session state for persisting results across reruns ---
if "results" not in st.session_state:
    st.session_state.results = []

# --- Scrape logic ---
if scrape_btn:
    raw_lines = [line.strip() for line in urls_input.splitlines() if line.strip()]

    if not raw_lines:
        st.error("Please enter at least one URL.")
    else:
        urls = []
        for line in raw_lines:
            validated = validate_url(line)
            if validated:
                urls.append(validated)
            else:
                st.warning(f"Skipped invalid URL: {line}")

        if not urls:
            st.error("No valid Shopify App Store URLs found.")
        else:
            results = []
            progress = st.progress(0, text="Starting...")
            status_area = st.empty()

            for i, url in enumerate(urls):
                progress.progress(
                    (i) / len(urls),
                    text=f"Scraping {i + 1}/{len(urls)}: {url}",
                )
                status_area.info(f"Fetching: {url}")

                try:
                    data = scrape_app(url)
                    results.append(data)
                    status_area.success(f"Done: {url}")
                except Exception as e:
                    results.append({
                        "title": "N/A",
                        "description": "N/A",
                        "features": "N/A",
                        "rating": "N/A",
                        "review_count": "N/A",
                        "url": url,
                    })
                    status_area.error(f"Failed: {url} — {e}")

                # Polite delay between requests
                if i < len(urls) - 1:
                    time.sleep(REQUEST_DELAY)

            progress.progress(1.0, text="Done!")
            st.session_state.results = results

# --- Display results ---
if st.session_state.results:
    st.subheader("Results")
    df = pd.DataFrame(st.session_state.results, columns=CSV_FIELDS)
    st.dataframe(df, use_container_width=True)

    # Build CSV in memory for download
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    for row in st.session_state.results:
        writer.writerow(row)

    st.download_button(
        label="Download CSV",
        data=buf.getvalue(),
        file_name="shopify_apps_data.csv",
        mime="text/csv",
    )
