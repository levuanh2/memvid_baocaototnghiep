// @vitest-environment jsdom
// V6 header (owner decision): keyboard-shortcut help is an item in the account menu instead of
// a separate header button.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountMenu from "./AccountMenu";

let root;
let host;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
});

async function openMenu(props) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><AccountMenu user={{ email: "ban@vidu.com" }} onLogout={() => {}} {...props} /></MemoryRouter>);
  });
  await act(async () => host.querySelector("button[aria-haspopup='menu']").click());
}
const item = () => [...host.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes("Phím tắt"));

describe("AccountMenu: keyboard-shortcut help", () => {
  it("offers 'Phím tắt', closes the menu and opens the help when chosen", async () => {
    const onShowShortcuts = vi.fn();
    await openMenu({ onShowShortcuts });
    expect(item()).toBeTruthy();
    // The key hint is decoration: the item's name stays "Phím tắt".
    expect(item().querySelector("kbd").getAttribute("aria-hidden")).not.toBeNull();

    await act(async () => item().click());
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("is absent where no help is wired (the item never appears as a dead control)", async () => {
    await openMenu({});
    expect(item()).toBeUndefined();
  });
});
