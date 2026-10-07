import { describe, expect, it } from "vitest";
import { formatDuration } from "@/app/(app)/status";

describe("formatDuration", () => {
  it("adapte l'unité", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(4200)).toBe("4,2 s");
    expect(formatDuration(65_000)).toBe("1 min 05 s");
    expect(formatDuration(3_720_000)).toBe("1 h 02 min");
  });
});
