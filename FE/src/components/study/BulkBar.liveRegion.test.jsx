// @vitest-environment jsdom
// V4.1 W4-2 (screen-reader checklist row 4.6): the selection count must be
// announced from the FIRST selection, so its live region exists before it.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import BulkBar from "./BulkBar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (so) => act(() => root.render(<BulkBar so={so} boSuuTap={[]} onHanhDong={() => {}} onXoaChon={() => {}} dangChay={false} />));

describe("BulkBar live region", () => {
  it("is mounted while nothing is selected and the same node announces the count", async () => {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await render(0);
    const live = host.querySelectorAll('[aria-live="polite"]');
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe("");
    await render(1);
    const after = host.querySelectorAll('[aria-live="polite"]');
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(live[0]);
    expect(after[0].textContent).toBe("Đã chọn 1 tài liệu");
  });
});
