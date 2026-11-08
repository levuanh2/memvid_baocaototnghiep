// V4.1 UX audit capture. Runs the REAL app on the Vite dev server with the API
// mocked at the network layer (same pattern as FE/e2e-fixture/mobile-header.spec.js):
// no backend, no production data, no production login.
// Run (from FE/, after copying this file to FE/e2e-audit-tmp/):
//   npx playwright test -c playwright.audit-tmp.config.js
// with playwright.audit-tmp.config.js = playwright.fixture.config.js + testDir "./e2e-audit-tmp".
// AUDIT_FLAG=on: the dev server is started with VITE_LIBRARY_ACTION_MATRIX=true (local test build only).
import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../docs/ui-ux-v4-1/evidence");
const FLAG = process.env.AUDIT_FLAG === "on" ? "flagon" : "flagoff";
const SPACING_ONLY = process.env.AUDIT_SPACING === "1";
const API = /localhost:8080\//;
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const TITLES = ["Hệ điều hành.pdf", "Mạng máy tính.pdf", "Cấu trúc dữ liệu.docx", "Giải tích 1.pdf", "Lịch sử Đảng.pdf", "Kinh tế vi mô.pptx"];
const DOCS = TITLES.map((title, i) => ({
  document_id: `d${i + 1}`, source_stem: `tai-lieu-${i + 1}`, title,
  file_type: "pdf", status: "completed", ingest_status: "index_ready", progress: 1, reading_minutes: 12 + i,
  created_at: `2026-10-0${i + 1}T08:00:00Z`, last_opened_at: i === 0 ? "2026-11-02T08:00:00Z" : null, last_workspace: i === 0 ? "chat" : null,
  collection_id: i < 3 ? "c1" : null,
  ai: {
    index: "ready", summary: { state: i % 2 ? "ready" : "not_generated" },
    quiz: { ready: i < 2, latest_quiz_id: i < 2 ? `quiz-${i + 1}` : null },
    review: { latest_attempt_id: i === 0 ? "attempt-1" : null },
  },
}));
const COLLECTIONS = [{ collection_id: "c1", name: "Học kỳ 1", color: "blue", document_count: 3 }];
const MAP = {
  id: "map-a", title: "Hệ điều hành", schema_version: 2, sources: ["tai-lieu-1"], relations: [], content_hash: "h1",
  nodes: [
    { id: "r", kind: "root", title: "Hệ điều hành", parent: null, order: 0 },
    ...["Tiến trình", "Bộ nhớ", "Hệ thống tệp", "Đồng bộ hoá"].flatMap((t, i) => [
      { id: `m${i}`, kind: "section", title: t, parent: "r", order: i },
      { id: `m${i}a`, kind: "concept", title: `${t}: khái niệm`, parent: `m${i}`, order: 0 },
      { id: `m${i}b`, kind: "concept", title: `${t}: ví dụ`, parent: `m${i}`, order: 1 },
    ]),
  ],
  generator: { pipeline: "fixture", model: "fixture", elapsed_sec: 0, degraded: false, missing: [] },
};
const QUESTIONS = Array.from({ length: 6 }, (_, i) => ({
  question_id: `q${i + 1}`, question_type: i === 5 ? "short_answer" : i === 4 ? "true_false" : "multiple_choice",
  question_text: `Câu hỏi ${i + 1}: tiến trình và luồng khác nhau thế nào?`,
  options: i === 5 ? [] : i === 4 ? ["true", "false"] : ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
  concept_tags: [i < 3 ? "Tiến trình" : "Bộ nhớ"], user_answer: i < 2 ? "Phương án A" : "Phương án B", correct_answer: "Phương án B",
  verdict: i < 2 ? "incorrect" : "correct", explanation: `Giải thích ${i + 1}`, chunk_ids: [`c${i}`],
}));
const RESULT = {
  status: "graded", grading_complete: true, quiz_id: "quiz-1", document_id: "d1", quiz_title: "Hệ điều hành", score: 4, max_score: 6, percentage: 67,
  correct_count: 4, incorrect_count: 2, total_questions: 6, duration_seconds: 420, questions: QUESTIONS,
};
const PLAN = {
  attempt_id: "attempt-1", document_id: "d1", summary: "2 chủ đề cần ôn", items: [
    { review_item_id: "ri-1", topic: "Tiến trình", priority: 1, status: "review_needed", mastery_score: 0.4, reason: "Sai 2/3 câu", review_tasks: ["Đọc lại mục 2.1"], chunk_ids: ["c1"] },
    { review_item_id: "ri-2", topic: "Bộ nhớ", priority: 2, status: "light_review", mastery_score: 0.67, reason: "Sai 1/3 câu", review_tasks: [], chunk_ids: ["c2"] },
  ],
};
const STUDY_MAP = {
  map_id: "sm1", document_id: "d1", title: "Hệ điều hành", edges: [], nodes: [
    { node_id: "n0", title: "Hệ điều hành", parent_node_id: null, node_type: "root" },
    ...["Tiến trình", "Bộ nhớ", "Hệ thống tệp"].flatMap((t, i) => [
      { node_id: `n${i + 1}`, title: t, parent_node_id: "n0", node_type: "topic", summary: `Tóm tắt ${t}` },
      { node_id: `n${i + 1}a`, title: `${t} cơ bản`, parent_node_id: `n${i + 1}`, node_type: "concept" },
    ]),
  ],
};
const SUMMARY = {
  id: "s1", title: "Tóm tắt: Hệ điều hành", sources: ["tai-lieu-1"], created_at: "2026-11-01T00:00:00Z",
  content: "## Tổng quan\nHệ điều hành quản lý tiến trình, bộ nhớ và tệp.\n\n## Ý chính\n- Tiến trình là chương trình đang chạy.\n- Bộ nhớ ảo tách không gian địa chỉ.",
  summary: "Hệ điều hành quản lý tiến trình, bộ nhớ và tệp.",
};

