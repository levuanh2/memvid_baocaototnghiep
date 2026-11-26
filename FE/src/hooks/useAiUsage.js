import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../utils/api";

/**
 * Monthly AI usage of the signed-in account (`GET /usage/me`).
 *
 * One loader for every place that shows it (header chip, profile page), so the two can never
 * disagree about what "loading" or "failed" means.
 */
export function useAiUsage() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mountedRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    apiFetch("/usage/me").then((response) => {
      if (!response.ok) throw new Error("usage request failed");
      return response.json();
    }).then((data) => { if (mountedRef.current && data?.limit) setUsage(data); })
      .catch(() => { if (mountedRef.current) setError(true); })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  return { usage, loading, error, load };
}

export const formatTokens = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0));

// The server reports usage per internal feature key. Learners see what they did, not the key.
// An unknown key is shown as it is: hiding it would hide tokens that were really spent.
const TEN_TINH_NANG = {
  chat: "Hỏi đáp",
  answer: "Hỏi đáp",
  summary: "Tóm tắt",
  mindmap: "Sơ đồ",
  quiz: "Tạo quiz",
  grade: "Chấm bài",
  upload: "Xử lý tài liệu",
};

/** [[label, tokens]], largest first; keys that share a label are added together. */
export function usageByActivity(breakdown) {
  const tong = new Map();
  for (const [key, total] of Object.entries(breakdown || {})) {
    const nhan = TEN_TINH_NANG[key] || key;
    tong.set(nhan, (tong.get(nhan) || 0) + Number(total || 0));
  }
  return [...tong.entries()].sort((a, b) => b[1] - a[1]);
}
