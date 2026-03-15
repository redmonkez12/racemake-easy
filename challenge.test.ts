import { describe, expect, test } from "bun:test";
import {
  analyzeLap,
  analyzeStint,
  detectIssue,
  driverLap,
  driverLap2,
  generateCoaching,
  generateStintCoaching,
  referenceLap,
} from "./challenge";

const config = { coachVoice: "generic" as const, units: "metric" as const };
const pitgptConfig = { coachVoice: "pitgpt" as const, units: "metric" as const };

// ============================================================
// detectIssue — all four branches
// ============================================================

describe("detectIssue — early_lift", () => {
  test("detects early_lift when throttleTrace.earlyLift is true", () => {
    const sector = {
      time: 42.0,
      delta: +0.5,
      brakingPoints: [
        { turn: "T1", brakeMarker: 90, trailBraking: true, lockup: false, tcActive: false },
      ],
      tyreData: { avgSlip: 0.03, peakSlip: 0.06, avgTemp: { fl: 94, fr: 97, rl: 91, rr: 92 } },
      throttleTrace: { earlyLift: true, smoothApplication: true, fullThrottlePercent: 0.71 },
    };
    const ref = {
      time: 41.5,
      brakingPoints: [{ turn: "T1", brakeMarker: 92, trailBraking: true }],
    };
    const { issue, details } = detectIssue(sector, ref);
    expect(issue).toBe("early_lift");
    expect(details).toContain("71%");
  });

  test("early_lift takes priority over traction_loss conditions", () => {
    // Sector has earlyLift AND TC + high slip + low throttle — early_lift wins
    const sector = {
      time: 50.0,
      delta: +1.5,
      brakingPoints: [
        { turn: "T6", brakeMarker: 56, trailBraking: false, lockup: false, tcActive: true },
      ],
      tyreData: { avgSlip: 0.06, peakSlip: 0.15, avgTemp: { fl: 101, fr: 104, rl: 97, rr: 99 } },
      throttleTrace: { earlyLift: true, smoothApplication: false, fullThrottlePercent: 0.5 },
    };
    const ref = {
      time: 48.5,
      brakingPoints: [{ turn: "T6", brakeMarker: 68, trailBraking: true }],
    };
    const { issue } = detectIssue(sector, ref);
    expect(issue).toBe("early_lift");
  });
});

describe("detectIssue — traction_loss conditions", () => {
  test("detects traction_loss when TC active + high slip + low throttle", () => {
    const { issue } = detectIssue(driverLap.sectors.s2, referenceLap.sectors.s2);
    expect(issue).toBe("traction_loss");
  });

  test("does NOT detect traction_loss when peakSlip is below threshold", () => {
    const sector = {
      time: 50.0,
      delta: +1.0,
      brakingPoints: [
        { turn: "T6", brakeMarker: 56, trailBraking: false, lockup: false, tcActive: true },
      ],
      tyreData: { avgSlip: 0.03, peakSlip: 0.08, avgTemp: { fl: 101, fr: 104, rl: 97, rr: 99 } },
      throttleTrace: { earlyLift: false, smoothApplication: false, fullThrottlePercent: 0.5 },
    };
    const ref = {
      time: 48.5,
      brakingPoints: [{ turn: "T6", brakeMarker: 68, trailBraking: true }],
    };
    const { issue } = detectIssue(sector, ref);
    expect(issue).not.toBe("traction_loss");
  });

  test("does NOT detect traction_loss when throttle is above 70%", () => {
    const sector = {
      time: 50.0,
      delta: +1.0,
      brakingPoints: [
        { turn: "T6", brakeMarker: 56, trailBraking: false, lockup: false, tcActive: true },
      ],
      tyreData: { avgSlip: 0.06, peakSlip: 0.15, avgTemp: { fl: 101, fr: 104, rl: 97, rr: 99 } },
      throttleTrace: { earlyLift: false, smoothApplication: true, fullThrottlePercent: 0.75 },
    };
    const ref = {
      time: 48.5,
      brakingPoints: [{ turn: "T6", brakeMarker: 68, trailBraking: true }],
    };
    const { issue } = detectIssue(sector, ref);
    expect(issue).not.toBe("traction_loss");
  });
});

