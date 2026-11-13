// @vitest-environment jsdom
// V6 chat: a study transcript. The question heads its turn, citations sit on the line as named
// buttons, and every answer ends with a control that opens THAT answer's evidence.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ChatArea from "./ChatArea";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { processCitations } from "../../utils/evidence";

beforeAll(() => {
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

let jobSeq = 0;
vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn((path) => {
    if (path === "/query") { jobSeq += 1; return Promise.resolve({ ok: true, json: async () => ({ job_id: `job-${jobSeq}` }) }); }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }),
  apiUrl: (p) => p,
  clearConversationContext: vi.fn(), deleteConversation: vi.fn(), resumeQuery: vi.fn(),
  _appError: vi.fn(async () => new Error("HTTP 500")), isNotFoundOrForbiddenError: vi.fn(() => false), isUnauthorizedError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));
const streams = {};
vi.mock("../../utils/sseStream", () => ({
  streamSse: vi.fn((url, { onEvent }) => new Promise(() => {
    const jobId = decodeURIComponent(String(url).split("/").pop());
    streams[jobId] = { emit: (frame) => onEvent(JSON.stringify(frame)) };
  })),
}));

let container;
let root;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null; root = null;
  for (const k of Object.keys(streams)) delete streams[k];
  jobSeq = 0;
  vi.clearAllMocks();
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const answer = (n) => ({
  payload: {
    answer: `Câu trả lời ${n}, lượng cầu giảm [Nguồn: a, đoạn ${n}].`,
    sources: ["a"],
    chunks: [{ video_stem: "a", chunk_id: n, text: `Đoạn ${n}` }],
  },
});

async function mount(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <ChatArea selectedSources={["a"]} sources={[{ video_stem: "a", filename: "Kinh tế vi mô.pdf", can_query: true }]}
          onOpenLeft={() => {}} {...props} />
      </StudyContextProvider>,
    );
  });
  await flush();
}
async function ask(text, n) {
  const textarea = container.querySelector("textarea");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { setValue.call(textarea, text); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { container.querySelector('button[aria-label="Gửi câu hỏi"]').click(); });
  await flush();
  await act(async () => { streams[`job-${n}`].emit({ status: "done", result: answer(n) }); });
  await flush();
}

describe("ChatArea (V6): study transcript", () => {
  it("sets the question as the heading of its turn, announced as the learner's question", async () => {
    await mount();
    await ask("Khi giá tăng thì sao?", 1);
    const q = container.querySelector(".chat-turn__question-text");
    expect(q.textContent).toBe("Bạn hỏi: Khi giá tăng thì sao?");
    expect(q.querySelector(".sr-only").textContent).toBe("Bạn hỏi: ");
    expect(container.querySelector(".chat-turn__answer")).toBeTruthy();
  });

  it("renders a citation as a named button on the line, not a raised <sup>", async () => {
    await mount();
    await ask("Khi giá tăng thì sao?", 1);
    const cite = container.querySelector(".chat-turn__answer .cite-chip");
    expect(cite.tagName).toBe("SPAN");
    expect(cite.getAttribute("role")).toBe("button");
    expect(cite.getAttribute("aria-label")).toBe("Nguồn 1: mở đoạn trích");
    expect(container.querySelector(".chat-turn__answer sup")).toBeNull();
  });

  it("every answer, not only the last, opens its own evidence", async () => {
    const onEvidence = vi.fn();
    const onOpenEvidence = vi.fn();
    await mount({ onEvidence, onOpenEvidence });
    await ask("Câu một?", 1);
    await ask("Câu hai?", 2);
    const buttons = [...container.querySelectorAll(".chat-turn__sources")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("1 đoạn trích");
    expect(buttons[0].textContent).toContain("Kinh tế vi mô.pdf");
    // The old text-only line pointed at a right margin phones do not have.
    expect(container.textContent).not.toContain("xem chi tiết ở lề phải");

    onEvidence.mockClear();
    await act(async () => buttons[0].click());
    expect(onEvidence).toHaveBeenCalledWith(expect.objectContaining({ chunks: [expect.objectContaining({ chunk_id: 1 })] }));
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
  });
});

describe("processCitations", () => {
  it("drops the space before a citation so the number sits against its word and the full stop stays attached", () => {
    const { md } = processCitations("lượng cầu giảm [Nguồn: a, đoạn 12].");
    expect(md).toBe("lượng cầu giảm[1](#cite:a:12).");
  });
  it("keeps line breaks before a citation", () => {
    const { md } = processCitations("Dòng một\n[Nguồn: a, đoạn 3]");
    expect(md).toBe("Dòng một\n[1](#cite:a:3)");
  });
});
