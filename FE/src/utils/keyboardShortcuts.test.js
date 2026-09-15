import { describe, it, expect } from "vitest";
import { SHORTCUT_REGISTRY, globalShortcutAction, mindmapRelationAction } from "./keyboardShortcuts";

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const input = { tagName: "INPUT", isContentEditable: false };
const textarea = { tagName: "TEXTAREA", isContentEditable: false };
const contentEditable = { tagName: "DIV", isContentEditable: true };
const body = { tagName: "BODY", isContentEditable: false };

describe("SHORTCUT_REGISTRY", () => {
  it("every entry has a unique id and no blank fields", () => {
    const ids = SHORTCUT_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUT_REGISTRY) {
      expect(s.keys).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(typeof s.isNew).toBe("boolean");
    }
  });
});

describe("globalShortcutAction", () => {
  it("Alt+C/M/S/T map to the four workspace nav actions", () => {
    expect(globalShortcutAction(ev("c", { altKey: true }), { activeElement: body })).toBe("nav-chat");
    expect(globalShortcutAction(ev("M", { altKey: true }), { activeElement: body })).toBe("nav-mindmap");
    expect(globalShortcutAction(ev("s", { altKey: true }), { activeElement: body })).toBe("nav-studymap");
    expect(globalShortcutAction(ev("T", { altKey: true }), { activeElement: body })).toBe("nav-timeline");
  });

  it("Alt+[ and Alt+] map to history back/forward, not the browser's Alt+Left/Right", () => {
    expect(globalShortcutAction(ev("[", { altKey: true }), { activeElement: body })).toBe("history-back");
    expect(globalShortcutAction(ev("]", { altKey: true }), { activeElement: body })).toBe("history-forward");
    expect(globalShortcutAction(ev("ArrowLeft", { altKey: true }), { activeElement: body })).toBeNull();
  });

  it("bare ? opens the shortcuts overlay", () => {
    expect(globalShortcutAction(ev("?"), { activeElement: body })).toBe("help");
  });

  it("never fires while typing in an input, textarea, or contentEditable", () => {
    expect(globalShortcutAction(ev("c", { altKey: true }), { activeElement: input })).toBeNull();
    expect(globalShortcutAction(ev("m", { altKey: true }), { activeElement: textarea })).toBeNull();
    expect(globalShortcutAction(ev("?"), { activeElement: contentEditable })).toBeNull();
  });

  it("Alt alone with an unmapped key, or no altKey at all, returns null", () => {
    expect(globalShortcutAction(ev("c", { altKey: true }), { activeElement: null })).toBe("nav-chat");
    expect(globalShortcutAction(ev("x", { altKey: true }), { activeElement: body })).toBeNull();
    expect(globalShortcutAction(ev("c"), { activeElement: body })).toBeNull();
  });

  it("Ctrl/Cmd held alongside Alt is refused (leaves room for the browser/OS)", () => {
    expect(globalShortcutAction(ev("c", { altKey: true, ctrlKey: true }), { activeElement: body })).toBeNull();
  });
});

describe("mindmapRelationAction", () => {
  it("maps bare c/u/d/[/] to the five relation actions", () => {
    expect(mindmapRelationAction(ev("c"), { activeElement: body })).toBe("center");
    expect(mindmapRelationAction(ev("U"), { activeElement: body })).toBe("parent");
    expect(mindmapRelationAction(ev("d"), { activeElement: body })).toBe("child");
    expect(mindmapRelationAction(ev("["), { activeElement: body })).toBe("prev-sibling");
    expect(mindmapRelationAction(ev("]"), { activeElement: body })).toBe("next-sibling");
  });

  it("never fires with a modifier held — Alt+C stays owned by globalShortcutAction alone", () => {
    expect(mindmapRelationAction(ev("c", { altKey: true }), { activeElement: body })).toBeNull();
    expect(mindmapRelationAction(ev("u", { ctrlKey: true }), { activeElement: body })).toBeNull();
  });

  it("never fires while typing", () => {
    expect(mindmapRelationAction(ev("c"), { activeElement: input })).toBeNull();
  });

  it("never fires while a button/link/menuitem holds keyboard focus — not just form fields", () => {
    const button = { tagName: "BUTTON", isContentEditable: false };
    const link = { tagName: "A", isContentEditable: false };
    expect(mindmapRelationAction(ev("d"), { activeElement: button })).toBeNull();
    expect(mindmapRelationAction(ev("u"), { activeElement: link })).toBeNull();
  });
});
