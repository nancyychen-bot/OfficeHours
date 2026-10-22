import { describe, it, expect } from "vitest";
import { FLOW_NODES } from "../lib/comms/flow";
import { COMMS_KINDS } from "../lib/email/templates";

describe("FLOW_NODES", () => {
  it("every node references only real CommsKinds", () => {
    const valid = new Set<string>(COMMS_KINDS);
    for (const n of FLOW_NODES) for (const k of n.commsKinds) expect(valid.has(k)).toBe(true);
  });
  it("covers both audiences", () => {
    expect(FLOW_NODES.some((n) => n.audience === "guest")).toBe(true);
    expect(FLOW_NODES.some((n) => n.audience === "expert")).toBe(true);
  });
  it("has unique node ids", () => {
    const ids = FLOW_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("schedule triggers carry a rule; event triggers do not", () => {
    for (const n of FLOW_NODES) {
      if (n.trigger.kind === "schedule") expect(n.trigger.rule).toBeTruthy();
      else expect("rule" in n.trigger).toBe(false);
    }
  });
});
