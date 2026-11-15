// @vitest-environment jsdom
// V6 quiz setup: an empty document list says so, documents that cannot be used yet say why,
// and generation progress uses words instead of the job's internal step names.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuizSetup, { nhanBuocRaDe, trangThaiChonDe } from "./QuizSetup";

const navigate = vi.fn();
let params = new URLSearchParams();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [params],
}));
vi.mock("../../components/study/StudyShell", () => ({
  default: ({ loading, error, children, actions }) => <div>{actions}{loading ? "Đang tải…" : error || children}</div>,
}));
const listDocuments = vi.fn();
vi.mock("../../utils/studyApi", async () => ({
  ...(await vi.importActual("../../utils/studyApi")),
  listDocuments: (...a) => listDocuments(...a),
  getDocument: vi.fn(async () => ({ document_id: "doc-1", title: "Tài liệu 1" })),
  listSections: vi.fn(async () => []),
}));

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  navigate.mockReset(); listDocuments.mockReset();
  params = new URLSearchParams();
});
async function renderPicker(documents) {
  listDocuments.mockResolvedValue(documents);
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<QuizSetup />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("QuizSetup (V6): document picker", () => {
  it("an empty list says there is nothing to quiz on and leads to the Library", async () => {
    await renderPicker([]);
    expect(container.textContent).toContain("Chưa có tài liệu nào để ra đề.");
    const back = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Về Thư viện"));
    await act(async () => back.click());
    expect(navigate).toHaveBeenCalledWith("/app/study");
  });

  it("a processing or failed document is not offered as ready, and says why", async () => {
    await renderPicker([
      { document_id: "ok", title: "Sẵn sàng", status: "completed", ingest_status: "index_ready" },
      { document_id: "p", title: "Đang xử lý", status: "processing", ingest_status: "processing" },
      { document_id: "f", title: "Lỗi", status: "failed", ingest_status: "error" },
    ]);
    const buttons = [...container.querySelectorAll("button")];
    const byTitle = (t) => buttons.find((b) => b.textContent.includes(t));
    expect(byTitle("Sẵn sàng").disabled).toBe(false);
    expect(byTitle("Đang xử lý").disabled).toBe(true);
    expect(byTitle("Lỗi").disabled).toBe(true);
    const reason = document.getElementById(byTitle("Lỗi").getAttribute("aria-describedby"));
    expect(reason.textContent).toContain("bị lỗi");
    await act(async () => byTitle("Sẵn sàng").click());
    expect(navigate).toHaveBeenCalledWith("/app/study/quiz/new?document=ok");
  });
});

describe("quiz generation steps in words", () => {
  it("names every step the backend reports, and never shows an internal name", () => {
    for (const node of ["Queued", "BuildContext", "GenerateQuestions", "Validate", "BuSoCauThieu", "Persist", "Cancelled"]) {
      expect(nhanBuocRaDe(node)).not.toBe(node);
      expect(nhanBuocRaDe(node)).toMatch(/^(Đang|Đã)/);
    }
    expect(nhanBuocRaDe("SomethingNew")).toBe("Đang chuẩn bị");
    expect(nhanBuocRaDe(undefined)).toBe("Đang chuẩn bị");
    expect(nhanBuocRaDe("__proto__")).toBe("Đang chuẩn bị");
  });
  it("a completed document is usable", () => {
    expect(trangThaiChonDe({ status: "completed", ingest_status: "index_ready" })).toBeNull();
  });
});
