from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("REVIEW_UI_URL", "http://127.0.0.1:8765")
SCREENSHOT = Path(os.environ.get("REVIEW_UI_SCREENSHOT", "reports/evaluation/review_interface.png"))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    assert page.get_by_role("heading", name="Sign the annotation ledger").is_visible()
    page.get_by_label("Reviewer ID").fill("R_UI_TEST")
    page.get_by_role("button", name="Start or resume review").click()
    page.wait_for_selector("text=1 / 60")
    assert "CANDIDATE" in page.locator(".candidate-stamp").inner_text()
    assert "NOT GROUND TRUTH" in page.locator(".candidate-stamp").inner_text()
    assert page.get_by_text("EXACT SOURCE TEXT", exact=False).first.is_visible()

    page.get_by_role("button", name="Save human decision").click()
    page.wait_for_selector("text=an explicit query Approve, Edit, or Reject decision is required")

    page.locator("#query-decision").select_option("reject")
    page.locator("#notes").fill("Browser validation only")
    page.get_by_role("button", name="Save human decision").click()
    page.wait_for_selector("text=Human decision autosaved")
    assert page.locator("#query-decision").input_value() == "reject"

    page.reload()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Start or resume review").click()
    page.wait_for_selector("text=1 / 60")
    assert page.locator("#query-decision").input_value() == "reject"
    page.get_by_role("button", name="Progress & export").click()
    assert page.get_by_text("1 approved", exact=False).count() == 0
    assert page.get_by_text("1 rejected", exact=False).is_visible()
    assert page.get_by_role("button", name="Export reviewed files").is_disabled()

    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SCREENSHOT), full_page=True)
    browser.close()

print("BROWSER_REVIEW_UI_OK")
