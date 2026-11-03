import { describe, expect, it } from "vitest";
import { initialWeightUnit, kilogramsToPounds, poundsToKilograms, roundWeightForDisplay } from "./weight";
import { parseWeightInput } from "../validation/domain";

describe("weight calculations", () => {
  it("round trips kg and lb without rounding canonical kilograms", () => {
    const kilograms = 72.345_678;
    expect(poundsToKilograms(kilogramsToPounds(kilograms))).toBeCloseTo(kilograms, 10);
    expect(roundWeightForDisplay(kilograms)).toBe(72.3);
  });

  it("uses deterministic locale-derived initial units", () => {
    expect(initialWeightUnit("en-US")).toBe("lb");
    expect(initialWeightUnit("en-GB")).toBe("kg");
    expect(initialWeightUnit("fr-FR")).toBe("kg");
  });

  it("rejects empty, malformed, infinite, non-positive, and implausibly large input", () => {
    expect(parseWeightInput("", "kg")).toMatchObject({ ok: false, code: "weight_empty" });
    expect(parseWeightInput("12kg", "kg")).toMatchObject({ ok: false, code: "weight_malformed" });
    expect(parseWeightInput("Infinity", "kg")).toMatchObject({ ok: false });
    expect(parseWeightInput("0", "kg")).toMatchObject({ ok: false, code: "weight_not_positive" });
    expect(parseWeightInput("1001", "kg")).toMatchObject({ ok: false, code: "weight_too_large" });
    expect(parseWeightInput("220", "lb")).toMatchObject({ ok: true });
  });
});
