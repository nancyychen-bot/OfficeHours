import { describe, it, expect } from "vitest";
import { lifecycleAction } from "@/lib/events/lifecycle";

describe("lifecycleAction", () => {
  it("approved -> create", () => expect(lifecycleAction("approved")).toBe("create"));
  it("declined -> cancel", () => expect(lifecycleAction("declined")).toBe("cancel"));
  it("pending_approval -> ignore", () => expect(lifecycleAction("pending_approval")).toBe("ignore"));
  it("waitlist -> ignore", () => expect(lifecycleAction("waitlist")).toBe("ignore"));
  it("invited -> ignore", () => expect(lifecycleAction("invited")).toBe("ignore"));
  it("null/unknown -> ignore", () => {
    expect(lifecycleAction(null)).toBe("ignore");
    expect(lifecycleAction("something_new")).toBe("ignore");
  });
});
