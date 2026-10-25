"""Capture the real Document Library baseline against the local Flask/Postgres stack.

This is design evidence, not a product test: it registers a disposable account,
uploads the repository's sample document through the real UI, and records the
rendered control/card inventory at desktop and mobile widths.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "evidence"
SAMPLE = ROOT / "FE" / "e2e" / "fixtures" / "sample-doc.txt"
BASE_URL = "http://localhost:5191"


def settle(page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except Exception:
        # The app has background polling; DOM readiness below is authoritative.
        pass


def measure(page) -> dict:
    return page.evaluate(
        """
        () => {
          const visible = (el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' &&
              s.opacity !== '0' && r.width > 0 && r.height > 0;
          };
          const interactiveSelector = [
            'a[href]', 'button', 'input', 'select', 'textarea',
            '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
          ].join(',');
          const interactive = [...document.querySelectorAll(interactiveSelector)]
            .filter(visible);
          const cards = [...document.querySelectorAll('div.surface-card[aria-selected]')]
            .filter(visible);
          const cardNames = cards.map((card) => {
            const checkbox = card.querySelector('input[type="checkbox"][aria-label]');
            const label = checkbox?.getAttribute('aria-label') || '';
            return label.replace(/^(Chọn|Bỏ chọn)\s+/u, '').trim();
          }).filter(Boolean);
          const uniqueNames = [...new Set(cardNames)];
          const controlsPerCard = cards.map((card) =>
            [...card.querySelectorAll(interactiveSelector)].filter(visible).length
          );
          return {
            viewport: { width: innerWidth, height: innerHeight },
            document: {
              scrollWidth: document.documentElement.scrollWidth,
              scrollHeight: document.documentElement.scrollHeight,
            },
            visibleInteractiveControls: interactive.length,
            renderedStudyCards: cards.length,
            uniqueDocumentNames: uniqueNames,
            uniqueDocumentCount: uniqueNames.length,
            duplicateCardInstances: Math.max(0, cards.length - uniqueNames.length),
            cardsPerUniqueDocument: uniqueNames.length ? cards.length / uniqueNames.length : 0,
            controlsPerCard: {
              min: controlsPerCard.length ? Math.min(...controlsPerCard) : 0,
              max: controlsPerCard.length ? Math.max(...controlsPerCard) : 0,
              total: controlsPerCard.reduce((sum, value) => sum + value, 0),
            },
            headings: [...document.querySelectorAll('h1,h2')]
              .filter(visible).map((el) => el.textContent.trim()),
          };
        }
        """
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    run_id = f"{int(time.time())}"
    email = f"ux-library-{run_id}@example.test"
    password = "UX-library-test-1"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        page.goto(f"{BASE_URL}/register")
        settle(page)
        page.locator('input[type="email"]').fill(email)
        passwords = page.locator('input[type="password"]')
        passwords.nth(0).fill(password)
        passwords.nth(1).fill(password)
        page.locator('button[type="submit"]').click()
        page.wait_for_url("**/app**", timeout=20_000)

        page.goto(f"{BASE_URL}/app/study")
        settle(page)
        with page.expect_response(
            lambda response: "/api/documents/upload" in response.url
            and response.request.method == "POST",
            timeout=20_000,
        ):
            page.locator('input[type="file"]').set_input_files(str(SAMPLE))
        page.wait_for_timeout(750)
        page.reload()
        settle(page)
        page.locator('input[aria-label="Tìm trong thư viện"]').wait_for(
            state="visible", timeout=20_000
        )
        page.locator('div.surface-card[aria-selected]').first.wait_for(
            state="visible", timeout=20_000
        )

        desktop = measure(page)
        page.screenshot(path=OUT / "before-desktop-1440x900.png")
        page.screenshot(path=OUT / "before-desktop-full-page.png", full_page=True)

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(250)
        mobile = measure(page)
        page.screenshot(path=OUT / "before-mobile-390x844.png")

        evidence = {
            "capturedAtEpoch": int(time.time()),
            "baseUrl": BASE_URL,
            "backend": "http://127.0.0.1:8091",
            "account": {"kind": "fresh disposable", "email": email},
            "upload": {"path": str(SAMPLE), "throughRealUI": True},
            "desktop": desktop,
            "mobile": mobile,
        }
        (OUT / "before-measurements.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        # Keep Windows terminals with legacy code pages from turning a
        # successful capture into a false-negative process exit.
        print(json.dumps(evidence, ensure_ascii=True, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
