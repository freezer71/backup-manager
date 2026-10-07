import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/time";

const now = new Date("2026-10-05T12:00:00Z");

describe("relativeTime", () => {
  it("passé et futur, en français", () => {
    expect(relativeTime("2026-10-05T11:59:30Z", now)).toBe("à l'instant");
    expect(relativeTime("2026-10-05T11:57:00Z", now)).toBe("il y a 3 min");
    expect(relativeTime("2026-10-05T09:30:00Z", now)).toBe("il y a 2 h");
    expect(relativeTime("2026-10-01T12:00:00Z", now)).toBe("il y a 4 j");
    expect(relativeTime("2026-10-05T15:00:00Z", now)).toBe("dans 3 h");
    expect(relativeTime("2026-10-05T12:00:20Z", now)).toBe("dans moins d'une minute");
  });
});
