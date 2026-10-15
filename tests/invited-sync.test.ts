import { describe, it, expect } from "vitest";
import { selectInvitedToSync } from "@/lib/events/invited-sync";
import type { LumaGuestListEntry } from "@/lib/luma/types";

const g = (id: string, approval: string): LumaGuestListEntry =>
  ({ id, user_email: `${id}@x.com`, approval_status: approval, registration_answers: [] }) as LumaGuestListEntry;

describe("selectInvitedToSync", () => {
  it("ingests a new invited guest with no booking yet", () => {
    const out = selectInvitedToSync([g("a", "invited")], new Map());
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("skips an invited guest already stored as invited (steady state)", () => {
    const out = selectInvitedToSync([g("a", "invited")], new Map([["a", { luma_status: "invited" }]]));
    expect(out).toEqual([]);
  });

  it("re-ingests an invited booking that has since been accepted (approved)", () => {
    const out = selectInvitedToSync([g("a", "approved")], new Map([["a", { luma_status: "invited" }]]));
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("ignores guests that are neither now-invited nor stored-invited", () => {
    const out = selectInvitedToSync([g("a", "approved")], new Map([["a", { luma_status: "approved" }]]));
    expect(out).toEqual([]);
  });
});
