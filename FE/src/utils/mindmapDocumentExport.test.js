// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createMindmapExport, getMindmapExportStatus, cancelMindmapExport,
  pollMindmapExportUntilDone, triggerMindmapExportDownload,
} from "./mindmapDocumentExport";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fakeFetch(status, body) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

describe("createMindmapExport", () => {
  it("POSTs the format/scope/options and returns the job", async () => {
    global.fetch = fakeFetch(202, { job_id: "j1", status: "queued", status_url: "/mindmaps/exports/j1" });
    const result = await createMindmapExport("m1", { format: "pdf", scope: { scope_type: "full" }, options: { pageSize: "A4" } });
    expect(result.job_id).toBe("j1");
    const [, init] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({ format: "pdf", scope: { scope_type: "full" }, options: { pageSize: "A4" } });
  });

  it("includes map_image_base64 and idempotency_key only when provided", async () => {
    global.fetch = fakeFetch(202, { job_id: "j1", status: "queued" });
    await createMindmapExport("m1", { format: "pdf", scope: {}, options: {}, mapImageBase64: "abc", idempotencyKey: "k1" });
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.map_image_base64).toBe("abc");
    expect(sentBody.idempotency_key).toBe("k1");
  });

  it("throws with .status on a non-ok response", async () => {
    global.fetch = fakeFetch(400, { error: "bad format", error_code: "invalid_format" });
    await expect(createMindmapExport("m1", { format: "csv", scope: {}, options: {} })).rejects.toMatchObject({ status: 400 });
  });
});

describe("getMindmapExportStatus / cancelMindmapExport", () => {
  it("fetches status", async () => {
    global.fetch = fakeFetch(200, { job_id: "j1", status: "running", progress: 50 });
    const s = await getMindmapExportStatus("j1");
    expect(s.status).toBe("running");
  });

  it("posts cancel", async () => {
    global.fetch = fakeFetch(200, { job_id: "j1", status: "cancel_requested" });
    const s = await cancelMindmapExport("j1");
    expect(s.status).toBe("cancel_requested");
    expect(global.fetch.mock.calls[0][1].method).toBe("POST");
  });
});

describe("pollMindmapExportUntilDone", () => {
  it("polls until a terminal status, calling onUpdate each time", async () => {
    const statuses = [
      { status: "queued", progress: 0 },
      { status: "running", progress: 50 },
      { status: "done", progress: 100, result: { format: "pdf" } },
    ];
    let call = 0;
    global.fetch = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => statuses[call++] }));
    const updates = [];
    const final = await pollMindmapExportUntilDone("j1", { intervalMs: 0, onUpdate: (s) => updates.push(s.status) });
    expect(final.status).toBe("done");
    expect(updates).toEqual(["queued", "running", "done"]);
  });

  it("stops immediately when the signal is already aborted", async () => {
    global.fetch = fakeFetch(200, { status: "running" });
    const controller = new AbortController();
    controller.abort();
    await expect(pollMindmapExportUntilDone("j1", { signal: controller.signal })).rejects.toThrow();
  });

  it("aborts mid-wait when the signal fires between polls", async () => {
    global.fetch = fakeFetch(200, { status: "running" });
    const controller = new AbortController();
    const promise = pollMindmapExportUntilDone("j1", { intervalMs: 5000, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10)); // let the first poll's fetch resolve and the setTimeout wait begin
    controller.abort();
    await expect(promise).rejects.toThrow();
  });
});

describe("triggerMindmapExportDownload", () => {
  it("clicks a real <a> pointed at the resolved download URL", () => {
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreateElement(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });
    triggerMindmapExportDownload("/mindmaps/exports/j1/download?token=abc");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
