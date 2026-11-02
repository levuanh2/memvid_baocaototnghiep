// Round 8.2 audit probe (Claude). Library Action Matrix OFF vs ON against the
// REAL Flask + disposable Postgres stack (BE/scripts/run_e2e_server.py on :8080).
// OFF = build of c02e2b9 with the flag unset (served on :4173, same as prod).
// ON  = same tree built with VITE_LIBRARY_ACTION_MATRIX=true (served on :4174).
// Run from FE/ so @playwright/test resolves:
//   npx playwright test --config <this dir>/library-flag.config.mjs
import { test, expect } from "@playwright/test";
import { registerAndEnterApp, uploadSampleDocument } from "../e2e/fixtures.js";

const OFF = "http://127.0.0.1:4173";
const ON = "http://127.0.0.1:4174";
const API = "http://127.0.0.1:8080";
const MATRIX = '[aria-label="Ma trận hành động học tập"]';

async function token(page) {
  return page.evaluate(() => localStorage.getItem("memvid-token"));
}

async function myDocs(request, tok) {
  const res = await request.get(`${API}/api/documents`, { headers: { Authorization: `Bearer ${tok}` } });
  return { status: res.status(), body: res.ok() ? await res.json() : null };
}

test.describe("flag OFF", () => {
test.use({ baseURL: OFF });
test("OFF build renders the legacy Library, not the matrix", async ({ page }) => {
  await registerAndEnterApp(page);
  await uploadSampleDocument(page);
  await page.goto("/app/study");
  await expect(page.getByRole("heading", { name: "Thư viện học tập" })).toBeVisible();
  await expect(page.locator('[aria-label="Danh sách tài liệu"][aria-multiselectable="true"]')).toBeVisible();
  await expect(page.locator(MATRIX)).toHaveCount(0);
});
});

test.describe("flag ON", () => {
test.use({ baseURL: ON });

test("ON build renders the matrix; state is per-account and survives Back", async ({ page, request }) => {
  await registerAndEnterApp(page);
  await uploadSampleDocument(page);
  await page.goto("/app/study");
  const matrix = page.locator(MATRIX);
  await expect(matrix).toBeVisible();
  await expect(matrix.getByText(/^1 tài liệu phù hợp$/)).toBeVisible();

  // Library state: a query that hides the row, then an in-app navigation and Back.
  const search = page.getByLabel("Tìm trong thư viện");
  await search.fill("khong-co-tai-lieu-nay");
  await expect(matrix.getByText(/^0 tài liệu phù hợp$/)).toBeVisible();
  await page.getByRole("link", { name: "Phòng đọc" }).click();
  await expect(page).not.toHaveURL(/\/app\/study$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/study$/);
  await expect(page.getByLabel("Tìm trong thư viện")).toHaveValue("khong-co-tai-lieu-nay");
  await expect(page.locator(MATRIX).getByText(/^0 tài liệu phù hợp$/)).toBeVisible();

  const keysA = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("memvidx.library.actionMatrix.v1:")));
  expect(keysA, "matrix state is stored under an account-scoped key").toHaveLength(1);
  const tokA = await token(page);
  const docsA = await myDocs(request, tokA);
  const docIdA = (docsA.body?.documents || [])[0]?.document_id;
  expect(docIdA, "account A owns one document").toBeTruthy();

  // Same tab, second account: A's sessionStorage state is still present.
  await page.evaluate(() => localStorage.removeItem("memvid-token"));
  await registerAndEnterApp(page);
  await page.goto("/app/study");
  await expect(page.locator(MATRIX).or(page.getByText(/Chưa có tài liệu|Thư viện trống|Tải tài liệu/).first())).toBeVisible();
  await expect(page.getByLabel("Tìm trong thư viện")).toHaveValue("");
  await expect(page.getByText("khong-co-tai-lieu-nay")).toHaveCount(0);

  // Server-side isolation: B cannot list or read A's document.
  const tokB = await token(page);
  expect(tokB).not.toBe(tokA);
  const docsB = await myDocs(request, tokB);
  expect(docsB.status).toBe(200);
  const listB = docsB.body?.documents || [];
  expect(listB.map((d) => d.document_id)).not.toContain(docIdA);
  const cross = await request.get(`${API}/api/documents/${docIdA}`, { headers: { Authorization: `Bearer ${tokB}` } });
  expect([403, 404], `GET A's document as B -> ${cross.status()}`).toContain(cross.status());
  test.info().annotations.push({ type: "cross-account", description: `GET /api/documents/<A> as B -> ${cross.status()}` });
});
});