function handler({ empty }) {
  return async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const m = route.request().method();
    const docs = empty ? [] : DOCS;
    const ok = (b) => route.fulfill(json(b));
    if (p === "/auth/me") return ok({ user: { id: "u1", email: "qa@example.test", display_name: "QA Tester", provider: "local" } });
    if (p === "/usage/me") return ok({ plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-12-01T00:00:00Z", breakdown: { chat: 120 } });
    if (p === "/mindmaps") return ok({ mindmaps: empty ? [] : [MAP] });
    if (p === "/mindmaps/map-a") return ok(MAP);
    if (p === "/mindmaps/capability") return ok({ guided: true });
    if (p === "/summaries") return ok({ summaries: empty ? [] : [SUMMARY] });
    if (p === "/summaries/s1") return ok(SUMMARY);
    if (p === "/list-indexed") return ok({ sources: docs.map((d) => ({ video: d.source_stem, video_stem: d.source_stem, filename: d.title, status: "index_ready", source_id: d.document_id })) });
    if (p === "/api/documents") return ok({ documents: docs });
    if (p === "/api/library") return ok({ documents: docs, collections: empty ? [] : COLLECTIONS });
    if (p === "/api/collections") return ok({ collections: empty ? [] : COLLECTIONS });
    if (p === "/api/progress/overview") return ok(empty ? { document_count: 0, quiz_count: 0, attempt_count: 0, average_percentage: null } : { document_count: 6, quiz_count: 2, attempt_count: 3, average_percentage: 67 });
    if (p === "/api/progress/concepts") return ok({ concepts: empty ? [] : [{ concept: "Tiến trình", mastery_score: 0.4, status: "review_needed", document_id: "d1" }, { concept: "Bộ nhớ", mastery_score: 0.67, status: "light_review", document_id: "d1" }] });
    if (p === "/api/progress/attempts") return ok({ attempts: empty ? [] : [{ attempt_id: "attempt-1", quiz_id: "quiz-1", quiz_title: "Hệ điều hành", document_id: "d1", percentage: 67, status: "graded", submitted_at: "2026-11-02T09:00:00Z" }] });
    let mm;
    if ((mm = p.match(/^\/api\/documents\/(d\d)$/))) return ok(DOCS.find((d) => d.document_id === mm[1]) || DOCS[0]);
    if (/^\/api\/documents\/d\d\/sections$/.test(p)) return ok({ sections: [{ section_id: "s1", title: "1. Tiến trình", level: 1 }, { section_id: "s2", title: "2. Bộ nhớ", level: 1 }] });
    if (/^\/api\/documents\/d\d\/quizzes$/.test(p)) return ok({ quizzes: [{ quiz_id: "quiz-1", title: "Hệ điều hành", question_count: 6, created_at: "2026-11-02T08:00:00Z" }] });
    if (/^\/api\/documents\/d\d\/study-maps$/.test(p)) return ok({ study_maps: [{ map_id: "sm1", status: "completed", title: "Hệ điều hành", created_at: "2026-11-02T08:00:00Z" }] });
    if (/^\/api\/documents\/d\d\/chunks/.test(p)) return ok({ chunks: [{ chunk_id: "c1", text: "Tiến trình là chương trình đang thực thi." }] });
    if (p === "/api/study-maps/sm1") return ok(STUDY_MAP);
    if (p === "/api/quizzes/quiz-1") return ok({ quiz_id: "quiz-1", title: "Hệ điều hành", document_id: "d1", questions: QUESTIONS });
    if (p === "/api/quizzes/quiz-1/attempts" && m === "POST") return ok({ attempt_id: "attempt-9", status: "in_progress", answers: [], quiz: { title: "Hệ điều hành", questions: QUESTIONS } });
    if (p === "/api/quizzes/quiz-1/attempts") return ok({ attempts: [{ attempt_id: "attempt-1", percentage: 67, status: "graded" }] });
    if (p === "/api/quizzes/results/attempt-1") return ok(RESULT);
    if (p === "/api/attempts/attempt-1/concept-masteries") return ok({ concepts: [{ concept: "Tiến trình", mastery_score: 0.4, status: "review_needed" }, { concept: "Bộ nhớ", mastery_score: 0.67, status: "light_review" }] });
    if (p === "/api/review-plans/attempt-1") return ok(PLAN);
    if (p === "/api/practice/pq-1") return ok({ practice_quiz_id: "pq-1", title: "Luyện tập: Tiến trình", status: "ready", questions: QUESTIONS.slice(0, 3) });
    return ok({});
  };
}

const VIEWPORTS = SPACING_ONLY
  ? [[390, 844], [1440, 900]]
  : [[320, 720], [390, 844], [768, 1024], [1024, 768], [1440, 900]];
const SCREENS = [
  { id: "landing", path: "/", auth: false },
  { id: "login", path: "/login", auth: false },
  { id: "workspace-chat-empty", path: "/app", empty: true },
  { id: "workspace-chat", path: "/app" },
  { id: "workspace-map", path: "/app", mode: "Sơ đồ tư duy", expect: '[role="tab"][title="Sơ đồ tư duy"][aria-selected="true"]' },
  { id: "workspace-summary", path: "/app", mode: "Tóm tắt", expect: '[role="tab"][title="Tóm tắt"][aria-selected="true"]' },
  { id: "library", path: "/app/study" },
  { id: "library-empty", path: "/app/study", empty: true },
  { id: "studymap", path: "/app/study/map/d1" },
  { id: "quiz-setup", path: "/app/study/quiz/new?document=d1" },
  { id: "quiz-taking", path: "/app/study/quiz/quiz-1" },
  { id: "quiz-result", path: "/app/study/result/attempt-1" },
  { id: "review-guide", path: "/app/study/review/attempt-1" },
  { id: "practice", path: "/app/study/practice/pq-1" },
  { id: "profile", path: "/app/profile" },
  // Interaction states (open menus / panels), captured at every viewport too.
  { id: "workspace-tools-menu", path: "/app", act: [["css", 'header button[aria-label="Mở công cụ StudyMap"]']], expect: '[role="menu"][aria-label="Công cụ học"]' },
  { id: "workspace-account-menu", path: "/app", act: [["css", 'header button[aria-haspopup="menu"][aria-label^="Tài khoản"]']], expect: '[role="menu"]:has-text("Đăng xuất")' },
  { id: "workspace-map-export", path: "/app", mode: "Sơ đồ tư duy", act: [["text", "Xuất sơ đồ"]], expect: '[role="dialog"]:has-text("Phạm vi xuất")' },
  { id: "library-doc-menu", path: "/app/study", act: [["css", 'button[aria-label="Tuỳ chọn tài liệu"]']], expect: 'main button:has-text("Đổi tên")' },
];
const ONLY = process.env.AUDIT_ONLY ? process.env.AUDIT_ONLY.split(",") : null;

async function inventory(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const region = (el) => (el.closest('[role="dialog"]') ? "dialog" : el.closest("header") ? "header" : el.closest("nav") ? "nav" : el.closest("aside") ? "aside" : el.closest("main") ? "main" : "other");
    const els = [...document.querySelectorAll('button, a[href], [role="tab"], [role="menuitem"], input, select, textarea, [role="button"]')].filter(vis);
    return {
      url: location.pathname + location.search,
      controls: els.map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", name: name(el), region: region(el), unlabeled: !name(el), inViewport: el.getBoundingClientRect().top < innerHeight })),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headings: [...document.querySelectorAll("h1, h2")].map((h) => `${h.tagName}: ${h.innerText.trim().slice(0, 60)}`).slice(0, 12),
    };
  });
}

