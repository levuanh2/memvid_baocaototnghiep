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
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_DOC_PATH);
  // AiInsightCard renders while `uploading` is true and doesn't require
  // network idle; the upload+list-refresh round trip is the real "done" signal.
  await page.getByRole("button", { name: "Tải tài liệu" }).waitFor({ state: "visible" });
  await page.getByText("Đang tải lên…").waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
}

/** Select every ready source in the left sidebar (needed before Guided
 * Mind Map's "create" is enabled — GuidedMindmapDialog disables submit when
 * `sourceIds` is empty). */
export async function selectAllSources(page) {
  await page.goto("/app");
  const selectAll = page.locator('input[type="checkbox"]').first();
  await selectAll.waitFor({ state: "visible", timeout: 15_000 });
  if (!(await selectAll.isChecked())) await selectAll.check();
}

/** Open the Mind Map header entry point (mode tab -> library menu -> create)
 * — the exact path the "invisible modal" P1 regression protects. Returns the
 * dialog locator so callers can assert visibility explicitly and decide how
 * hard to fail if a concurrent fix for that regression hasn't landed yet. */
export async function openGuidedDialogFromHeader(page) {
  await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
  await page.getByRole("button", { name: "Tạo sơ đồ mới" }).click();
  return page.getByRole("dialog", { name: "Tạo sơ đồ tư duy" });
}
