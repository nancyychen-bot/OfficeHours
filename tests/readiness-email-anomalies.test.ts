import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmail = vi.fn(async () => ({ id: "e1" }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: (...a: any[]) => (sendEmail as any)(...a) }));

import { emailFormAnomalies } from "@/lib/readiness/email";

describe("emailFormAnomalies", () => {
  beforeEach(() => {
    sendEmail.mockClear();
    process.env.READINESS_ALERT_EMAILS = "ops@x.com";
  });

  it("sends one email per recipient with the anomalies + questions in the body", async () => {
    const sent = await emailFormAnomalies(
      { name: "Build Bar Seoul", lumaEventId: "evt-abc" },
      [{ id: "q1", type: "company", label: "회사" }, { id: "q2", type: "text", label: "이메일" }],
      ["expected 2 free-text questions (email + 1:1 help), found 1"],
      "https://hub.test",
    );
    expect(sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const calls = sendEmail.mock.calls as unknown as Array<[{ to: string; subject: string; text: string; html: string }]>;
    const arg = calls[0][0];
    expect(arg.to).toBe("ops@x.com");
    expect(arg.subject).toMatch(/Seoul/);
    expect(arg.text).toMatch(/expected 2 free-text/);
    expect(arg.text).toMatch(/회사/);
  });

  it("sends nothing when there are no anomalies", async () => {
    const sent = await emailFormAnomalies({ name: "X", lumaEventId: "evt-x" }, [], [], "https://hub.test");
    expect(sent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
