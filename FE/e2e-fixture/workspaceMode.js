// V9.3 P4b: at <=700px the workspace mode switch is the labelled "Chế độ học" select; wider
// screens keep the tab row. Both drive one state and the tabs stay in the DOM (hidden on
// narrow screens), so aria-selected on a tab is the source of truth at every width.
import { expect } from "@playwright/test";

export const MODE_SELECT = "#workspace-mode-select";

export async function waitForModeControl(page, timeout = 30000) {
  await page.locator(`nav[role="tablist"]:visible, ${MODE_SELECT}:visible`).first().waitFor({ state: "visible", timeout });
}

export async function chooseMode(page, label) {
  // Wait for whichever control this width shows: right after a load or reload neither may be
  // rendered yet, and isVisible() does not wait (it then clicked a hidden tab at <=700px).
  await waitForModeControl(page);
  const select = page.locator(MODE_SELECT);
  if (await select.isVisible()) await select.selectOption({ label });
  else await page.getByRole("tab", { name: label }).click();
  await expect(page.locator(`nav[role="tablist"] [role="tab"][title="${label}"]`)).toHaveAttribute("aria-selected", "true");
}
