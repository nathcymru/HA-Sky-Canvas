import { describe, expect, it } from "vitest";
import type { HassEntity } from "../src/types";
import { SYMBOL_LABELS, currentWeather, dayKey, displayTime, forecastPeriods, measurement, timestamp, weatherStatus, weatherSymbol, weatherUnits, windDirection } from "../src/weather/model";

const now = Date.parse("2026-10-28T12:30:00Z");
const entity = (): HassEntity => ({ state: "rainy", attributes: {
  current_time: "2026-10-28T12:00:00Z", fetched_at: "2026-10-28T12:20:00Z", model_run: "2026-10-28T10:00:00Z",
  metoffice_weather_code: 11, temperature: 0, temperature_unit: "°C", wind_speed: 0, wind_speed_unit: "km/h",
  wind_gust_speed: 0, precipitation_probability: 0, uv_index: 0,
} });

describe("official forecast symbols", () => {
  it("preserves all 30 published code variants and never guesses from a generic condition", () => {
    expect(Object.keys(SYMBOL_LABELS)).toHaveLength(30);
    expect(weatherSymbol(0)?.label).toBe("Clear night");
    expect(weatherSymbol(3)?.label).toBe("Sunny intervals");
    expect(weatherSymbol(11)?.label).toBe("Drizzle");
    expect(weatherSymbol(8)?.label).toBe("Overcast");
    expect(weatherSymbol(25)?.label).toBe("Heavy snow shower (night)");
    for (const value of [4, -1, 31, 2.1, "12", "rainy", true, null, NaN, Infinity, "https://example.test/icon.svg"]) expect(weatherSymbol(value)).toBeNull();
  });

});

describe("weather normalization", () => {
  it("keeps zero measurements while rejecting missing, nonnumeric or invalid values", () => {
    const item = currentWeather(entity(), now)!;
    expect(item.symbol?.label).toBe("Drizzle");
    expect([item.temperature, item.wind, item.gust, item.probability, item.uv]).toEqual([0, 0, 0, 0, 0]);
    expect(item.humidity).toBeNull();
    const bad = entity(); Object.assign(bad.attributes, { wind_speed: -1, temperature: "0", precipitation_probability: 101, uv_index: false });
    const invalid = currentWeather(bad, now)!;
    expect([invalid.wind, invalid.temperature, invalid.probability, invalid.uv]).toEqual([null, null, null, null]);
    expect(measurement(0, "°C")).toBe("0°C");
    expect(measurement(null, "%")).toBe("—");
    expect(measurement(12, null)).toBe("—");
    expect(measurement(1.27, "mm")).toBe("1.3 mm");
  });
  it("uses HA's converted units without relabelling or converting them twice", () => {
    const item = entity(); Object.assign(item.attributes, { temperature: 32, temperature_unit: "°F", wind_speed: 5, wind_speed_unit: "mph", precipitation_unit: "in" });
    const units = weatherUnits(item);
    expect(measurement(currentWeather(item, now)!.temperature, units.temperature)).toBe("32°F");
    expect(measurement(currentWeather(item, now)!.wind, units.wind)).toBe("5 mph");
    item.attributes.wind_speed_unit = "unknown";
    expect(weatherUnits(item).wind).toBeNull();
    expect([windDirection(0), windDirection(90), windDirection(360)]).toEqual(["N", "E", "N"]);
  });
  it("withdraws stale, future, missing-timestamp and unavailable current data", () => {
    expect(weatherStatus(entity(), now)).toBe("ready");
    for (const key of ["fetched_at", "model_run", "current_time"]) {
      const item = entity(); delete item.attributes[key]; expect(currentWeather(item, now)).toBeNull();
      item.attributes[key] = "2026-10-28T14:00:00Z"; expect(currentWeather(item, now)).toBeNull();
    }
    const old = entity(); old.attributes.model_run = "2026-10-28T06:30:00Z";
    expect(weatherStatus(old, now)).toBe("stale");
    old.state = "unavailable"; expect(weatherStatus(old, now)).toBe("unavailable");
  });
  it("retains exact day/night codes and supplied measurements for each forecast period", () => {
    const daily = forecastPeriods([{ datetime: "2026-10-28T00:00:00Z", metoffice_weather_code: 10, metoffice_night_weather_code: 25, temperature: 12, templow: -2, precipitation_probability: 0 }], "daily", "Europe/London", now)!;
    expect(daily[0].symbol?.label).toBe("Light rain shower (day)");
    expect(daily[0].nightSymbol?.label).toBe("Heavy snow shower (night)");
    expect(daily[0].low).toBe(-2);
    expect(daily[0].probability).toBe(0);
    expect(daily[0].gust).toBeNull();
    const hourly = forecastPeriods([{ datetime: "2026-10-28T12:00:00Z", metoffice_weather_code: 2 }, { datetime: "2026-10-28T11:00:00Z", metoffice_weather_code: 1 }], "hourly", "Europe/London", now)!;
    expect(hourly).toHaveLength(1);
    expect(hourly[0].symbol?.code).toBe(2);
  });
  it("uses daily provenance independently and never borrows current freshness", () => {
    const daily = entity();
    expect(weatherStatus(daily, now, "daily")).toBe("stale");
    Object.assign(daily.attributes, { metoffice_daily_fetched_at: "2026-10-28T08:00:00Z", metoffice_daily_model_run: "2026-10-28T07:00:00Z" });
    expect(weatherStatus(daily, now, "daily")).toBe("ready");
    daily.attributes.metoffice_daily_model_run = "2026-10-28T06:30:00Z";
    expect(weatherStatus(daily, now, "daily")).toBe("stale");
    expect(weatherStatus(daily, now)).toBe("ready");
  });
  it("rejects malformed timestamps and duplicate rows; empty/null forecasts stay unavailable", () => {
    for (const value of ["2026-02-30T12:00:00Z", "2026-10-28T25:00:00Z", "2026-10-28T12:00:00", "yesterday"]) expect(timestamp(value)).toBeNull();
    const row = { datetime: "2026-10-28T12:00:00Z", temperature: 8 };
    for (const payload of [null, [], [row, row], [row, {}], [null], Array(257).fill(row)]) expect(forecastPeriods(payload, "hourly", "Europe/London", now)).toBeNull();
    expect(forecastPeriods([row, { datetime: "2026-10-28T18:00:00Z" }], "daily", "Europe/London", now)).toBeNull();
  });
  it("formats dates in the installation timezone across DST, rather than the device timezone", () => {
    expect(dayKey(Date.parse("2026-06-01T23:30:00Z"), "Europe/London")).toBe("2026-06-02");
    expect(displayTime(Date.parse("2026-10-25T00:30:00Z"), "Europe/London")).toContain("BST");
    expect(displayTime(Date.parse("2026-10-25T01:30:00Z"), "Europe/London")).toContain("GMT");
  });
});
