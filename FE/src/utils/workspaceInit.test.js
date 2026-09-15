import { describe, it, expect } from "vitest";
import { resolveInitialTab, resolveInitialRightView } from "./workspaceInit";

// Feature Pack B (Cross Navigation) — Workspace.jsx reads `?tab=`/`?right=`
// ONCE, as an initial value only (same contract as its pre-existing
// `?source=`/`?prompt=`). Pure here specifically so the fallback rule is
// locked down without mounting React: an unknown/garbage/absent value must
// degrade to the exact pre-existing default, never a new state that could
// not be reached before this pass.
describe("resolveInitialTab", () => {
  it("accepts the three real workspace panes", () => {
    expect(resolveInitialTab("mindmap")).toBe("mindmap");
    expect(resolveInitialTab("summary")).toBe("summary");
    expect(resolveInitialTab("chat")).toBe("chat");
  });
  it("unknown value falls back to chat, the pre-existing default", () => {
    expect(resolveInitialTab("studymap")).toBe("chat");
    expect(resolveInitialTab("<script>")).toBe("chat");
  });
  it("absent/empty/whitespace-only falls back to chat", () => {
    expect(resolveInitialTab(null)).toBe("chat");
    expect(resolveInitialTab(undefined)).toBe("chat");
    expect(resolveInitialTab("")).toBe("chat");
    expect(resolveInitialTab("   ")).toBe("chat");
  });
});

describe("resolveInitialRightView", () => {
  it("accepts the four real right-column views", () => {
    expect(resolveInitialRightView("timeline")).toBe("timeline");
    expect(resolveInitialRightView("tutor")).toBe("tutor");
    expect(resolveInitialRightView("evidence")).toBe("evidence");
    expect(resolveInitialRightView("insights")).toBe("insights"); // Feature Pack D
  });
  it("unknown value falls back to evidence, the pre-existing default", () => {
    expect(resolveInitialRightView("inspector")).toBe("evidence");
  });
  it("absent/empty falls back to evidence", () => {
    expect(resolveInitialRightView(null)).toBe("evidence");
    expect(resolveInitialRightView("")).toBe("evidence");
  });
});
