import { describe, it, expect } from "vitest";
import {
  normalizeStyle,
  normalizeRisk,
  normalizeHold,
  adjustDriftLevel,
  driftToneHint,
  hasProfile,
  STYLE_OPTIONS,
  RISK_OPTIONS,
  STYLE_LABEL,
} from "./investor-profile";

describe("normalizers", () => {
  it("accept valid, reject junk", () => {
    expect(normalizeStyle("value")).toBe("value");
    expect(normalizeStyle("x")).toBe(null);
    expect(normalizeRisk("aggressive")).toBe("aggressive");
    expect(normalizeRisk(null)).toBe(null);
    expect(normalizeHold("swing")).toBe("swing");
    expect(normalizeHold("forever")).toBe(null);
  });
  it("options are consistent with labels", () => {
    for (const o of STYLE_OPTIONS) expect(STYLE_LABEL[o.value]).toBe(o.label);
    expect(RISK_OPTIONS).toHaveLength(3);
  });
});

describe("adjustDriftLevel (profile feeds back into drift)", () => {
  it("aggressive escalates any challenge to strong", () => {
    expect(adjustDriftLevel("soft", "aggressive")).toBe("strong");
    expect(adjustDriftLevel("strong", "aggressive")).toBe("strong");
  });
  it("conservative softens strong to soft", () => {
    expect(adjustDriftLevel("strong", "conservative")).toBe("soft");
    expect(adjustDriftLevel("soft", "conservative")).toBe("soft");
  });
  it("balanced / unknown leaves level unchanged; none always none", () => {
    expect(adjustDriftLevel("strong", "balanced")).toBe("strong");
    expect(adjustDriftLevel("soft", null)).toBe("soft");
    expect(adjustDriftLevel("none", "aggressive")).toBe("none");
  });
});

describe("driftToneHint", () => {
  it("varies by risk, empty for balanced/unknown", () => {
    expect(driftToneHint("aggressive")).toContain("直接");
    expect(driftToneHint("conservative")).toContain("温和");
    expect(driftToneHint("balanced")).toBe("");
    expect(driftToneHint(null)).toBe("");
  });
});

describe("hasProfile", () => {
  it("true when style or risk set", () => {
    expect(hasProfile({ style: "value" })).toBe(true);
    expect(hasProfile({ riskLevel: "balanced" })).toBe(true);
    expect(hasProfile({ style: null, riskLevel: null })).toBe(false);
    expect(hasProfile({ style: "junk" })).toBe(false);
  });
});
