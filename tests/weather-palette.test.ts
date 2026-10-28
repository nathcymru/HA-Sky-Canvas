import { describe, expect, it } from "vitest";
import { TEMPERATURE_COLOURS, colourBand, strongGust, temperatureBand, uvBand } from "../src/weather/palette";

const luminance = (hex: string): number => {
  const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
};

describe("published Met Office colour bands", () => {
  it("keeps the published Celsius palette and selects equivalent Fahrenheit/Kelvin colours", () => {
    expect(TEMPERATURE_COLOURS).toHaveLength(60);
    expect(temperatureBand(-19, "°C")?.background).toBe("#132d7c");
    expect(temperatureBand(0, "°C")?.background).toBe("#f5f6fa");
    expect(temperatureBand(10, "°C")?.background).toBe("#ffd765");
    expect(temperatureBand(35, "°C")?.background).toBe("#de2e33");
    expect(temperatureBand(40, "°C")?.background).toBe("#c30031");
    expect(temperatureBand(50, "°F")).toEqual(temperatureBand(10, "°C"));
    expect(temperatureBand(273.15, "K")).toEqual(temperatureBand(0, "°C"));
    expect(temperatureBand(100, "°C")).toEqual(temperatureBand(40, "°C"));
    expect(temperatureBand(-50, "°C")).toEqual(temperatureBand(-19, "°C"));
    expect(temperatureBand(null, "°C")).toBeNull();
    expect(temperatureBand(NaN, "°C")).toBeNull();
    expect(temperatureBand(10, "unknown")).toBeNull();
  });
  it("labels the published UV categories and distinguishes missing UV from zero", () => {
    expect(uvBand(null)).toBeNull();
    expect(uvBand(-1)).toBeNull();
    expect(uvBand(0)?.label).toBe("No significant UV");
    expect([1, 2].map(value => uvBand(value)?.background)).toEqual(["#71b466", "#71b466"]);
    expect([3, 5].map(value => uvBand(value)?.label)).toEqual(["Moderate", "Moderate"]);
    expect(uvBand(3)?.background).toBe("#f8e71c");
    expect(uvBand(6)?.background).toBe("#ff950c");
    expect(uvBand(8)?.background).toBe("#d72921");
    expect(uvBand(11)?.background).toBe("#6600e0");
    expect(uvBand(11)?.label).toBe("Extreme");
  });
  it("measures at least 4.5:1 contrast for every numeric band without changing backgrounds", () => {
    const bands = [...TEMPERATURE_COLOURS.map(colourBand), ...[0, 1, 3, 6, 8, 11].map(value => uvBand(value)!)];
    for (const band of bands) {
      const values = [luminance(band.background), luminance(band.foreground)].sort((a, b) => b - a);
      expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("emphasizes gusts at the documented threshold in every supported HA wind unit", () => {
    for (const [unit, threshold] of [["kn", 25], ["mph", 29], ["km/h", 46.3], ["m/s", 25 * 1852 / 3600], ["ft/s", 25 * 1852 / 3600 / 0.3048]] as const) {
      expect(strongGust(threshold, unit)).toBe(true);
      expect(strongGust(threshold - 0.01, unit)).toBe(false);
    }
    expect(strongGust(null, "mph")).toBe(false);
    expect(strongGust(30, "unknown")).toBe(false);
  });
});
