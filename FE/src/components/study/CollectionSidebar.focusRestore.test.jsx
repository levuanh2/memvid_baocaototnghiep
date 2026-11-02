// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CollectionSidebar from "./CollectionSidebar";
import DestructiveConfirmDialog from "../ui/DestructiveConfirmDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COLLECTION = { collection_id: "c1", name: "Alpha", color: null, hien_thi_count: 0 };

// Same wiring as DocumentList: the sidebar asks, the page owns the confirm dialog.
function Harness({ onDelete }) {
  const [target, setTarget] = useState(null);
  return (
    <>
      <CollectionSidebar boSuuTap={[COLLECTION]} chuaPhanLoai={0} the={[]} chon={{}} onChon={vi.fn()}
        onTao={vi.fn()} onSua={vi.fn()} onXoa={setTarget} hienLuuTru={false} onHienLuuTru={vi.fn()} />
      <DestructiveConfirmDialog open={Boolean(target)} title="Xoá bộ sưu tập" targetName={target?.name}
        confirmLabel="Xoá bộ sưu tập" onCancel={() => setTarget(null)} onConfirm={onDelete} />
    </>
  );
}

let host, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove(); host = null; root = null;
});

const byText = (text) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

it("returns focus to the collection delete button when the confirm dialog is dismissed with Escape (R82-A11Y-01)", async () => {
  const onDelete = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness onDelete={onDelete} />));

  await act(async () => document.body.querySelector('[aria-label="Sửa Alpha"]').click());
  const trigger = byText("Xoá");
  trigger.focus();
  await act(async () => trigger.click());
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});