async function spacingInventory(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const px = (value) => Number.parseFloat(value) || 0;
    const label = (el) => {
      const heading = el.matches("h1,h2,h3") ? el : el.querySelector(":scope > h1, :scope > h2, :scope > h3");
      return String(el.getAttribute("aria-label") || heading?.textContent || el.textContent || el.className || el.tagName)
        .replace(/\s+/g, " ").trim().slice(0, 72);
    };
    const spacingProps = [
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "marginTop", "marginRight", "marginBottom", "marginLeft",
      "rowGap", "columnGap",
    ];
    const all = [...document.querySelectorAll("body *")].filter(visible);
    const counts = new Map();
    for (const el of all) {
      const style = getComputedStyle(el);
      for (const prop of spacingProps) {
        const value = px(style[prop]);
        if (value > 0 && value <= 96) counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    const candidates = [...document.querySelectorAll([
      "main section", "main article", "main [class*='card']", "main [class*='panel']",
      "main [class*='result']", "main [class*='review']", "main [class*='guide']",
      "[role='main'] section", "[role='main'] article",
    ].join(","))].filter(visible);
    const uniqueCandidates = [...new Set(candidates)].slice(0, 80);
    const boxes = uniqueCandidates.map((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        element: `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, ".").slice(0, 100)}`,
        label: label(el),
        x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
        gap: [style.rowGap, style.columnGap],
      };
    });
    const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).map((el) => {
      const style = getComputedStyle(el);
      return { level: el.tagName, label: label(el), fontSize: style.fontSize, lineHeight: style.lineHeight, margin: [style.marginTop, style.marginBottom] };
    });
    const verticalGaps = [];
    for (const parent of [...document.querySelectorAll("main, main > *, [role='main'], [role='main'] > *")].filter(visible)) {
      const children = [...parent.children].filter(visible).map((el) => ({ el, rect: el.getBoundingClientRect() })).sort((a, b) => a.rect.top - b.rect.top);
      for (let i = 1; i < children.length; i += 1) {
        const gap = Math.round((children[i].rect.top - children[i - 1].rect.bottom) * 10) / 10;
        if (gap > 0 && gap <= 96) verticalGaps.push({ parent: label(parent), from: label(children[i - 1].el), to: label(children[i].el), gap });
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      distinctSpacingValues: [...counts.keys()].sort((a, b) => a - b),
      spacingFrequency: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count })),
      headings,
      boxes,
      verticalGaps: verticalGaps.slice(0, 80),
    };
  });
}

