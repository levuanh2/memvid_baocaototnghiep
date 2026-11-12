// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CollectionSidebar from "./CollectionSidebar";
import DestructiveConfirmDialog from "../ui/DestructiveConfirmDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ALPHA = { collection_id: "c1", name: "Alpha", color: null, hien_thi_count: 0 };
const BETA = { collection_id: "c2", name: "Beta", color: null, hien_thi_count: 0 };

// Same wiring as DocumentList: the sidebar asks, the page owns the confirm
// dialog, and a successful delete drops the collection and closes the dialog
// in one update (DocumentList.xoaBoSuuTap).
function Harness({ initial = [ALPHA], deleteRequest }) {
  const [list, setList] = useState(initial);
  const [target, setTarget] = useState(null);
  const confirm = async () => {
    await deleteRequest(target);
    setList((prev) => prev.filter((c) => c.collection_id !== target.collection_id));
    setTarget(null);
  };
  return (
    <>
      <CollectionSidebar boSuuTap={list} chuaPhanLoai={0} the={[]} chon={{}} onChon={vi.fn()}
        onTao={vi.fn()} onSua={vi.fn()} onXoa={setTarget} />
      <DestructiveConfirmDialog open={Boolean(target)} title="Xoá bộ sưu tập" targetName={target?.name}
        confirmLabel="Xoá bộ sưu tập" onCancel={() => setTarget(null)} onConfirm={confirm} />
    </>
  );
}

let host, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove(); host = null; root = null;
});

const byText = (text) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const dialog = () => document.body.querySelector('[role="dialog"]');

async function openDeleteDialog(props, name = "Alpha") {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness {...props} />));
  await act(async () => document.body.querySelector(`[aria-label="Sửa ${name}"]`).click());
  const trigger = byText("Xoá");
  trigger.focus();
  await act(async () => trigger.click());
  expect(dialog()).not.toBeNull();
  return trigger;
}

async function confirmDelete() {
  await act(async () => dialog().querySelector('input[type="checkbox"]').click());
  await act(async () => byText("Xoá bộ sưu tập").click());
}

it("returns focus to the collection delete button when the confirm dialog is dismissed with Escape (R82-A11Y-01)", async () => {
  const deleteRequest = vi.fn();
  const trigger = await openDeleteDialog({ deleteRequest });

  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

  expect(dialog()).toBeNull();
  expect(deleteRequest).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});

it("moves focus to the next collection after a successful delete, never to <body>", async () => {
  const deleteRequest = vi.fn().mockResolvedValue(undefined);
  await openDeleteDialog({ initial: [ALPHA, BETA], deleteRequest });

  await confirmDelete();

  expect(deleteRequest).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
  expect(document.body.querySelector('[data-collection-id="c1"]')).toBeNull();
  expect(document.activeElement).toBe(document.body.querySelector('[data-collection-id="c2"]'));
});

it("falls back to the previous collection, then to the create button", async () => {
  await openDeleteDialog({ initial: [ALPHA, BETA], deleteRequest: vi.fn().mockResolvedValue(undefined) }, "Beta");
  await confirmDelete();
  expect(document.activeElement).toBe(document.body.querySelector('[data-collection-id="c1"]'));

  act(() => root.unmount()); host.remove(); root = null;
  await openDeleteDialog({ initial: [ALPHA], deleteRequest: vi.fn().mockResolvedValue(undefined) });
  await confirmDelete();
  expect(document.activeElement).toBe(document.body.querySelector('[aria-label="Tạo bộ sưu tập"]'));
});

// The sidebar's fallback must not pull focus out of the dialog while the DELETE
// is in flight or after it fails (the list is unchanged in both cases). Where
// focus sits INSIDE the dialog meanwhile is DestructiveConfirmDialog's concern
// and is measured in real Chromium, not jsdom (no focus fixup for disabled).
it("does not move focus to the sidebar while the delete is in flight or after it fails", async () => {
  let reject;
  const deleteRequest = vi.fn(() => new Promise((_, rej) => { reject = rej; }));
  const trigger = await openDeleteDialog({ initial: [ALPHA, BETA], deleteRequest });
  const sidebar = document.body.querySelector('[aria-label="Bộ lọc thư viện"]');

  await confirmDelete();
  expect(deleteRequest).toHaveBeenCalledTimes(1);
  expect(dialog()).not.toBeNull();
  expect(sidebar.contains(document.activeElement)).toBe(false);

  await act(async () => { reject(new Error("Không xoá được bộ sưu tập.")); await Promise.resolve(); });

  expect(dialog()).not.toBeNull();
  expect(dialog().textContent).toContain("Không xoá được bộ sưu tập.");
  expect(sidebar.contains(document.activeElement)).toBe(false);
  expect(document.body.contains(trigger)).toBe(true);
  expect(document.body.querySelector('[data-collection-id="c2"]')).not.toBeNull();

  // Cancelling after the failure still returns focus to the surviving trigger.
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("does not steal focus from another live control when the delete completes", async () => {
  let resolve;
  const deleteRequest = vi.fn(() => new Promise((res) => { resolve = res; }));
  await openDeleteDialog({ initial: [ALPHA, BETA], deleteRequest });
  await confirmDelete();
  const elsewhere = document.createElement("button");
  elsewhere.textContent = "elsewhere";
  document.body.appendChild(elsewhere);

  await act(async () => { elsewhere.focus(); resolve(); await Promise.resolve(); });

  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});

it("ignores Escape while the delete is in flight: no cancel, no second request, no focus move", async () => {
  let resolve;
  const deleteRequest = vi.fn(() => new Promise((res) => { resolve = res; }));
  await openDeleteDialog({ initial: [ALPHA, BETA], deleteRequest });
  await confirmDelete();
  const sidebar = document.body.querySelector('[aria-label="Bộ lọc thư viện"]');

  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

  expect(dialog()).not.toBeNull();
  expect(deleteRequest).toHaveBeenCalledTimes(1);
  expect(sidebar.contains(document.activeElement)).toBe(false);
  await act(async () => { resolve(); await Promise.resolve(); });
});

it("has no 'Hiện đã lưu trữ' checkbox of its own: the Library toolbar owns that setting (V6)", async () => {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness deleteRequest={vi.fn()} />));
  expect(host.textContent).toContain("Yêu thích");
  expect(host.textContent).not.toContain("Hiện đã lưu trữ");
  expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(0);
});
