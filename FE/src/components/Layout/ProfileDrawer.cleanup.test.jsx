// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/anhDaiDienFile", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, kiemTraFile: () => null, thuNhoAnh: vi.fn(async () => new Blob(["avatar"], { type: "image/jpeg" })) };
});

vi.mock("../../auth/grantNks", () => ({
  layGrant: () => null,
  luuGrant: vi.fn(),
  quenGrant: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  capNhatHoSoNks: vi.fn(),
  doiAnhDaiDienNks: vi.fn(),
  layHoSoNks: vi.fn(),
  taoGrantNks: vi.fn(),
}));
vi.mock("../../utils/api", () => apiMocks);

import ProfileDrawer from "./ProfileDrawer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ProfileDrawer avatar preview lifecycle", () => {
  let host;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("revokes an unsaved preview object URL when the full-page profile unmounts", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:round7-avatar-preview"),
      revokeObjectURL,
    });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(
      <ProfileDrawer
        open
        variant="page"
        hoSo={{
          id: "nks-user-1",
          ten: "Nguyen An",
          chuCai: "NA",
          avatar: null,
          nhaCungCap: "NKS",
          dong: [{ khoa: "email", nhan: "Email", giaTri: "qa@example.test" }],
        }}
        onClose={vi.fn()}
        onHoSoMoi={vi.fn()}
      />,
    ));

    const fileInput = document.body.querySelector('input[type="file"]');
    const file = new File(["image"], "avatar.jpg", { type: "image/jpeg" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    root = null;
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:round7-avatar-preview");
  });

  it("does not call profile APIs merely by mounting the full-page profile", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(
      <ProfileDrawer
        open
        variant="page"
        hoSo={{
          id: "nks-user-1",
          ten: "Nguyen An",
          chuCai: "NA",
          avatar: null,
          nhaCungCap: "NKS",
          dong: [{ khoa: "email", nhan: "Email", giaTri: "qa@example.test" }],
        }}
        onClose={vi.fn()}
        onHoSoMoi={vi.fn()}
      />,
    ));

    expect(apiMocks.layHoSoNks).not.toHaveBeenCalled();
    expect(apiMocks.capNhatHoSoNks).not.toHaveBeenCalled();
    expect(apiMocks.doiAnhDaiDienNks).not.toHaveBeenCalled();
    expect(apiMocks.taoGrantNks).not.toHaveBeenCalled();
  });
});
