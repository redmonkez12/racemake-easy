import { describe, test, expect } from "bun:test";
import { analyzeLap, detectIssue, generateCoaching, referenceLap, driverLap } from "./challenge";

const config = { coachVoice: "generic" as const, units: "metric" as const };

describe("TOM-503 — analyzeLap sort order", () => {
  const analysis = analyzeLap(referenceLap, driverLap);
  const result = generateCoaching(analysis, config);

  test("findings[0] has the highest positive delta", () => {
    const deltas = analysis.findings.map((f) => f.delta);
    expect(analysis.findings[0].delta).toBe(Math.max(...deltas));
  });

  test("problemSector is 2", () => {
    expect(result.problemSector).toBe(2);
  });

  test("timeLost ≈ 1.198", () => {
    expect(Math.abs(result.timeLost - 1.198)).toBeLessThan(0.01);
  });

  test("issue for s2 is traction_loss", () => {
    const s2Finding = analysis.findings.find((f) => f.sectorKey === "s2");
    expect(s2Finding?.issue).toBe("traction_loss");
  });
});

describe("detectIssue — traction_loss conditions", () => {
  test("detects traction_loss when TC active + high slip + low throttle", () => {
    const { issue } = detectIssue(driverLap.sectors.s2, referenceLap.sectors.s2);
    expect(issue).toBe("traction_loss");
  });
});
