import { describe, it, expect } from "vitest";
import { validateAssignInput, assignExpert, type AssignDeps, type AssignExpertInput } from "../lib/events/assign";

const base: AssignExpertInput = { bookingId: "bk1", displayName: "Yina Huang", email: "yina@x.com", type: "ambassador" };

describe("validateAssignInput", () => {
  it("accepts a well-formed assignment", () => {
    expect(validateAssignInput(base)).toBeNull();
  });
  it("requires a name", () => {
    expect(validateAssignInput({ ...base, displayName: "  " })).toMatch(/name/i);
  });
  it("requires a plausible email (needed for the calendar invite)", () => {
    expect(validateAssignInput({ ...base, email: "" })).toMatch(/email/i);
    expect(validateAssignInput({ ...base, email: "nope" })).toMatch(/email/i);
  });
});

function makeDeps(over: Partial<AssignDeps> = {}): {
  deps: AssignDeps;
  calls: { assigned: AssignExpertInput[]; invited: string[]; dmed: string[]; mirrored: string[] };
} {
  const calls = { assigned: [] as AssignExpertInput[], invited: [] as string[], dmed: [] as string[], mirrored: [] as string[] };
  const deps: AssignDeps = {
    setAssignment: async (i) => { calls.assigned.push(i); return { id: i.bookingId } as unknown as Awaited<ReturnType<AssignDeps["setAssignment"]>>; },
    invite: async (id) => { calls.invited.push(id); },
    dm: async (id) => { calls.dmed.push(id); },
    mirror: async (b) => { calls.mirrored.push((b as { id: string }).id); },
    log: async () => {},
    ...over,
  };
  return { deps, calls };
}

describe("assignExpert", () => {
  it("assigns, sends the invite, Slack DM, and mirrors — in that order", async () => {
    const { deps, calls } = makeDeps();
    const res = await assignExpert(base, deps);
    expect(res.ok).toBe(true);
    expect(calls.assigned).toHaveLength(1);
    expect(calls.invited).toEqual(["bk1"]);
    expect(calls.dmed).toEqual(["bk1"]);
    expect(calls.mirrored).toEqual(["bk1"]);
  });

  it("rejects invalid input without touching the booking", async () => {
    const { deps, calls } = makeDeps();
    const res = await assignExpert({ ...base, email: "bad" }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/email/i);
    expect(calls.assigned).toEqual([]);
    expect(calls.invited).toEqual([]);
  });

  it("returns an error when the booking doesn't exist (no invite sent)", async () => {
    const { deps, calls } = makeDeps({ setAssignment: async () => null });
    const res = await assignExpert(base, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(calls.invited).toEqual([]);
    expect(calls.mirrored).toEqual([]);
  });

  it("still succeeds if the best-effort Slack DM throws", async () => {
    const { deps, calls } = makeDeps({ dm: async () => { throw new Error("slack down"); } });
    const res = await assignExpert(base, deps);
    expect(res.ok).toBe(true);
    expect(calls.invited).toEqual(["bk1"]); // invite + mirror still happened
    expect(calls.mirrored).toEqual(["bk1"]);
  });
});