describe("detectIssue — late_braking", () => {
  test("detects late_braking when driver brakes >8m later than reference", () => {
    const sector = {
      time: 42.0,
      delta: +0.4,
      brakingPoints: [
        { turn: "T1 La Source", brakeMarker: 80, trailBraking: true, lockup: false, tcActive: false },
      ],
      tyreData: { avgSlip: 0.03, peakSlip: 0.06, avgTemp: { fl: 94, fr: 97, rl: 91, rr: 92 } },
      throttleTrace: { earlyLift: false, smoothApplication: true, fullThrottlePercent: 0.8 },
    };
    const ref = {
      time: 41.5,
      brakingPoints: [{ turn: "T1 La Source", brakeMarker: 92, trailBraking: true }],
    };
    const { issue, details } = detectIssue(sector, ref);
    expect(issue).toBe("late_braking");
    expect(details).toContain("80m");
    expect(details).toContain("92m");
  });

  test("within 8m does NOT trigger specific late_braking (falls to default)", () => {
    const sector = {
      time: 42.0,
      delta: +0.3,
      brakingPoints: [
        { turn: "T1", brakeMarker: 85, trailBraking: true, lockup: false, tcActive: false },
      ],
      tyreData: { avgSlip: 0.03, peakSlip: 0.06, avgTemp: { fl: 94, fr: 97, rl: 91, rr: 92 } },
      throttleTrace: { earlyLift: false, smoothApplication: true, fullThrottlePercent: 0.8 },
    };
    const ref = {
      time: 41.5,
      brakingPoints: [{ turn: "T1", brakeMarker: 92, trailBraking: true }],
    };
    const { issue, details } = detectIssue(sector, ref);
    // Falls to default — still late_braking but with generic details
    expect(issue).toBe("late_braking");
    expect(details).toContain("No single clear cause");
  });
});

describe("detectIssue — overcorrection", () => {
  test("detects overcorrection when avgSlip > 0.05 without TC", () => {
    const sector = {
      time: 44.0,
      delta: +0.5,
      brakingPoints: [
        { turn: "T14", brakeMarker: 54, trailBraking: true, lockup: false, tcActive: false },
      ],
      tyreData: { avgSlip: 0.065, peakSlip: 0.09, avgTemp: { fl: 93, fr: 96, rl: 90, rr: 91 } },
      throttleTrace: { earlyLift: false, smoothApplication: true, fullThrottlePercent: 0.8 },
    };
    const ref = {
      time: 43.5,
      brakingPoints: [{ turn: "T14", brakeMarker: 55, trailBraking: true }],
    };
    const { issue, details } = detectIssue(sector, ref);
    expect(issue).toBe("overcorrection");
    expect(details).toContain("0.065");
  });

  test("does NOT detect overcorrection when TC is active (falls to traction_loss path)", () => {
    const sector = {
      time: 44.0,
      delta: +0.5,
      brakingPoints: [
        { turn: "T14", brakeMarker: 54, trailBraking: true, lockup: false, tcActive: true },
      ],
      tyreData: { avgSlip: 0.065, peakSlip: 0.15, avgTemp: { fl: 93, fr: 96, rl: 90, rr: 91 } },
      throttleTrace: { earlyLift: false, smoothApplication: true, fullThrottlePercent: 0.6 },
    };
    const ref = {
      time: 43.5,
      brakingPoints: [{ turn: "T14", brakeMarker: 55, trailBraking: true }],
    };
    const { issue } = detectIssue(sector, ref);
    expect(issue).not.toBe("overcorrection");
  });
});

describe("detectIssue — default fallback", () => {
  test("returns late_braking as default when no specific condition matches", () => {
    const sector = {
      time: 42.0,
      delta: +0.2,
      brakingPoints: [
        { turn: "T1", brakeMarker: 90, trailBraking: true, lockup: false, tcActive: false },
      ],
      tyreData: { avgSlip: 0.03, peakSlip: 0.06, avgTemp: { fl: 94, fr: 97, rl: 91, rr: 92 } },
      throttleTrace: { earlyLift: false, smoothApplication: true, fullThrottlePercent: 0.8 },
    };
    const ref = {
      time: 41.8,
      brakingPoints: [{ turn: "T1", brakeMarker: 92, trailBraking: true }],
    };
    const { issue, details } = detectIssue(sector, ref);
    expect(issue).toBe("late_braking");
    expect(details).toContain("No single clear cause");
  });
});

// ============================================================
// analyzeLap
// ============================================================

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

  test("returns all 3 sectors", () => {
    expect(analysis.findings).toHaveLength(3);
  });

  test("totalDelta sums all sector deltas", () => {
    const expectedTotal = 0.387 + 1.198 + 0.07;
    expect(Math.abs(analysis.totalDelta - expectedTotal)).toBeLessThan(0.001);
  });
});

