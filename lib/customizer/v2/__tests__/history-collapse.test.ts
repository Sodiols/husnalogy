import { describe, expect, it } from "vitest";
import { createHistoryStacks } from "@/app/components/customizer/useCustomizerHistory";

describe("collapsing a confirmed session into one undo step", () => {
  it("one Undo returns to the state before the session, however many steps it took", () => {
    const history = createHistoryStacks<string>();
    history.record("A");
    const checkpoint = history.checkpoint();
    history.record("B"); // before the first crop control
    history.record("C");
    history.record("D");
    expect(history.collapseSince(checkpoint)).toBe(true);
    expect(history.depth()).toEqual({ past: 2, future: 0 });
    expect(history.undo("E")).toBe("B");
    expect(history.undo("B")).toBe("A");
    expect(history.redo("A")).toBe("B");
    expect(history.redo("B")).toBe("E");
  });

  it("does nothing for a session of one step or none", () => {
    const history = createHistoryStacks<string>();
    const empty = history.checkpoint();
    expect(history.collapseSince(empty)).toBe(false);
    history.record("A");
    expect(history.collapseSince(empty)).toBe(false);
    expect(history.depth().past).toBe(1);
  });

  it("refuses to splice when the history limit dropped entries since the checkpoint", () => {
    const history = createHistoryStacks<string>(3);
    history.record("A");
    history.record("B");
    const checkpoint = history.checkpoint();
    history.record("C");
    history.record("D"); // "A" falls off the front
    history.record("E");
    expect(history.collapseSince(checkpoint)).toBe(false);
    expect(history.depth().past).toBe(3);
  });
});
