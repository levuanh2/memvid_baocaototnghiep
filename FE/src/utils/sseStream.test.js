import { describe, it, expect, vi } from "vitest";
import { parseSseChunk, streamSse } from "./sseStream";

describe("parseSseChunk", () => {
  it("tách các khung trọn vẹn, giữ lại phần dở", () => {
    const { events, rest } = parseSseChunk('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });

  it("ghép được khung bị cắt giữa chừng qua hai lần đọc", () => {
    // Đây là việc EventSource vốn lo hộ; dùng fetch thì phải tự làm.
    const first = parseSseChunk('data: {"type":"tok');
    expect(first.events).toEqual([]);
    const second = parseSseChunk(first.rest + 'en","content":"xin"}\n\n');
    expect(second.events).toEqual(['{"type":"token","content":"xin"}']);
    expect(second.rest).toBe("");
  });

  it("chỉ bỏ đúng MỘT dấu cách sau dấu hai chấm, không trim", () => {
    const { events } = parseSseChunk("data:  hai dấu cách \n\n");
    expect(events).toEqual([" hai dấu cách "]);
  });

  it("thiếu dấu cách sau dấu hai chấm vẫn đọc được", () => {
    expect(parseSseChunk("data:{}\n\n").events).toEqual(["{}"]);
  });

  it("nối nhiều dòng data trong cùng một khung bằng xuống dòng", () => {
    expect(parseSseChunk("data: dòng một\ndata: dòng hai\n\n").events)
      .toEqual(["dòng một\ndòng hai"]);
  });

  it("bỏ qua dòng ping và các trường không dùng", () => {
    const { events } = parseSseChunk(": ping\nevent: message\nid: 7\ndata: thật\n\n");
    expect(events).toEqual(["thật"]);
  });

  it("khung không có dòng data nào thì không sinh sự kiện rỗng", () => {
    expect(parseSseChunk(": chỉ có ping\n\n").events).toEqual([]);
  });

  it("chấp nhận CRLF", () => {
    expect(parseSseChunk("data: a\r\n\r\n").events).toEqual(["a"]);
  });

  it("đầu vào rỗng hoặc thiếu không nổ", () => {
    expect(parseSseChunk("")).toEqual({ events: [], rest: "" });
    expect(parseSseChunk(null)).toEqual({ events: [], rest: "" });
    expect(parseSseChunk(undefined)).toEqual({ events: [], rest: "" });
  });
});

// Luồng giả: phát từng mẩu byte như mạng thật cắt gói.
function fakeStream(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () =>
        i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { done: true },
      cancel: () => {},
    }),
  };
}

describe("streamSse", () => {
  it("gửi kèm header và đẩy từng sự kiện ra onEvent", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: fakeStream(['data: {"n":1}\n\ndata: {"n', '":2}\n\n']),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const seen = [];
    await streamSse("/query-stream/abc", {
      headers: { Authorization: "Bearer xyz" },
      onEvent: (d) => seen.push(d),
    });

    expect(seen).toEqual(['{"n":1}', '{"n":2}']);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer xyz");
    expect(opts.headers.Accept).toBe("text/event-stream");
    vi.unstubAllGlobals();
  });

  it("401 ném lỗi mang cờ sseConnectionLost để còn tụt về polling", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 401, body: null }));
    await expect(streamSse("/x", {})).rejects.toMatchObject({
      sseConnectionLost: true,
      status: 401,
    });
    vi.unstubAllGlobals();
  });

  it("khung cuối không kèm dòng trống vẫn được đọc", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true, status: 200, body: fakeStream(['data: {"cuoi":true}']),
    }));
    const seen = [];
    await streamSse("/x", { onEvent: (d) => seen.push(d) });
    expect(seen).toEqual(['{"cuoi":true}']);
    vi.unstubAllGlobals();
  });

  it("huỷ bằng AbortController thì ném AbortError, không phải lỗi mất kết nối", async () => {
    vi.stubGlobal("fetch", async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    await expect(streamSse("/x", {})).rejects.toMatchObject({ name: "AbortError" });
    vi.unstubAllGlobals();
  });
});