describe("analyzeLap — driverLap2", () => {
  const analysis = analyzeLap(referenceLap, driverLap2);

  test("worst sector is s2 with delta 2.316", () => {
    expect(analysis.findings[0].sectorKey).toBe("s2");
    expect(Math.abs(analysis.findings[0].delta - 2.316)).toBeLessThan(0.001);
  });

  test("s1 has early_lift (degraded tyres, driver lifting)", () => {
    const s1 = analysis.findings.find((f) => f.sectorKey === "s1");
    expect(s1?.issue).toBe("early_lift");
  });

  test("s2 has traction_loss", () => {
    const s2 = analysis.findings.find((f) => f.sectorKey === "s2");
    expect(s2?.issue).toBe("traction_loss");
  });
});

// ============================================================
// generateCoaching — message generation
// ============================================================

describe("generateCoaching — generic voice", () => {
  const analysis = analyzeLap(referenceLap, driverLap);
  const result = generateCoaching(analysis, config);

  test("message contains sector number and delta", () => {
    expect(result.coachingMessage).toContain("Sector 2");
    expect(result.coachingMessage).toContain("1.198");
  });

  test("traction_loss message recommends throttle reduction", () => {
    expect(result.coachingMessage).toContain("throttle");
  });
});

describe("generateCoaching — pitgpt voice", () => {
  const analysis = analyzeLap(referenceLap, driverLap);
  const result = generateCoaching(analysis, pitgptConfig);

  test("pitgpt message uses direct driver language", () => {
    expect(result.coachingMessage).toContain("Sector 2");
    expect(result.coachingMessage).toContain("1.198");
  });

  test("pitgpt traction_loss mentions TC and grip", () => {
    expect(result.coachingMessage).toContain("TC");
    expect(result.coachingMessage).toContain("grip");
  });
});

describe("generateCoaching — empty findings", () => {
  test("returns clean lap message when no findings", () => {
    const emptyAnalysis = { findings: [], totalDelta: 0 };
    const result = generateCoaching(emptyAnalysis, config);
    expect(result.problemSector).toBe(0);
    expect(result.coachingMessage).toContain("Clean lap");
  });
});

// ============================================================
// analyzeStint + generateStintCoaching
// ============================================================

describe("analyzeStint", () => {
  const stint = analyzeStint(referenceLap, [driverLap, driverLap2]);

  test("returns analysis for both laps", () => {
    expect(stint.laps).toHaveLength(2);
  });

  test("detects worsening traction_loss across stint", () => {
    expect(stint.stintSummary.worseningIssues).toContain("traction_loss");
  });

  test("generates patterns", () => {
    expect(stint.stintSummary.patterns.length).toBeGreaterThan(0);
  });

  test("lap2 s2 delta is worse than lap1 s2 delta", () => {
    const lap1s2 = stint.laps[0].findings.find((f) => f.sectorKey === "s2");
    const lap2s2 = stint.laps[1].findings.find((f) => f.sectorKey === "s2");
    expect(lap2s2!.delta).toBeGreaterThan(lap1s2!.delta);
  });

  test("detects issue change in s1 (late_braking → early_lift)", () => {
    const lap1s1 = stint.laps[0].findings.find((f) => f.sectorKey === "s1");
    const lap2s1 = stint.laps[1].findings.find((f) => f.sectorKey === "s1");
    expect(lap1s1!.issue).not.toBe(lap2s1!.issue);
    expect(lap2s1!.issue).toBe("early_lift");
  });
});

describe("generateStintCoaching — pitgpt", () => {
  const stint = analyzeStint(referenceLap, [driverLap, driverLap2]);
  const coaching = generateStintCoaching(stint.stintSummary, pitgptConfig);

  test("produces non-empty coaching string", () => {
    expect(coaching.length).toBeGreaterThan(20);
  });

  test("mentions tyre degradation", () => {
    expect(coaching.toLowerCase()).toContain("tyre");
  });
});

describe("generateStintCoaching — generic", () => {
  const stint = analyzeStint(referenceLap, [driverLap, driverLap2]);
  const coaching = generateStintCoaching(stint.stintSummary, config);

  test("starts with stint analysis prefix", () => {
    expect(coaching).toMatch(/^Stint analysis:/);
  });

  test("includes throttle recommendation for worsening traction_loss", () => {
    expect(coaching.toLowerCase()).toContain("throttle");
  });
});

describe("generateStintCoaching — no patterns", () => {
  const emptySummary = { patterns: [], worseningIssues: [] as string[], improvingIssues: [] as string[] };

  test("generic returns no-trend message", () => {
    const coaching = generateStintCoaching(emptySummary as any, config);
    expect(coaching).toContain("no significant cross-lap trend");
  });

  test("pitgpt returns flat trend message", () => {
    const coaching = generateStintCoaching(emptySummary as any, pitgptConfig);
    expect(coaching).toContain("flat");
  });
});
