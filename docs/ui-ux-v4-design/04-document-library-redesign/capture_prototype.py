"""Render and measure Alternative A at the required desktop/mobile sizes."""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright


HERE = Path(__file__).resolve().parent
OUT = HERE / "evidence"
PROTOTYPE = HERE / "prototype-alternative-a.html"


MEASURE = """
() => {
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      style.opacity !== '0' && rect.width > 0 && rect.height > 0;
  };
  const selector = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  const controls = [...document.querySelectorAll(selector)].filter(visible);
  const rows = [...document.querySelectorAll('.document-row')].filter(visible);
  const ids = rows.map((row) => row.dataset.documentId);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    visibleInteractiveControls: controls.length,
    canonicalRows: rows.length,
    uniqueDocumentIds: new Set(ids).size,
    duplicateRowInstances: ids.length - new Set(ids).size,
    primaryResumeActions: rows.filter((row) => row.querySelectorAll('.resume').length === 1).length,
    contextualMenuTriggers: rows.filter((row) => row.querySelectorAll('.more').length === 1).length,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  };
}
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(PROTOTYPE.as_uri())
        page.wait_for_load_state("load")

        desktop = page.evaluate(MEASURE)
        page.screenshot(path=OUT / "after-a-desktop-1440x900.png")

        first_row = page.locator(".document-row").first
        second_row = page.locator(".document-row").nth(1)
        first_row.focus()
        page.keyboard.press("ArrowDown")
        keyboard_target = page.evaluate("document.activeElement?.dataset?.documentId || null")

        page.locator(".more").first.click()
        menu_labels = page.locator(".menu:not([hidden]) button").all_text_contents()
        menu_open_control_count = page.evaluate(MEASURE)["visibleInteractiveControls"]
        page.screenshot(path=OUT / "after-a-desktop-context-menu.png")

        page.set_viewport_size({"width": 390, "height": 844})
        page.reload()
        page.wait_for_load_state("load")
        mobile = page.evaluate(MEASURE)
        page.screenshot(path=OUT / "after-a-mobile-390x844.png")

        evidence = {
            "prototype": str(PROTOTYPE),
            "dataset": "42 document identities copied from the real baseline capture",
            "desktopDefault": desktop,
            "desktopOneContextMenuOpen": {
                "visibleInteractiveControls": menu_open_control_count,
                "documentScopedActions": menu_labels,
            },
            "keyboard": {
                "startDocumentId": first_row.get_attribute("data-document-id"),
                "afterArrowDownDocumentId": keyboard_target,
                "expectedDocumentId": second_row.get_attribute("data-document-id"),
                "passed": keyboard_target == second_row.get_attribute("data-document-id"),
            },
            "mobileDefault": mobile,
        }
        (OUT / "after-a-measurements.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(evidence, ensure_ascii=True, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
