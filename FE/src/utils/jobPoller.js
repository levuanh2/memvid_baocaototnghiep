// Poller job nền dùng chung (mindmap/summary) — KHÔNG hard-timeout (bài học: job
// thật chạy vài phút, FE 180s+10s cũ bỏ cuộc giữa chừng → user tưởng lỗi).
export const STALL_MS = 5 * 60 * 1000;

export const pollIntervalMs = (elapsedMs) =>
  elapsedMs < 30_000 ? 2000 : elapsedMs < 120_000 ? 5000 : 10_000;

// Fetch lỗi liên tiếp quá số này → coi là terminal (BE chết/mất mạng kéo dài),
// đừng poll vô hạn để chip kẹt "đang tạo" mãi.
export const MAX_CONSECUTIVE_FETCH_FAILURES = 5;

const DEFAULT_MESSAGES = {
  notFound: "Không tìm thấy job trên server (có thể đã bị dọn). Hãy tạo lại.",
  lost: (n) => `Mất liên lạc với server sau ${n} lần thử. Hãy tạo lại.`,
  error: "Lỗi khi chạy job.",
  interrupted: "Job bị gián đoạn trên server (có thể do khởi động lại). Hãy tạo lại.",
};

export function createJobPoller({
  fetchStatus, onTick, onDone, onError, onCancelled,
  messages = {}, fingerprintExtra = () => 0,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, now = Date.now,
}) {
  const msgs = { ...DEFAULT_MESSAGES, ...messages };
  let timer = null;
  let stopped = true;
  let startTs = 0;
  let lastFingerprint = "";
  let lastChangeTs = 0;
  let failStreak = 0;

  const fingerprint = (s) =>
    JSON.stringify([s?.progress ?? null, s?.current_node ?? null, fingerprintExtra(s)]);

  const schedule = (jobId) => {
    if (stopped) return;
    timer = setTimeoutFn(() => tick(jobId), pollIntervalMs(now() - startTs));
  };

  const tick = async (jobId) => {
    if (stopped) return;
    let status;
    try {
      status = await fetchStatus(jobId);
      failStreak = 0;
    } catch (err) {
      // 404 = job không tồn tại (jobId cũ trong localStorage sau khi BE mất
      // jobs.sqlite, hoặc job đã bị dọn) — terminal ngay, không phải "thử lại".
      if (err?.status === 404) {
        stopped = true;
        onError?.(new Error(msgs.notFound));
        return;
      }
      failStreak += 1;
      if (failStreak >= MAX_CONSECUTIVE_FETCH_FAILURES) {
        stopped = true;
        onError?.(new Error(msgs.lost(failStreak)));
        return;
      }
      console.warn(`[JobPoller] job=${jobId} fetch lỗi (${failStreak}), thử lại:`, err);
      schedule(jobId);
      return;
    }
    if (stopped) return;
    const fp = fingerprint(status);
    if (fp !== lastFingerprint) { lastFingerprint = fp; lastChangeTs = now(); }
    const stalled = now() - lastChangeTs > STALL_MS;
    onTick?.(status, { stalled });
    if (status.status === "done") {
      stopped = true;
      const result = status.usage && status.result && typeof status.result === "object"
        ? { ...status.result, __usage: status.usage }
        : status.result;
      onDone?.(result);
      return;
    }
    // "failed" = the guided worker's own terminal-failure status
    // (guided_worker.py, mindmap_generation.py: set after retry exhaustion
    // or an unrecoverable exception during generation; guided_store.py
    // treats it as equivalent to "error" for completed_at bookkeeping).
    // This poller only recognized "error"/"timeout" as terminal failures --
    // "failed" fell through every check below and hit the plain
    // `schedule(jobId)` at the bottom, so a real backend failure polled
    // forever: onTick kept firing with an unchanged terminal status,
    // stageLabel() didn't match any of its regexes for it, so the UI kept
    // showing the generic "Đang tạo sơ đồ…" label indefinitely instead of
    // ever surfacing the real error -- exactly the reported "Generate ->
    // dialog closes -> ~5s -> nothing" symptom, with the job actually dead
    // on the server the whole time. `status.error` is already populated
    // correctly on this path (guided_store.py's own read-side row mapping:
    // `d["error"] = d.get("error_message")`), so no other change needed.
    if (status.status === "error" || status.status === "timeout" || status.status === "failed") {
      stopped = true; onError?.(new Error(status.error || msgs.error)); return;
    }
    if (status.status === "cancelled") { stopped = true; onCancelled?.(); return; }
    // "interrupted" = job mồ côi sau khi BE restart (mark_interrupted_jobs) — không
    // executor nào chạy tiếp, poll thêm là vô hạn → terminal như error, kèm hướng dẫn.
    if (status.status === "interrupted") {
      stopped = true; onError?.(new Error(msgs.interrupted)); return;
    }
    schedule(jobId);
  };

  return {
    start(jobId) {
      stopped = false;
      startTs = now();
      lastChangeTs = now();
      lastFingerprint = "";
      tick(jobId);
    },
    stop() {
      stopped = true;
      if (timer != null) { clearTimeoutFn(timer); timer = null; }
    },
  };
}
