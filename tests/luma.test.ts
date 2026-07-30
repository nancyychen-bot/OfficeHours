import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLumaSignature } from "@/lib/luma/verify";
import { normalizeGuest, isCheckedIn, answerToString } from "@/lib/luma/parse";
import type { LumaGuestData } from "@/lib/luma/types";

const SECRET = "whsec_test_secret";

function sign(rawBody: string, t: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyLumaSignature", () => {
  const rawBody = JSON.stringify({ type: "guest.registered", data: {} });
  const now = 1_800_000_000;

  it("accepts a valid signature", () => {
    const header = sign(rawBody, now);
    expect(verifyLumaSignature({ rawBody, signatureHeader: header, secret: SECRET, nowSec: now })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = sign(rawBody, now);
    expect(
      verifyLumaSignature({ rawBody: rawBody + "x", signatureHeader: header, secret: SECRET, nowSec: now }),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const header = sign(rawBody, now, "whsec_other");
    expect(verifyLumaSignature({ rawBody, signatureHeader: header, secret: SECRET, nowSec: now })).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance", () => {
    const header = sign(rawBody, now - 10_000);
    expect(
      verifyLumaSignature({ rawBody, signatureHeader: header, secret: SECRET, nowSec: now, toleranceSec: 300 }),
    ).toBe(false);
  });

  it("rejects missing/garbage headers", () => {
    expect(verifyLumaSignature({ rawBody, signatureHeader: null, secret: SECRET, nowSec: now })).toBe(false);
    expect(verifyLumaSignature({ rawBody, signatureHeader: "nonsense", secret: SECRET, nowSec: now })).toBe(false);
  });
});

function guest(partial: Partial<LumaGuestData> = {}): LumaGuestData {
  return {
    id: "gst-1",
    user_email: "a@b.com",
    event: { id: "evt-1", timezone: "America/Los_Angeles" },
    ...partial,
  };
}

describe("normalizeGuest", () => {
  it("prefers user_name, falls back to first+last, then email", () => {
    expect(normalizeGuest(guest({ user_name: "Full Name" })).guestName).toBe("Full Name");
    expect(
      normalizeGuest(guest({ user_first_name: "Jane", user_last_name: "Doe" })).guestName,
    ).toBe("Jane Doe");
    expect(normalizeGuest(guest()).guestName).toBe("a@b.com");
  });

  it("maps company/role/challenge/slot from registration answers", () => {
    const g = guest({
      registration_answers: [
        { label: "Where do you work?", question_id: "q1", question_type: "company", value: { company: "Notion", job_title: "Designer" } },
        { label: "What challenge do you need help with?", question_id: "q2", question_type: "long-text", value: "Scaling my team" },
        { label: "Requested time slot", question_id: "q3", question_type: "dropdown", value: "2:00–2:30 PM" },
      ],
    });
    const n = normalizeGuest(g);
    expect(n.company).toBe("Notion");
    expect(n.role).toBe("Designer");
    expect(n.challenge).toBe("Scaling my team");
    expect(n.requestedSlotLabel).toBe("2:00–2:30 PM");
    expect(n.lumaEventId).toBe("evt-1");
    expect(n.lumaGuestId).toBe("gst-1");
  });

  it("handles null registration_answers", () => {
    const n = normalizeGuest(guest({ registration_answers: null }));
    expect(n.company).toBeNull();
    expect(n.challenge).toBeNull();
  });

  it("exposes approvalStatus", () => {
    expect(normalizeGuest(guest({ approval_status: "approved" })).approvalStatus).toBe("approved");
    expect(normalizeGuest(guest()).approvalStatus).toBeNull();
  });
});

describe("isCheckedIn (per-ticket)", () => {
  it("is true when any ticket has checked_in_at", () => {
    expect(isCheckedIn(guest({ event_tickets: [{ checked_in_at: null }, { checked_in_at: "2026-08-15T21:05:00Z" }] }))).toBe(true);
  });
  it("is false when no ticket is checked in", () => {
    expect(isCheckedIn(guest({ event_tickets: [{ checked_in_at: null }] }))).toBe(false);
    expect(isCheckedIn(guest({ event_tickets: null }))).toBe(false);
  });
});

describe("answerToString", () => {
  it("handles string, array, boolean, and company object", () => {
    expect(answerToString({ label: "", question_id: "", question_type: "text", value: " hi " })).toBe("hi");
    expect(answerToString({ label: "", question_id: "", question_type: "multi-select", value: ["a", "b"] })).toBe("a, b");
    expect(answerToString({ label: "", question_id: "", question_type: "agree-check", value: true })).toBe("true");
    expect(answerToString({ label: "", question_id: "", question_type: "company", value: { company: "Acme" } })).toBe("Acme");
    expect(answerToString({ label: "", question_id: "", question_type: "text", value: null })).toBeNull();
  });
});
