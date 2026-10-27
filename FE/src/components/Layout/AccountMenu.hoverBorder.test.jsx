// @vitest-environment jsdom
//
// Phase C Round 2 (UX-VIS defect found during independent review, not in the
// original audit): the trigger button's border color was set via an inline
// `style={{ borderColor: ... }}`, which always outranks a class selector in
// the cascade — including `hover:border-[var(--accent)]` — regardless of
// how the class itself is written. The fix moves the default border into a
// class too (`border-[var(--border-color)]`) so the hover variant can
// actually win. This test locks that: no inline border style, and both the
// base and hover border utilities present as classes.
import { afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AccountMenu from "./AccountMenu";

describe("AccountMenu trigger border", () => {
  let root;
  let host;
  afterEach(() => {
    root?.unmount();
    host?.remove();
  });

  it("carries no inline border-color override, so the accent hover class can win the cascade", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AccountMenu user={{ email: "ban@vidu.com" }} onLogout={() => {}} />
        </MemoryRouter>,
      );
    });
    const button = host.querySelector("button[aria-haspopup='menu']");
    expect(button).toBeTruthy();
    expect(button.getAttribute("style")).toBeNull();
    expect(button.className).toContain("border-[var(--border-color)]");
    expect(button.className).toContain("hover:border-[var(--accent)]");
  });
});
