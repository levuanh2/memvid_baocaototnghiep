// @vitest-environment jsdom
// A cancelled question must not publish into the next one (V6 bug hunt #1).
// Cancel A, send B at once, then let A's request finish: A used to read the shared "cancelled"
// flag that B had just cleared, so A appended an error bubble and switched `loading` off while
// B was still running; and A's cancel tail deleted B's question with `slice(0, -1)`.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ChatArea from "./ChatArea";
import { StudyContextProvider } from "../../study/StudyContextProvider";

beforeAll(() => {
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

// Every POST /query stays pending until the test settles it.
const queries = [];
vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn((path) => {
    if (path === "/query") return new Promise((resolve, reject) => { queries.push({ resolve, reject }); });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }),
  apiUrl: (p) => p,
  clearConversationContext: vi.fn(), deleteConversation: vi.fn(), resumeQuery: vi.fn(),
  _appError: vi.fn(async () => new Error("HTTP 500")), isNotFoundOrForbiddenError: vi.fn(() => false), isUnauthorizedError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));
// Every stream stays open; the test pushes frames into it by job id.
const streams = {};
vi.mock("../../utils/sseStream", () => ({
  streamSse: vi.fn((url, { onEvent, signal }) => new Promise((resolve, reject) => {
    const jobId = decodeURIComponent(String(url).split("/").pop());
    streams[jobId] = { emit: (frame) => onEvent(JSON.stringify(frame)) };
    signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  })),
}));
const cancelJob = vi.fn(async () => ({}));
vi.mock("../../utils/studyApi", async () => ({
  ...(await vi.importActual("../../utils/studyApi")),
  cancelJob: (...a) => cancelJob(...a),
}));

let container;
let root;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null; root = null;
  queries.length = 0;
  for (const k of Object.keys(streams)) delete streams[k];
  vi.clearAllMocks();
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (label) => container.querySelector(`button[aria-label="${label}"]`);

async function ask(text) {
  const textarea = container.querySelector("textarea");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { setValue.call(textarea, text); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { button("Gửi câu hỏi").click(); });
  await flush();
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <ChatArea selectedSources={["a"]} sources={[{ video_stem: "a", filename: "A.pdf", can_query: true }]} onOpenLeft={() => {}} />
      </StudyContextProvider>
    );
  });
  await flush();
}

describe("ChatArea: a cancelled attempt cannot publish into the next one", () => {
  it("A's late failure adds no error bubble, keeps B loading and keeps B's question", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mount();

    await ask("Câu hỏi A");
    expect(queries.length).toBe(1);
    expect(button("Huỷ truy vấn")).toBeTruthy();

    await act(async () => { button("Huỷ truy vấn").click(); });
    await flush();
    await ask("Câu hỏi B");
    expect(queries.length).toBe(2);
    expect(button("Huỷ truy vấn")).toBeTruthy();

    // A's request now ends with a server error (not an abort).
    await act(async () => { queries[0].resolve({ ok: false, status: 500, json: async () => ({}) }); });
    await flush();

    expect(container.textContent).toContain("Câu hỏi B");
    expect(container.textContent).not.toContain("HTTP 500");
    // B is still in flight: the cancel control is still there, the send control is not back.
    expect(button("Huỷ truy vấn")).toBeTruthy();
  });

  it("when A's POST succeeds after the cancel, its job is cancelled and never tracked", async () => {
    await mount();
    await ask("Câu hỏi A");
    await act(async () => { button("Huỷ truy vấn").click(); });
    await flush();
    await ask("Câu hỏi B");

    await act(async () => { queries[0].resolve({ ok: true, json: async () => ({ job_id: "job-A" }) }); });
    await flush();

    expect(cancelJob).toHaveBeenCalledWith("job-A");
    expect(container.textContent).toContain("Câu hỏi B");
    expect(button("Huỷ truy vấn")).toBeTruthy();
  });

  it("a late frame from A's stream does not touch B's streamed text or progress", async () => {
    await mount();
    await ask("Câu hỏi A");
    await act(async () => { queries[0].resolve({ ok: true, json: async () => ({ job_id: "job-A" }) }); });
    await flush();
    expect(streams["job-A"]).toBeTruthy();

    await act(async () => { button("Huỷ truy vấn").click(); });
    await flush();
    await ask("Câu hỏi B");
    await act(async () => { queries[1].resolve({ ok: true, json: async () => ({ job_id: "job-B" }) }); });
    await flush();
    expect(streams["job-B"]).toBeTruthy();

    await act(async () => { streams["job-B"].emit({ type: "token", content: "Phần đầu của B. " }); });
    await act(async () => { streams["job-A"].emit({ type: "token", content: "RÁC CỦA A" }); });
    await act(async () => { streams["job-A"].emit({ type: "status", status: "error", error: "A hỏng muộn" }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });

    expect(container.textContent).toContain("Phần đầu của B.");
    expect(container.textContent).not.toContain("RÁC CỦA A");
    expect(container.textContent).not.toContain("A hỏng muộn");
    expect(button("Huỷ truy vấn")).toBeTruthy();
  });

  it("cancelling B before its POST answers does not cancel the previous question's job", async () => {
    await mount();
    await ask("Câu hỏi A");
    await act(async () => { queries[0].resolve({ ok: true, json: async () => ({ job_id: "job-A" }) }); });
    await flush();
    await act(async () => { streams["job-A"].emit({ type: "status", status: "done", result: { answer: "Trả lời A", sources: [] } }); });
    await flush();
    expect(button("Gửi câu hỏi")).toBeTruthy();   // A finished

    await ask("Câu hỏi B");
    await act(async () => { button("Huỷ truy vấn").click(); });
    await flush();
    expect(cancelJob).not.toHaveBeenCalledWith("job-A");
  });
});
