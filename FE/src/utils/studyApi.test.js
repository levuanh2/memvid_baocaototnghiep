import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchJobStatus,
  formatDuration,
  formatScore,
  generateQuiz,
  getResult,
  listDocuments,
  masteryPercent,
  optionLabel,
  saveAnswers,
  uploadDocument,
} from "./studyApi";

const realFetch = globalThis.fetch;
const realLS = globalThis.localStorage;

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

beforeEach(() => {
  globalThis.localStorage = memLocalStorage();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.localStorage = realLS;
  vi.restoreAllMocks();
});

describe("studyApi requests", () => {
  it("unwraps list payloads to plain arrays", async () => {
    globalThis.fetch = vi.fn(async () => ok({ documents: [{ document_id: "d1" }] }));
    await expect(listDocuments()).resolves.toEqual([{ document_id: "d1" }]);
  });

  it("returns [] when the server sends no list", async () => {
    globalThis.fetch = vi.fn(async () => ok({}));
    await expect(listDocuments()).resolves.toEqual([]);
  });

  it("sends JSON bodies with the right method", async () => {
    globalThis.fetch = vi.fn(async () => ok({ job_id: "j1" }));
    await generateQuiz({ document_id: "d1", question_count: 5 });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ document_id: "d1", question_count: 5 });
  });

  it("saves draft answers with PATCH", async () => {
    globalThis.fetch = vi.fn(async () => ok({ answers: [] }));
    await saveAnswers("a1", { q1: "x" });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toContain("/api/attempts/a1/answers");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ answers: { q1: "x" } });
  });

  it("lets the browser set the multipart boundary on upload", async () => {
    globalThis.fetch = vi.fn(async () => ok({ document_id: "d1" }));
    await uploadDocument(new Blob(["x"]));
    const [, init] = globalThis.fetch.mock.calls[0];
    // Đặt Content-Type tay là mất boundary → server không parse được form.
    expect(init.headers?.["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws an error carrying the HTTP status so pages can branch on 404", async () => {
    globalThis.fetch = vi.fn(async () => fail(404, "Attempt not found"));
    await expect(getResult("a1")).rejects.toMatchObject({ status: 404 });
  });

  it("keeps 409 distinguishable from a real failure", async () => {
    globalThis.fetch = vi.fn(async () => fail(409, "Attempt chưa nộp"));
    await expect(getResult("a1")).rejects.toMatchObject({ status: 409 });
  });

  it("maps current_step to current_node so jobPoller can be reused as-is", async () => {
    globalThis.fetch = vi.fn(async () => ok({ status: "running", current_step: "Validate" }));
    await expect(fetchJobStatus("j1")).resolves.toMatchObject({
      status: "running",
      current_node: "Validate",
    });
  });

  it("never leaves current_node undefined for the poller fingerprint", async () => {
    globalThis.fetch = vi.fn(async () => ok({ status: "running" }));
    const s = await fetchJobStatus("j1");
    expect(s.current_node).toBe("");
  });
});

describe("studyApi formatting", () => {
  it("clamps mastery into 0..100 instead of drawing past the seal", () => {
    expect(masteryPercent(0.75)).toBe(75);
    expect(masteryPercent(0)).toBe(0);
    expect(masteryPercent(1)).toBe(100);
    expect(masteryPercent(1.4)).toBe(100);
    expect(masteryPercent(-0.2)).toBe(0);
    expect(masteryPercent(null)).toBe(0);
    expect(masteryPercent("abc")).toBe(0);
  });

  it("shows true/false answers as words a learner reads", () => {
    expect(optionLabel("true")).toBe("Đúng");
    expect(optionLabel("false")).toBe("Sai");
    expect(optionLabel("2x")).toBe("2x");
  });

  it("keeps the raw score, never a 10-point conversion", () => {
    expect(formatScore(1.5, 4)).toBe("1.5 / 4");
    expect(formatScore(3, 3)).toBe("3 / 3");
    expect(formatScore(null, 4)).toBe("—");
  });

  it("formats duration for humans and refuses nonsense", () => {
    expect(formatDuration(45)).toBe("45 giây");
    expect(formatDuration(125)).toBe("2 phút 5 giây");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(null)).toBe("—");
  });
});
