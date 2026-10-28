import { describe, expect, it } from "vitest";
import type { HomeAssistant, ImageMap, SkyConfig, SkyTheme } from "../src/types";
import { activeTheme, canvasSize, dateInZone, imageCondition, resolveScene, seededRandom, themeRunsOn, weatherEffect } from "../src/renderer/model";
import { AnimationRuntime } from "../src/renderer/runtime";

const images = (prefix: string): ImageMap => ({
  clear_day: `${prefix}_clear_day`, clear_night: `${prefix}_clear_night`,
  rain_day: `${prefix}_rain_day`, rain_night: `${prefix}_rain_night`,
  frost_day: `${prefix}_frost_day`, frost_night: `${prefix}_frost_night`,
  snow_day: `${prefix}_snow_day`, snow_night: `${prefix}_snow_night`,
});
const defaultTheme: SkyTheme = { id: "default", name: "Default", enabled: true, schedule: null, images: images("default") };
const christmas: SkyTheme = { id: "christmas", name: "Christmas", enabled: true, schedule: { start: "12-01", end: "01-05", annual: true }, images: images("christmas") };
const config = (): SkyConfig => ({ revision: 1, weatherEntity: "weather.met_office", frostEntity: "input_boolean.frost_warning", applyToAll: false, dashboards: ["dashboard-overview"], priority: ["christmas"], quality: "medium", lightning: false, themes: [defaultTheme, christmas] });
const hass = (condition: string, sun = "above_horizon", frost = "off"): HomeAssistant => ({
  config: { time_zone: "Europe/London" },
  states: { "weather.met_office": { state: condition, attributes: {} }, "sun.sun": { state: sun, attributes: {} }, "input_boolean.frost_warning": { state: frost, attributes: {} } },
  callWS: async <T>() => undefined as T, fetchWithAuth: async () => new Response(),
});

describe("seasonal theme scheduling", () => {
  it.each([ ["2026-11-30", false], ["2026-12-01", true], ["2026-12-31", true], ["2027-01-01", true], ["2027-01-05", true], ["2027-01-06", false] ])("Christmas %s = %s", (day, expected) => {
    expect(themeRunsOn(christmas, day as string)).toBe(expected);
  });
  it("uses installation timezone rather than browser timezone at midnight and DST", () => {
    expect(dateInZone(new Date("2026-06-01T23:30:00Z"), "Europe/London")).toBe("2026-06-02");
    expect(dateInZone(new Date("2026-10-25T00:30:00Z"), "Europe/London")).toBe("2026-10-25");
  });
  it("uses explicit priority and disabled themes never override Default", () => {
    const c = config();
    c.themes.push({ ...christmas, id: "custom_party", name: "Party" });
    c.priority = ["custom_party", "christmas"];
    expect(activeTheme(c, new Date("2026-12-03T12:00Z"), "Europe/London")?.id).toBe("custom_party");
    c.themes = c.themes.map((theme) => ({ ...theme, enabled: false }));
    expect(activeTheme(c, new Date("2026-12-03T12:00Z"), "Europe/London")?.id).toBe("default");
  });
  it("rejects invalid dates and handles inclusive one-off schedules", () => {
    expect(themeRunsOn({ ...christmas, schedule: { start: "02-30", end: "03-01", annual: true } }, "2026-03-01")).toBe(false);
    expect(themeRunsOn({ ...christmas, schedule: { start: "2026-12-01", end: "2027-01-05", annual: false } }, "2027-01-05")).toBe(true);
    expect(themeRunsOn({ ...christmas, schedule: { start: "2026-12-01", end: "2027-01-05", annual: false } }, "2027-12-01")).toBe(false);
  });
});

describe("weather image and animation independence", () => {
  it.each([ ["rainy", "rain"], ["pouring", "rain"], ["lightning-rainy", "rain"], ["snowy", "snow"], ["snowy-rainy", "snow"], ["hail", "snow"] ])("%s precipitation overrides frost", (condition, slot) => {
    expect(imageCondition(condition, true)).toBe(slot);
  });
  it("fog and cloud share the clear house image, but retain their own animation", () => {
    expect(imageCondition("fog", false)).toBe("clear");
    expect(imageCondition("cloudy", false)).toBe("clear");
    expect(weatherEffect("fog")).toBe("fog");
    expect(weatherEffect("cloudy")).toBe("cloudy");
  });
  it("sun.sun controls image day/night and missing weather is neutral", () => {
    const result = resolveScene(config(), hass("unavailable", "below_horizon"), new Date("2026-06-01T12:00Z"));
    expect(result.period).toBe("night");
    expect(result.effect).toBe("unknown");
    expect(result.imageId).toBe("default_clear_night");
    expect(resolveScene(config(), hass("clear-night"), new Date("2026-06-01T12:00Z")).period).toBe("day");
  });
  it("empty seasonal slot falls back to matching Default, then no image", () => {
    const c = config();
    c.themes = c.themes.map((t) => ({ ...t, images: { ...t.images } }));
    c.themes[1].images.rain_night = null;
    const current = hass("rainy", "below_horizon");
    const date = new Date("2026-12-23T23:00Z");
    expect(resolveScene(c, current, date).imageId).toBe("default_rain_night");
    c.themes[0].images.rain_night = null;
    expect(resolveScene(c, current, date).imageId).toBeNull();
  });
});

describe("render budgets and deterministic clock", () => {
  it("caps high-DPI 4K backing buffers and handles degenerate layout sizes", () => {
    for (const [quality, budget] of [["low", 900000], ["medium", 1800000], ["high", 3000000]] as const) {
      const size = canvasSize(3840, 2160, 4, quality);
      expect(size.width * size.height).toBeLessThanOrEqual(budget);
      expect(size.scale).toBeLessThan(1);
    }
    expect(canvasSize(0, NaN, Infinity, "low")).toEqual({ width: 1, height: 1, scale: 1 });
  });
  it("seeded draws repeat and returning from a hidden tab cannot jump a long interval", () => {
    const a = seededRandom(42), b = seededRandom(42);
    expect(Array.from({ length: 20 }, a)).toEqual(Array.from({ length: 20 }, b));
    const clock = new AnimationRuntime(42);
    clock.advance(3600, new Date(10));
    expect(clock.time).toBe(1.1);
    clock.advance(-10, new Date(20));
    expect(clock.time).toBe(1.1);
  });
});
