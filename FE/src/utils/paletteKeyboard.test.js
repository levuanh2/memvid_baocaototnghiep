import { describe, expect, it } from "vitest";
import { phimBang } from "./paletteKeyboard";

const phim = (key, over = {}) => ({ key, shiftKey: false, ...over });

describe("phimBang", () => {
  it("tongSo = 0 -> chỉ Escape có phản ứng", () => {
    expect(phimBang(phim("ArrowDown"), { chiSo: 0, tongSo: 0 })).toBeNull();
    expect(phimBang(phim("Escape"), { chiSo: 0, tongSo: 0 })).toEqual({ loai: "dong" });
  });

  it("ArrowDown / ArrowUp cuộn vòng", () => {
    expect(phimBang(phim("ArrowDown"), { chiSo: 2, tongSo: 3 })).toEqual({ loai: "focus", chiSo: 0 });
    expect(phimBang(phim("ArrowUp"), { chiSo: 0, tongSo: 3 })).toEqual({ loai: "focus", chiSo: 2 });
  });

  it("Tab giống ArrowDown, Shift+Tab giống ArrowUp", () => {
    expect(phimBang(phim("Tab"), { chiSo: 0, tongSo: 3 })).toEqual({ loai: "focus", chiSo: 1 });
    expect(phimBang(phim("Tab", { shiftKey: true }), { chiSo: 0, tongSo: 3 })).toEqual({ loai: "focus", chiSo: 2 });
  });

  it("Home / End", () => {
    expect(phimBang(phim("Home"), { chiSo: 2, tongSo: 5 })).toEqual({ loai: "focus", chiSo: 0 });
    expect(phimBang(phim("End"), { chiSo: 0, tongSo: 5 })).toEqual({ loai: "focus", chiSo: 4 });
  });

  it("Enter kích hoạt mục đang focus", () => {
    expect(phimBang(phim("Enter"), { chiSo: 2, tongSo: 5 })).toEqual({ loai: "kich_hoat", chiSo: 2 });
  });

  it("Escape đóng bất kể chỉ số", () => {
    expect(phimBang(phim("Escape"), { chiSo: 3, tongSo: 5 })).toEqual({ loai: "dong" });
  });

  it("phím khác -> null", () => {
    expect(phimBang(phim("a"), { chiSo: 0, tongSo: 5 })).toBeNull();
  });
});
