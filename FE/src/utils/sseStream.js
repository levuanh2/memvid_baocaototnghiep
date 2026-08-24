// Đọc luồng SSE bằng `fetch` thay vì `EventSource`.
//
// `EventSource` KHÔNG gửi được header, nên không đính được `Authorization: Bearer`.
// Backend `/query-stream` gọi `_require_app_user()` ngay dòng đầu, nên mọi kết nối
// EventSource đều 401 và frontend phải tụt về polling — mất sạch token chảy dần,
// chữ hiện một cục ở cuối.
//
// `fetch` gửi được header và huỷ được bằng `AbortController` có sẵn. Bù lại phải
// tự tách khung SSE, phần đó nằm ở `parseSseChunk` — hàm thuần, test được.

/**
 * Tách các khung SSE hoàn chỉnh ra khỏi bộ đệm.
 *
 * Trả `{ events, rest }`: `events` là mảng chuỗi data đã ghép, `rest` là phần
 * khung chưa trọn phải giữ lại cho lần đọc sau. Mạng cắt gói ở đâu cũng được —
 * đây chính là chỗ `EventSource` vốn lo hộ mà nay ta phải tự làm.
 *
 * Khung SSE kết thúc bằng một dòng trống. Chấp nhận cả CRLF lẫn LF.
 */
export function parseSseChunk(buffer) {
  const norm = String(buffer || "").replace(/\r\n/g, "\n");
  const parts = norm.split("\n\n");
  // Phần tử cuối luôn là phần chưa trọn (kể cả khi rỗng).
  const rest = parts.pop() ?? "";
  const events = [];

  for (const frame of parts) {
    const data = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;            // dòng ping, bỏ qua
      if (!line.startsWith("data:")) continue;       // event:/id:/retry: không dùng ở đây
      // Đặc tả SSE bỏ đúng MỘT dấu cách sau dấu hai chấm, không phải trim.
      const value = line.slice(5);
      data.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    if (data.length) events.push(data.join("\n"));
  }
  return { events, rest };
}

/**
 * Mở luồng SSE có xác thực và gọi `onEvent` cho từng khung.
 *
 * `onEvent` nhận chuỗi data thô — nơi gọi tự `JSON.parse`, vì một khung hỏng
 * không được phép giết cả luồng.
 *
 * Ném lỗi mang cờ `sseConnectionLost` khi không mở nổi kết nối, để nơi gọi vẫn
 * dùng lại được đường polling dự phòng đã có.
 */
export async function streamSse(url, { headers = {}, signal, onEvent } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { ...headers, Accept: "text/event-stream" },
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    const e = new Error("Không mở được kết nối realtime.");
    e.sseConnectionLost = true;
    e.cause = err;
    throw e;
  }

  if (!res.ok || !res.body) {
    const e = new Error(`Kết nối realtime bị từ chối (HTTP ${res.status}).`);
    e.sseConnectionLost = true;
    e.status = res.status;
    throw e;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const data of events) onEvent?.(data);
    }
    // Khung cuối có thể không kèm dòng trống nếu máy chủ đóng ngay sau khi ghi.
    const { events } = parseSseChunk(buffer + "\n\n");
    for (const data of events) onEvent?.(data);
  } finally {
    try {
      reader.cancel();
    } catch {
      /* luồng đã đóng */
    }
  }
}
