"""Render, interact with, and measure Alternative B in Chromium."""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright


HERE = Path(__file__).resolve().parent
OUT = HERE / "evidence"
PROTOTYPE = HERE / "prototype-alternative-b.html"


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
    primaryActions: rows.filter((row) => row.querySelectorAll('.primary-action').length === 1).length,
    directQuickActions: rows.reduce((sum, row) => sum + row.querySelectorAll('.quick-action').length, 0),
    contextualTriggers: rows.filter((row) => row.querySelectorAll('.more-action').length === 1).length,
    focusableRows: rows.filter((row) => row.tabIndex >= 0).length,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  };
}
"""

MOBILE_TARGETS = """
() => {
  const dimensions = (selector) => [...document.querySelectorAll(selector)].map((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const rawGroups = {
    checkboxes: dimensions('.check-target'),
    primaryActions: dimensions('.primary-action'),
    quickActions: dimensions('.quick-action'),
    moreActions: dimensions('.more-action'),
  };
  const all = Object.values(rawGroups).flat();
  const groups = Object.fromEntries(Object.entries(rawGroups).map(([name, values]) => [name, {
    count: values.length,
    minimumWidth: Math.min(...values.map(({ width }) => width)),
    minimumHeight: Math.min(...values.map(({ height }) => height)),
  }]));
  return {
    ...groups,
    minimumWidth: Math.min(...all.map(({ width }) => width)),
    minimumHeight: Math.min(...all.map(({ height }) => height)),
    allAtLeast44By44: all.every(({ width, height }) => width >= 44 && height >= 44),
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
        page.screenshot(path=OUT / "after-b-desktop-1440x900.png")

        first_primary = page.locator(".primary-action").first
        first_primary.focus()
        start_id = first_primary.locator("xpath=ancestor::*[contains(@class,'document-row')]").get_attribute("data-document-id")
        page.keyboard.press("ArrowDown")
        keyboard_target = page.evaluate(
            "document.activeElement?.closest('.document-row')?.dataset?.documentId || null"
        )

        page.get_by_role("button", name="Cần tóm tắt").click()
        contextual_labels = page.locator(".primary-action").all_text_contents()
        contextual_passed = bool(contextual_labels) and all(
            label == "Tạo tóm tắt" for label in contextual_labels
        )
        page.screenshot(path=OUT / "after-b-desktop-summary-view.png")

        page.locator('[data-view="all"]').click()
        page.locator(".more-action").first.click()
        panel_actions = page.locator(".tool-panel:not([hidden]) .tool-action").all_text_contents()
        desktop_open_controls = page.evaluate(MEASURE)["visibleInteractiveControls"]
        page.screenshot(path=OUT / "after-b-desktop-tools.png")

        page.set_viewport_size({"width": 390, "height": 844})
        page.reload()
        page.wait_for_load_state("load")
        mobile = page.evaluate(MEASURE)
        mobile_targets = page.evaluate(MOBILE_TARGETS)
        page.screenshot(path=OUT / "after-b-mobile-390x844.png")

        mobile_trigger = page.locator(".more-action").first
        mobile_trigger.click()
        panel = page.locator(".tool-panel:not([hidden])")
        panel.wait_for(state="visible")
        mobile_sheet = {
            "visibleInteractiveControls": page.evaluate(MEASURE)["visibleInteractiveControls"],
            "backdropVisible": page.locator("#sheet-backdrop").is_visible(),
            "backgroundInert": page.locator("#main-content").evaluate("el => el.inert"),
            "focusInside": page.evaluate("document.activeElement?.closest('.tool-panel') != null"),
            "actions": panel.locator(".tool-action").all_text_contents(),
        }
        page.screenshot(path=OUT / "after-b-mobile-tool-sheet.png")
        page.keyboard.press("Escape")
        focus_restored = page.evaluate("document.activeElement?.classList.contains('more-action') || false")

        evidence = {
            "prototype": str(PROTOTYPE),
            "dataset": "42 document identities copied from the real baseline capture",
            "desktopDefault": desktop,
            "desktopTaskView": {
                "view": "needs_summary",
                "primaryLabels": contextual_labels,
                "allPrimaryLabelsMatchIntent": contextual_passed,
            },
            "desktopOneToolPanelOpen": {
                "visibleInteractiveControls": desktop_open_controls,
                "documentScopedActions": panel_actions,
            },
            "keyboard": {
                "startDocumentId": start_id,
                "afterArrowDownDocumentId": keyboard_target,
                "expectedDocumentId": "doc-2",
                "passed": keyboard_target == "doc-2",
                "rowContainersFocusable": desktop["focusableRows"],
            },
            "mobileDefault": mobile,
            "mobileTargetGeometry": mobile_targets,
            "mobileToolSheet": {**mobile_sheet, "escapeRestoredTriggerFocus": focus_restored},
        }
        (OUT / "after-b-measurements.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(evidence, ensure_ascii=True, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
