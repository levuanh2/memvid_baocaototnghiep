"""QA-only Brave/Playwright capture and interaction probe for the fixture harness."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "qa-screenshots" / "guided-mindmap-v3"
URL = "http://127.0.0.1:4173/qa/guided-mindmap-harness.html"
BRAVE = r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"


def capture(page, *, name, width, height, state="ready", mobile=False, dark=False):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"{URL}?state={state}&mobile={int(mobile)}&dark={int(dark)}")
    page.wait_for_load_state("networkidle")
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
    dialog = page.get_by_role("dialog")
    return {
        "name": name,
        "viewport": f"{width}x{height}",
        "state": state,
        "dark": dark,
        "dialog": dialog.count(),
        "overflow": page.evaluate("document.documentElement.scrollWidth > window.innerWidth"),
        "console_errors": 0,
        "body_text": page.locator("body").inner_text()[:240],
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    records = []
    console_errors = []
    page_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=BRAVE)
        page = browser.new_page()
        page.route("http://localhost:8080/**", lambda route: route.fulfill(status=200, content_type="application/json", body='{"mindmaps":[{"id":"fixture-map-1","title":"Triển khai hệ thống","sources":["fixture-source"],"created_at":"2026-09-20T00:00:00Z"},{"id":"fixture-map-2","title":"So sánh kiến trúc","sources":["fixture-source"],"created_at":"2026-09-19T00:00:00Z"}],"summaries":[]}'))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        for dark in (False, True):
            records.append(capture(page, name=f"guided-dialog-desktop-{'dark' if dark else 'light'}", width=1440, height=1024, dark=dark))
            records.append(capture(page, name=f"guided-dialog-tablet-{'dark' if dark else 'light'}", width=1024, height=768, dark=dark))
            records.append(capture(page, name=f"guided-bottom-sheet-mobile-{'dark' if dark else 'light'}", width=390, height=844, mobile=True, dark=dark))
        for state in ("loading", "empty", "error", "ready"):
            records.append(capture(page, name=f"guided-dialog-{state}-desktop", width=1440, height=1024, state=state))
        records.append(capture(page, name="guided-workspace-inspector-desktop", width=1440, height=1024, state="workspace"))
        records.append(capture(page, name="guided-workspace-inspector-tablet", width=1024, height=768, state="workspace"))
        records.append(capture(page, name="guided-workspace-inspector-mobile", width=390, height=844, state="workspace", mobile=True))

        # Interaction probe on the real dialog component.
        page.goto(f"{URL}?state=ready&mobile=1")
        page.wait_for_load_state("networkidle")
        dialog = page.get_by_role("dialog")
        dialog.locator('button[title="Fixture evidence"]').nth(1).click()
        page.locator("textarea").fill("Tập trung vào quy trình triển khai")
        page.locator('label:has(input[value="process"])').click()
        page.locator('label:has(input[value="detailed"])').click()
        touch_targets = page.locator("button").evaluate_all("els => els.map(e => ({name:e.getAttribute('aria-label') || e.textContent.trim(), w:e.getBoundingClientRect().width, h:e.getBoundingClientRect().height}))")
        duplicate_guard_disabled = page.locator('button[type="submit"]').is_disabled()
        page.keyboard.press("Escape")
        escape_closed = page.get_by_role("dialog").count() == 0
        browser.close()
    for item in records:
        item["console_errors"] = len(console_errors)
    print(json.dumps({"browser": BRAVE, "records": records, "console_errors": console_errors, "page_errors": page_errors, "escape_closed": escape_closed, "duplicate_guard_disabled": duplicate_guard_disabled, "touch_targets": touch_targets}, ensure_ascii=True))


if __name__ == "__main__":
    main()
