import { useCallback, useEffect, useRef, useState } from "react";
import { createJobPoller } from "../utils/jobPoller";
import { cancelJob, fetchJobStatus } from "../utils/studyApi";

/**
 * Theo dõi một job nền của StudyMap (tạo quiz, tạo practice…).
 *
 * Dùng lại `createJobPoller` chứ không viết poller mới: nó đã xử lý `interrupted`,
 * 404 job đã bị dọn, và mất mạng kéo dài — ba thứ từng làm chip kẹt "đang tạo"
 * vĩnh viễn (known-issues 2026-07-17). Viết poller thứ hai là quên lại từ đầu.
 */
export function useStudyJob({ onDone } = {}) {
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const pollerRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const stop = useCallback(() => {
    pollerRef.current?.stop();
    pollerRef.current = null;
  }, []);

  // Rời trang giữa chừng vẫn phải gỡ timer, nếu không poller chạy tiếp trên một
  // component đã unmount và setState ném cảnh báo.
  useEffect(() => stop, [stop]);

  const start = useCallback((id) => {
    stop();
    setJobId(id);
    setError(null);
    setStatus({ status: "pending", progress: 0, current_node: "Đang xếp hàng" });
    const poller = createJobPoller({
      fetchStatus: fetchJobStatus,
      onTick: (s) => setStatus(s),
      onDone: (result) => { setStatus((p) => ({ ...(p || {}), status: "done", progress: 100 })); doneRef.current?.(result); },
      onError: (err) => setError(err?.message || "Job thất bại."),
      onCancelled: () => setError("Đã huỷ."),
    });
    pollerRef.current = poller;
    poller.start(id);
  }, [stop]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
    } catch {
      // Huỷ thất bại thì poller vẫn chạy và sẽ báo trạng thái thật — không nuốt
      // im lặng nhưng cũng không dựng lỗi giả lên màn hình.
    }
  }, [jobId]);

  const reset = useCallback(() => {
    stop();
    setJobId(null);
    setStatus(null);
    setError(null);
  }, [stop]);

  return {
    jobId,
    status,
    error,
    running: Boolean(jobId) && !error && status?.status !== "done",
    start,
    cancel,
    reset,
  };
}
