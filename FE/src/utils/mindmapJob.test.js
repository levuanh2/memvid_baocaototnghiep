import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollIntervalMs, stageLabel, createMindmapPoller, STALL_MS, MAX_CONSECUTIVE_FETCH_FAILURES } from "./mindmapJob";

describe("pollIntervalMs", () => {
  it("giãn 2s → 5s → 10s", () => {
    expect(pollIntervalMs(0)).toBe(2000);
    expect(pollIntervalMs(29_000)).toBe(2000);
    expect(pollIntervalMs(31_000)).toBe(5000);
    expect(pollIntervalMs(121_000)).toBe(10_000);
  });
});

describe("stageLabel", () => {
  it("map node pipeline sang label", () => {
    expect(stageLabel({ current_node: "Skeleton" })).toBe("Dựng khung xương…");
    expect(stageLabel({ current_node: "Enrich", message: "nhánh 2/5" })).toContain("nhánh 2/5");
    expect(stageLabel({ current_node: "Relations" })).toBe("Tìm quan hệ chéo…");
    expect(stageLabel({})).toBe("Đang tạo sơ đồ…");
  });

  it("labels the real Guided V3 lifecycle stages", () => {
    expect(stageLabel({ current_node: "retrieving" })).toContain("truy xuất");
    expect(stageLabel({ current_node: "planning" })).toContain("kế hoạch");
    expect(stageLabel({ current_node: "generating" })).toContain("sinh");
    expect(stageLabel({ current_node: "validating" })).toContain("kiểm tra");
    expect(stageLabel({ current_node: "saving" })).toContain("lưu");
  });
});

describe("createMindmapPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mk = (statuses, cbs = {}) => {
    let i = 0;
    const fetchStatus = vi.fn(async () => statuses[Math.min(i++, statuses.length - 1)]);
    const events = { ticks: [], done: [], errors: [], cancelled: 0 };
    const poller = createMindmapPoller({
      fetchStatus,
      onTick: (s, meta) => events.ticks.push([s, meta]),
      onDone: (r) => events.done.push(r),
      onError: (e) => events.errors.push(e),
      onCancelled: () => events.cancelled++,
      ...cbs,
    });
    return { poller, events, fetchStatus };
  };

  it("poll tới done, KHÔNG có hard timeout (chạy quá 190s vẫn sống)", async () => {
    const running = { status: "running", progress: 50, current_node: "Enrich" };
    const statuses = Array(60).fill(running).concat([{ status: "done", result: { id: "r1" } }]);
    const { poller, events } = mk(statuses);
    poller.start("j1");
    await vi.advanceTimersByTimeAsync(600_000); // 10 phút
    expect(events.done).toEqual([{ id: "r1" }]);
    expect(events.errors).toHaveLength(0);
  });

  it("stalled=true khi fingerprint đứng yên quá STALL_MS", async () => {
    const frozen = { status: "running", progress: 40, current_node: "Enrich" };
    const { poller, events } = mk(Array(200).fill(frozen));
    poller.start("j1");
    await vi.advanceTimersByTimeAsync(STALL_MS + 60_000);
    const lastMeta = events.ticks.at(-1)[1];
    expect(lastMeta.stalled).toBe(true);
    poller.stop();
  });

  it("fetch lỗi mạng không dừng poll", async () => {
    let calls = 0;
    const fetchStatus = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("mạng rớt");
      return { status: "done", result: { id: "ok" } };
    });
    const { poller, events } = mk([], { fetchStatus });
    poller.start("j1");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.done).toEqual([{ id: "ok" }]);
  });

  it("404 = terminal ngay (jobId cũ trong localStorage), không poll vô hạn", async () => {
    const fetchStatus = vi.fn(async () => {
      const e = new Error("HTTP 404");
      e.status = 404;
      throw e;
    });
    const { poller, events } = mk([], { fetchStatus });
    poller.start("j-stale");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.errors).toHaveLength(1);
    expect(fetchStatus).toHaveBeenCalledTimes(1); // không retry 404
  });

  it("lỗi mạng liên tiếp quá ngân sách → terminal, không kẹt 'đang tạo' mãi", async () => {
    const fetchStatus = vi.fn(async () => { throw new Error("mạng rớt"); });
    const { poller, events } = mk([], { fetchStatus });
    poller.start("j1");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(events.errors).toHaveLength(1);
    expect(fetchStatus).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FETCH_FAILURES);
  });

  it("cancelled → onCancelled; stop() chặn tick sau", async () => {
    const { poller, events } = mk([{ status: "cancelled" }]);
    poller.start("j1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.cancelled).toBe(1);
    poller.stop(); // idempotent, không ném
  });

  // Real production bug, traced to exact file:line before this fix:
  // guided_worker.py:67 and mindmap_generation.py:69 both set
  // `status="failed"` on the backend's own terminal-failure path (retry
  // exhaustion / unrecoverable generation exception) -- guided_store.py:193
  // treats "failed" as equivalent to "error" for completed_at bookkeeping,
  // so this is a deliberate, real backend terminal status, not an edge
  // case. The poller only recognized "error"/"timeout" as terminal
  // failures, so a real "failed" job polled forever: onTick kept firing
  // with the SAME unrecognized status.status every tick, stageLabel()
  // never matched it (falls through to the generic "Đang tạo sơ đồ…"),
  // and onError never fired -- exactly the reported "Generate -> dialog
  // closes -> ~5s -> nothing visible, no map, no error" symptom, with the
  // job already dead on the server the entire time.
  it("'failed' (backend's real terminal-failure status, distinct from 'error') stops the poll and calls onError -- does not poll forever", async () => {
    const { poller, events, fetchStatus } = mk([
      { status: "failed", error: "worker_retry_exhausted: LLM timeout" },
    ]);
    poller.start("j1");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.errors).toHaveLength(1);
    expect(events.errors[0].message).toContain("LLM timeout");
    expect(events.done).toHaveLength(0);
    // Terminal on the FIRST tick that reports "failed" -- must not keep
    // polling waiting for some later status that will never come.
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
