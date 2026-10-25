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

        def row_ids() -> list[str]:
            return page.locator(".document-row").evaluate_all(
                "rows => rows.map(row => row.dataset.documentId)"
            )

        def task_count(view: str) -> str:
            return page.locator(f'[data-view="{view}"] [data-view-count]').inner_text()

        desktop = page.evaluate(MEASURE)
        assert desktop["canonicalRows"] == 42
        assert desktop["duplicateRowInstances"] == 0
        assert page.locator('[data-document-id="doc-1"] .primary-action').inner_text() == "Tiếp tục · Ôn tập"
        page.screenshot(path=OUT / "after-b-desktop-1440x900.png")

        first_primary = page.locator(".primary-action").first
        first_primary.focus()
        start_id = first_primary.locator("xpath=ancestor::*[contains(@class,'document-row')]").get_attribute("data-document-id")
        page.keyboard.press("ArrowDown")
        keyboard_target = page.evaluate(
            "document.activeElement?.closest('.document-row')?.dataset?.documentId || null"
        )
        assert keyboard_target == "doc-2"

        page.locator('[data-view="continue"]').click()
        continue_ids = row_ids()
        continue_label = page.locator(".primary-action").inner_text()
        assert continue_ids == ["doc-1"]
        assert continue_label == "Tiếp tục · Ôn tập"
        assert task_count("continue") == "1 đang dở"
        page.locator('[data-view="all"]').click()

        # A ready-summary record and a missing-summary record begin selected.
        # Changing the projection must synchronously prune the hidden UUID.
        page.locator('[data-document-id="doc-1"] input[type="checkbox"]').check()
        page.locator('[data-document-id="doc-2"] input[type="checkbox"]').check()

        page.locator('[data-view="summary"]').click()
        summary_ids = row_ids()
        contextual_labels = page.locator(".primary-action").all_text_contents()
        contextual_passed = bool(contextual_labels) and all(
            label == "Tạo tóm tắt" for label in contextual_labels
        )
        assert len(summary_ids) == 36
        assert "doc-1" not in summary_ids, "completed-summary doc must be excluded"
        assert "doc-2" in summary_ids
        assert contextual_passed
        assert task_count("summary") == f"{len(summary_ids)} tài liệu"
        assert page.locator("#selected-count").inner_text() == "1 đã chọn"
        assert page.locator('[data-document-id="doc-2"] input[type="checkbox"]').is_checked()
        page.screenshot(path=OUT / "after-b-desktop-summary-view.png")

        page.locator('[data-view="all"]').click()
        hidden_selection_pruned = (
            not page.locator('[data-document-id="doc-1"] input[type="checkbox"]').is_checked()
            and page.locator('[data-document-id="doc-2"] input[type="checkbox"]').is_checked()
        )
        assert hidden_selection_pruned
        page.locator('[data-document-id="doc-2"] input[type="checkbox"]').uncheck()

        page.locator('[data-view="quiz"]').click()
        quiz_ids = row_ids()
        quiz_labels = page.locator(".primary-action").all_text_contents()
        assert len(quiz_ids) == 35
        assert "doc-1" not in quiz_ids, "ready-quiz doc must be excluded"
        assert "doc-2" in quiz_ids
        assert all(label == "Tạo quiz" for label in quiz_labels)
        assert task_count("quiz") == f"{len(quiz_ids)} tài liệu"

        # All four projection stages compose: query + collection + task + sort.
        page.locator('[data-collection="pinned"]').click()
        page.locator("#search").fill("sample-doc")
        page.locator("#sort").select_option("az")
        composed_tab_counts = {}
        for target_view in ("all", "continue", "quiz", "summary"):
            page.locator(f'[data-view="{target_view}"]').click()
            rendered_count = len(row_ids())
            label = task_count(target_view)
            composed_tab_counts[target_view] = {
                "label": label,
                "renderedCount": rendered_count,
                "matches": int(label.split()[0]) == rendered_count,
            }
            assert composed_tab_counts[target_view]["matches"]
        page.locator('[data-view="summary"]').click()
        composed_ids = row_ids()
        composed_task_count = task_count("summary")
        assert composed_ids == ["doc-9", "doc-2"]
        assert composed_task_count == f"{len(composed_ids)} tài liệu"
        assert page.locator("#visible-count").inner_text() == str(len(composed_ids))

        filtered_primary = page.locator(".primary-action").first
        filtered_primary.focus()
        filtered_start = page.evaluate(
            "document.activeElement?.closest('.document-row')?.dataset?.documentId || null"
        )
        page.keyboard.press("ArrowDown")
        filtered_down = page.evaluate(
            "document.activeElement?.closest('.document-row')?.dataset?.documentId || null"
        )
        page.keyboard.press("ArrowUp")
        filtered_up = page.evaluate(
            "document.activeElement?.closest('.document-row')?.dataset?.documentId || null"
        )
        assert (filtered_start, filtered_down, filtered_up) == ("doc-9", "doc-2", "doc-9")
        assert page.locator('.primary-action[tabindex="0"]').count() == 1

        # Favorites are all summary-ready in this deterministic fixture, so
        # Needs Summary has no members and must render an explicit empty state.
        page.locator('[data-collection="favorite"]').click()
        empty_state = {
            "renderedRows": len(row_ids()),
            "message": page.locator(".empty-state").inner_text(),
            "activeTaskCount": task_count("summary"),
            "selectAllDisabled": page.locator("#select-all").is_disabled(),
        }
        assert empty_state["renderedRows"] == 0
        assert "Không có tài liệu phù hợp" in empty_state["message"]
        assert empty_state["activeTaskCount"] == "0 tài liệu"
        assert empty_state["selectAllDisabled"]
        page.screenshot(path=OUT / "after-b-desktop-empty-state.png")

        page.locator('[data-collection="all"]').click()
        page.locator("#search").fill("")
        page.locator("#sort").select_option("newest")
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
        assert mobile_targets["allAtLeast44By44"]
        assert mobile_sheet["backdropVisible"]
        assert mobile_sheet["backgroundInert"]
        assert mobile_sheet["focusInside"]
        assert focus_restored

        evidence = {
            "prototype": str(PROTOTYPE),
            "dataset": "42 document identities copied from the real baseline capture",
            "desktopDefault": desktop,
            "desktopTaskView": {
                "view": "needs_summary",
                "renderedDocumentIds": summary_ids,
                "renderedCount": len(summary_ids),
                "taskCountLabel": f"{len(summary_ids)} tài liệu",
                "completedSummaryDocument": "doc-1",
                "completedSummaryExcluded": "doc-1" not in summary_ids,
                "missingSummaryDocument": "doc-2",
                "missingSummaryIncluded": "doc-2" in summary_ids,
                "primaryLabels": contextual_labels,
                "allPrimaryLabelsMatchIntent": contextual_passed,
            },
            "desktopContinueTaskView": {
                "renderedDocumentIds": continue_ids,
                "primaryLabel": continue_label,
                "resumeSemanticsUnchanged": continue_ids == ["doc-1"] and continue_label == "Tiếp tục · Ôn tập",
            },
            "desktopQuizTaskView": {
                "renderedCount": len(quiz_ids),
                "taskCountLabel": f"{len(quiz_ids)} tài liệu",
                "readyQuizDocument": "doc-1",
                "readyQuizExcluded": "doc-1" not in quiz_ids,
                "missingQuizDocument": "doc-2",
                "missingQuizIncluded": "doc-2" in quiz_ids,
                "allPrimaryLabelsMatchIntent": all(label == "Tạo quiz" for label in quiz_labels),
            },
            "selectionSafety": {
                "initiallySelected": ["doc-1", "doc-2"],
                "hiddenCompletedSummaryPruned": hidden_selection_pruned,
                "selectedCountInNeedsSummary": 1,
            },
            "composedProjection": {
                "search": "sample-doc",
                "collection": "pinned",
                "taskView": "needs_summary",
                "sort": "az",
                "renderedDocumentIds": composed_ids,
                "taskCountLabel": composed_task_count,
                "taskCountMatchesRendered": composed_task_count == f"{len(composed_ids)} tài liệu",
                "allTabCountsMatchTheirRenderedMembership": all(
                    item["matches"] for item in composed_tab_counts.values()
                ),
                "tabCounts": composed_tab_counts,
            },
            "filteredKeyboard": {
                "startDocumentId": filtered_start,
                "afterArrowDownDocumentId": filtered_down,
                "afterArrowUpDocumentId": filtered_up,
                "passed": (filtered_start, filtered_down, filtered_up) == ("doc-9", "doc-2", "doc-9"),
            },
            "emptyState": empty_state,
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
