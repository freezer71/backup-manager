import { describe, expect, it } from "vitest";
import { safeChildDir } from "@/lib/runner/storage";

describe("safeChildDir", () => {
  it("accepte un slug simple", () => {
    expect(safeChildDir("/data/backups", "pilote")).toBe("/data/backups/pilote");
  });
  it.each(["..", "a/../..", "", ".", "/etc", "/data/backups"])("refuse %j", (slug) => {
    expect(safeChildDir("/data/backups", slug)).toBeNull();
  });
});
