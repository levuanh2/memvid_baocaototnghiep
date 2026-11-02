import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { registerAndEnterApp, uploadSampleDocument } from "../e2e/fixtures.js";

const API = "http://127.0.0.1:8180";
const OUT = "E:/memvid_NCKH/r84-codex1-dialogs/reachability.json";
const SUMMARY_DB = "E:/memvid_NCKH/r84-codex1-dialogs/data/memory/summaries.sqlite";

async function sourceStem(request, headers) {
  let stem = null;
  await expect.poll(async () => {
    const body = await (await request.get(`${API}/list-indexed`, { headers })).json();
    stem = body.sources.find((s) => String(s.filename || "").includes("sample-doc"))?.video_stem || null;
    return stem;
  }, { timeout: 20_000 }).not.toBeNull();
  return stem;
}

async function seedMap(request, headers, stem) {
  const res = await request.post(`${API}/generate-mindmap`, {
    headers,
    data: { sources: [stem], source_ids: [stem], q: "tóm tắt tài liệu", force: false },
  });
  expect(res.ok(), `POST /generate-mindmap -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  if (body.status === "done") return body.result.id;
  let payload;
  await expect.poll(async () => {
    payload = await (await request.get(`${API}/mindmap-status/${body.job_id}`, { headers })).json();
    return payload.status;
  }, { timeout: 60_000 }).toBe("done");
  return payload.result.id;
}

function seedSummary(userId, id, title) {
  const sql = `
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY, content_hash TEXT, sources_json TEXT,
  created_at TEXT, record_json TEXT, user_id TEXT
);
INSERT OR REPLACE INTO summaries
  (id, content_hash, sources_json, created_at, record_json, user_id)
VALUES (?, ?, ?, ?, ?, ?);
`;
  const code = `import sqlite3,sys
db,user,sid,title=sys.argv[1:]
record='{"id":"%s","title":"%s","content_hash":"r84-codex1","sources":[],"created_at":"2026-11-02T00:00:00Z","overview":"QA summary","sections":[]}'%(sid,title)
c=sqlite3.connect(db)
c.execute("CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, content_hash TEXT, sources_json TEXT, created_at TEXT, record_json TEXT, user_id TEXT)")
c.execute("INSERT OR REPLACE INTO summaries (id,content_hash,sources_json,created_at,record_json,user_id) VALUES (?,?,?,?,?,?)",(sid,"r84-codex1","[]","2026-11-02T00:00:00Z",record,user))
c.commit()
`;
  execFileSync("python", ["-c", code, SUMMARY_DB, userId, id, title]);
  return sql.trim();
}

test("real seeded app exposes map and summary destructive dialog triggers", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-theme", "dark"));
  const network = [];
  page.on("request", (req) => {
    if (req.url().startsWith(API) && !["GET", "OPTIONS"].includes(req.method())) {
      network.push(`${req.method()} ${new URL(req.url()).pathname}`);
    }
  });
  await registerAndEnterApp(page);
  await uploadSampleDocument(page);
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  const headers = { Authorization: `Bearer ${token}` };
  const me = await (await request.get(`${API}/auth/me`, { headers })).json();
  const userId = me?.user?.id || me?.user?.user_id || me?.id || me?.user_id;
  expect(userId, `auth/me payload: ${JSON.stringify(me)}`).toBeTruthy();

  const stem = await sourceStem(request, headers);
  const mapId = await seedMap(request, headers, stem);
  await request.get(`${API}/summaries`, { headers });
  const summaryId = `r84-summary-${Date.now()}`;
  const summaryTitle = "R84 real summary";
  const seedSql = seedSummary(userId, summaryId, summaryTitle);

  await page.goto("/app");
  await expect(page.getByRole("tablist", { name: "Chế độ Workspace" })).toBeVisible();
  const spine = page.getByRole("button", { name: "Mở Lề bằng chứng" });
  if (await spine.isVisible().catch(() => false)) await spine.click();
  await expect(page.locator("#context-inspector")).toBeVisible();
  await page.waitForTimeout(1_000);

  const serverMaps = await (await request.get(`${API}/mindmaps`, { headers })).json();
  const serverSummaries = await (await request.get(`${API}/summaries`, { headers })).json();
  const result = {
    realStack: "Flask + disposable Postgres; artifact stores are disposable SQLite under DATA_DIR",
    userId,
    seeded: {
      mapId,
      mapPresentOnServer: JSON.stringify(serverMaps).includes(mapId),
      summaryId,
      summaryPresentOnServer: JSON.stringify(serverSummaries).includes(summaryId),
    },
    dom: {
      contextInspectorVisible: await page.locator("#context-inspector").isVisible(),
      deleteMapButtons: await page.getByRole("button", { name: "Xóa sơ đồ" }).count(),
      deleteSummaryButtons: await page.getByRole("button", { name: "Xóa tóm tắt" }).count(),
      dialogs: await page.getByRole("dialog").count(),
    },
    sourceGuard: {
      constant: "const legacyInspectorSurfacesEnabled = false",
      guardedBlock: "{legacyInspectorSurfacesEnabled && <div ...> ... saved map/summary ListCard delete buttons ... </div>}",
    },
    network,
    summarySeedSql: seedSql,
  };
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log("R84_CODEX1_REACHABILITY", JSON.stringify(result));
  expect(result.seeded.mapPresentOnServer).toBe(true);
  expect(result.seeded.summaryPresentOnServer).toBe(true);
  expect(result.dom.deleteMapButtons).toBe(0);
  expect(result.dom.deleteSummaryButtons).toBe(0);
});
