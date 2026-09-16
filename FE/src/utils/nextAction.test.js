import { describe, it, expect } from "vitest";
import { computeNextAction } from "./nextAction";

describe("computeNextAction", () => {
  it("select-sources when nothing is selected and no conversation yet", () => {
    expect(computeNextAction({ messagesCount: 0, selectedCount: 0 })).toBe("select-sources");
  });
  it("ask-question once sources are selected but no question sent yet", () => {
    expect(computeNextAction({ messagesCount: 0, selectedCount: 2 })).toBe("ask-question");
  });
  it("hides the strip entirely once a conversation exists, regardless of selection", () => {
    expect(computeNextAction({ messagesCount: 1, selectedCount: 2 })).toBeNull();
    expect(computeNextAction({ messagesCount: 3, selectedCount: 0 })).toBeNull();
  });
  it("never returns a Mind Map/Summary action — those aren't next-action strip buttons", () => {
    const result = computeNextAction({ messagesCount: 0, selectedCount: 1 });
    expect(["select-sources", "ask-question", null]).toContain(result);
  });
});