async function tabOrder(page, n) {
  const out = [];
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press("Tab");
    out.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "(body)";
      const r = el.getBoundingClientRect();
      const nm = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} "${nm}"${r.width === 0 ? " (invisible)" : ""}`;
    }));
  }
  return out;
}

for (const s of SCREENS) {
  if (ONLY && !ONLY.includes(s.id)) continue;
  for (const [w, h] of VIEWPORTS) {
    for (const theme of SPACING_ONLY ? ["light"] : ["light", "dark"]) {
      test(`${FLAG} ${s.id} ${w} ${theme}`, async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: w, height: h });
        await page.addInitScript(([auth, th]) => {
          if (auth) localStorage.setItem("memvid-token", "fixture-token");
          localStorage.setItem("memvid-theme", th);
        }, [s.auth !== false, theme]);
        await page.route(API, handler({ empty: !!s.empty }));
        await page.goto(s.path);
        await page.waitForLoadState("networkidle").catch(() => {});
        if (s.mode) {
          await page.locator(`[role="tab"][title="${s.mode}"]`).first().click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(800);
        }
        for (const [kind, sel, val] of s.act || []) {
          const loc = kind === "text" ? page.getByRole("button", { name: sel }).first() : page.locator(sel).first();
          if (kind === "fill") await loc.fill(val, { timeout: 4000 }).catch(() => {});
          else await loc.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(600);
        }
        // Strict: a state that was not reached fails the test and writes no screenshot.
        if (s.expect) await page.locator(s.expect).first().waitFor({ state: "visible", timeout: 5000 });
        await page.waitForTimeout(700);
        const base = `${s.id}__${w}__${theme}${FLAG === "flagon" ? "__flagon" : ""}`;
        if (SPACING_ONLY) {
          const measured = await spacingInventory(page);
          mkdirSync(`${OUT}/spacing`, { recursive: true });
          writeFileSync(`${OUT}/spacing/${base}.json`, JSON.stringify(measured, null, 1));
          return;
        }
        mkdirSync(`${OUT}/screens`, { recursive: true });
        await page.screenshot({ path: `${OUT}/screens/${base}.jpg`, type: "jpeg", quality: 55 });
        if (theme === "light" && (w === 390 || w === 1440)) {
          const inv = await inventory(page);
          inv.tab = await tabOrder(page, w === 1440 ? 25 : 15);
          mkdirSync(`${OUT}/inventory`, { recursive: true });
          writeFileSync(`${OUT}/inventory/${base}.json`, JSON.stringify(inv, null, 1));
        }
      });
    }
  }
}
