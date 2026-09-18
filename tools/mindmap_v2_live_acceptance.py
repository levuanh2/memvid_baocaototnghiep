"""Minimal browser harness for the post-deploy Mind Map V2 gate.

Run only against a disposable QA account. This intentionally fails fast when
credentials are absent and records browser/network evidence instead of
turning unavailable live data into a passing fixture result.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.getenv("BASE_URL", "https://studymap.space/app")
EMAIL = os.getenv("QA_EMAIL")
PASSWORD = os.getenv("QA_PASSWORD")
OUT = Path(os.getenv("QA_OUTPUT", "docs/qa-screenshots/mindmap-v2-live"))


def main() -> None:
    if not EMAIL or not PASSWORD:
        raise SystemExit("Set QA_EMAIL and QA_PASSWORD for a disposable QA account")
    OUT.mkdir(parents=True, exist_ok=True)
    console_errors: list[str] = []
    failed_requests: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1024})
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("requestfailed", lambda request: failed_requests.append(f"{request.method} {request.url}"))
        page.goto(BASE_URL, wait_until="networkidle")
        if "/login" in page.url:
            page.get_by_label("Email").fill(EMAIL)
            page.get_by_label("Mật khẩu").fill(PASSWORD)
            page.get_by_role("button", name="Đăng nhập").click()
            page.wait_for_url("**/app**")
            page.wait_for_load_state("networkidle")
        page.get_by_role("tab", name="Sơ đồ tư duy").click()
        page.wait_for_timeout(1000)
        page.screenshot(path=str(OUT / "desktop-light.png"), full_page=True)
        assert page.locator(".mm-context-row").count() == 1
        assert page.locator(".mm-generate-cta").count() == 0
        assert page.locator(".mm-inspector-drawer").count() == 1
        assert page.locator(".mm-inspector-drawer").get_attribute("aria-hidden") == "true"
        for theme, class_name in (("light", ""), ("dark", "dark")):
            page.locator("html").evaluate("(el, cls) => el.className = cls", class_name)
            for width, height in ((1440, 1024), (1024, 768), (390, 844)):
                page.set_viewport_size({"width": width, "height": height})
                page.screenshot(path=str(OUT / f"{theme}-{width}x{height}.png"), full_page=True)
        (OUT / "console-errors.txt").write_text("\n".join(console_errors), encoding="utf-8")
        (OUT / "failed-requests.txt").write_text("\n".join(failed_requests), encoding="utf-8")
        browser.close()
    print(f"screenshots={OUT}")
    print(f"console_errors={len(console_errors)} failed_requests={len(failed_requests)}")


if __name__ == "__main__":
    main()
