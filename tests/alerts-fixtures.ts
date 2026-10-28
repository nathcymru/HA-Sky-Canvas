import type { HassEntity } from "../src/types";

export const ALERT_NOW = Date.parse("2026-10-28T12:00:00Z");
export const weatherWarning = (level = "yellow", id = "demo-weather") => ({
  id, version: "1", level, headline: "DEMO · Heavy rain may cause travel disruption", weather_types: ["Rain"],
  valid_from: "2026-10-28T09:00:00Z", valid_to: "2026-10-28T18:00:00Z", issued: "2026-10-28T08:00:00Z",
  active: true, areas: ["Demo region"], filter_method: "polygon", what_to_do: ["Read the official advice before travelling."],
  what_to_expect: ["Synthetic warning for layout testing only."], details: "This is a local demonstration, not a live warning.",
});
export function weatherEntity(level = "yellow"): HassEntity {
  return { state: level, attributes: { fetched_at: new Date(ALERT_NOW).toISOString(), warnings: level === "none" ? [] : [weatherWarning(level)] } };
}
export const floodWarning = (severity = 3, id = "demo-flood") => ({
  id, area_code: "DEMO001", area_name: "DEMO · Example river and surrounding land", severity_code: severity,
  raised: "2026-10-26T10:00:00Z", severity_changed: "2026-10-26T10:00:00Z", message_changed: "2026-10-27T17:00:00Z",
  message_english: "This is a local demonstration, not a live flood warning.", message_welsh: "",
});
export function floodEntity(severity = 3): HassEntity {
  return { state: ["none", "severe_flood_warning", "flood_warning", "flood_alert"][severity], attributes: {
    fetched_at: new Date(ALERT_NOW).toISOString(), stale_after_seconds: 1800,
    scope: { type: "area_codes", label: "Selected demo flood areas", area_codes: ["DEMO001"] },
    warnings: severity === 0 ? [] : [floodWarning(severity)], cleared_warnings: [],
  } };
}
