// Shared helpers for the Playwright critical-flow suite. No production
// credentials anywhere here — every user is registered fresh, per test run,
// against the ephemeral E2E backend (BE/scripts/run_e2e_server.py) and its
// throwaway Postgres database.
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A short, run-unique email so re-running the suite locally never collides
 * with a previous run's leftover row (the ephemeral DB is usually wiped
 * between CI runs, but isn't guaranteed to be for a local `npx playwright
 * test` against an already-running dev stack). */
export function freshTestUser() {
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    email: `e2e-${id}@example.test`,
    password: "E2E-test-password-1",
    displayName: "E2E Test User",
  };
}

/** Register a fresh deterministic CI-safe user via the REAL /register page
 * (not an API shortcut) and wait for the app shell to mount. This is the
 * "deterministic authenticated test fixture" required by B3 — no production
 * credentials, no shared/reused account. */
export async function registerAndEnterApp(page, user = freshTestUser()) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(user.password);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
  return user;
}

export const SAMPLE_DOC_PATH = path.join(__dirname, "fixtures", "sample-doc.txt");

/** Upload the fixture document via DocumentList's file input and wait for
 * the fake-ingest path (BE/scripts/run_e2e_server.py's `_fast_ingest`) to
 * mark it ready — deterministic, no OCR/embeddings involved. */
export async function uploadSampleDocument(page) {
  await page.goto("/app/study");
  const uploadResponse = page.waitForResponse(
    (res) => res.url().includes("/api/documents/upload") && res.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_DOC_PATH);
  await uploadResponse;
  // The upload response confirms the server accepted the file and
  // (via run_e2e_server.py's fast-ingest patch) marked it index_ready
  // synchronously — give the DOM one settle tick before callers navigate
  // away and rely on ANOTHER component's (SidebarLeft's) own fetch seeing it.
  await page.waitForTimeout(250);
}

/** Select every ready source in the left sidebar (needed before Guided
 * Mind Map's "create" is enabled — GuidedMindmapDialog disables submit when
 * `sourceIds` is empty). SidebarLeft fetches its own source list independently
 * of DocumentList's upload flow, so this waits for the uploaded document's
 * OWN row to actually render (not just a generic checkbox, which can exist
 * in a stale/empty-list DOM state before that fetch resolves) before touching
 * the "select all" control — reloading once if the first fetch races the
 * navigation. */
export async function selectAllSources(page) {
  await page.goto("/app");
  const sourceRow = page.getByText(/sample-doc/i).first();
  try {
    await sourceRow.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    await page.reload();
    await sourceRow.waitFor({ state: "visible", timeout: 15_000 });
  }
  const selectAll = page.locator('input[type="checkbox"]').first();
  await selectAll.waitFor({ state: "visible", timeout: 5_000 });
  if (!(await selectAll.isChecked())) await selectAll.check();
}

/** Open the Mind Map header entry point (mode tab -> library menu -> create)
 * — the exact path the "invisible modal" P1 regression protects. Returns the
 * dialog locator so callers can assert visibility explicitly and decide how
 * hard to fail if a concurrent fix for that regression hasn't landed yet. */
export async function openGuidedDialogFromHeader(page) {
  await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
  const hasMaps = await page.getByRole("button", { name: "Mở thư viện sơ đồ" })
    .waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
  if (hasMaps) {
    const listbox = await openMapLibrary(page);
    await listbox.getByRole("button", { name: "Tạo sơ đồ mới" }).click();
  } else {
    // No map yet: the workspace empty-state CTA routes through openArtifact,
    // which opens the same Guided dialog (SidebarRight: mindmap request +
    // selected sources, no maps).
    await page.getByRole("button", { name: "Tạo sơ đồ tư duy" }).click();
  }
  return page.getByRole("dialog", { name: "Tạo sơ đồ tư duy" });
}

// The map library lives only in the contextual Mind Map toolbar now: the
// global "Sơ đồ tư duy" tab switches mode, and "Mở thư viện sơ đồ" opens the
// listbox "Chọn sơ đồ" (its "Tạo sơ đồ mới" sits in the same popover).
export async function openMapLibrary(page) {
  await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
  const trigger = page.getByRole("button", { name: "Mở thư viện sơ đồ" });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  return page.getByRole("listbox", { name: "Chọn sơ đồ" });
}
