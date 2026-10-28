import { describe, expect, it } from "vitest";
import { alertFingerprint, alertTime, floodAlerts, FLOOD_URL, weatherAlerts, WEATHER_URL } from "../src/alerts/model";
import { ALERT_NOW, floodEntity, floodWarning, noMatchingFloodAreas, weatherEntity, weatherWarning } from "./alerts-fixtures";

describe("weather warning normalization", () => {
  it("preserves official levels and distinguishes issued upcoming warnings from active ones", () => {
    const entity = weatherEntity("red");
    entity.attributes.warnings = [weatherWarning("yellow", "active"), { ...weatherWarning("red", "future"), valid_from: "2026-10-28T15:00:00Z", active: true }];
    const feed = weatherAlerts(entity, ALERT_NOW);
    expect(feed.status).toBe("warnings");
    expect(feed.items.map(item => [item.id, item.severity, item.timing])).toEqual([["future", "red", "upcoming"], ["active", "yellow", "active"]]);
    expect(weatherAlerts(entity, ALERT_NOW + 2 * 60_000).items[0].timing).toBe("upcoming");
  });

  it("expires warnings locally without using an obsolete active flag", () => {
    const entity = weatherEntity();
    entity.attributes.warnings = [{ ...weatherWarning(), valid_to: "2026-10-28T12:09:00Z" }];
    expect(weatherAlerts(entity, ALERT_NOW + 9 * 60_000).status).toBe("clear");
  });

  it("distinguishes fresh empty, missing, failure, stale, and future fetch times", () => {
    expect(weatherAlerts(weatherEntity("none"), ALERT_NOW).status).toBe("clear");
    expect(weatherAlerts(undefined, ALERT_NOW).status).toBe("unavailable");
    expect(weatherAlerts({ ...weatherEntity(), state: "unavailable" }, ALERT_NOW).status).toBe("unavailable");
    expect(weatherAlerts(weatherEntity(), ALERT_NOW + 10 * 60_000).status).toBe("stale");
    const future = weatherEntity(); future.attributes.fetched_at = "2026-10-28T12:02:00Z";
    expect(weatherAlerts(future, ALERT_NOW).status).toBe("unavailable");
    const naive = weatherEntity(); naive.attributes.fetched_at = "2026-10-28T12:00:00";
    expect(weatherAlerts(naive, ALERT_NOW).status).toBe("unavailable");
  });

  it.each([
    { level: "orange" }, { id: "" }, { valid_to: "not-a-time" }, { valid_to: "2026-10-28T01:00:00Z" },
    { filter_method: "distance" }, { filter_method: "region_fallback", areas: [] },
  ])("rejects malformed warning data instead of displaying a clear state: %j", patch => {
    const entity = weatherEntity(); entity.attributes.warnings = [{ ...weatherWarning(), ...patch }];
    expect(weatherAlerts(entity, ALERT_NOW).status).toBe("unavailable");
  });

  it("rejects duplicate IDs, unknown list shapes, and state/list severity contradictions", () => {
    const entity = weatherEntity(); entity.attributes.warnings = [weatherWarning(), weatherWarning()];
    expect(weatherAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    entity.attributes.warnings = null;
    expect(weatherAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    entity.attributes.warnings = [weatherWarning("red")];
    expect(weatherAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    entity.attributes.warnings = [];
    expect(weatherAlerts(entity, ALERT_NOW).status).toBe("unavailable");
  });

  it("labels region fallback explicitly and allows only trusted source links", () => {
    const entity = weatherEntity();
    entity.attributes.warnings = [{ ...weatherWarning(), filter_method: "region_fallback", source_url: "javascript:alert(1)" }];
    const item = weatherAlerts(entity, ALERT_NOW).items[0];
    expect(item.scope).toContain("property coverage unconfirmed");
    expect(item.url).toBe(WEATHER_URL);
  });

  it("does not announce another provider check but does announce a revision or transition", () => {
    const entity = weatherEntity();
    const initial = alertFingerprint([weatherAlerts(entity, ALERT_NOW)]);
    entity.attributes.fetched_at = "2026-10-28T12:01:00Z";
    expect(alertFingerprint([weatherAlerts(entity, ALERT_NOW + 60_000)])).toBe(initial);
    entity.attributes.warnings = [{ ...weatherWarning(), version: "2" }];
    expect(alertFingerprint([weatherAlerts(entity, ALERT_NOW + 60_000)])).not.toBe(initial);
  });

  it("preserves complete warning text and dual type order, with only documented status classification", () => {
    const entity = weatherEntity();
    const headline = "Full headline ".repeat(200), advice = "Full advice ".repeat(1000), expected = "Full expectation ".repeat(1000);
    entity.attributes.warnings = [{ ...weatherWarning(), version: "2.0", modified: "2026-10-28T10:00:00Z", weather_types: ["Rain", "Wind"], headline, what_to_do: [advice], what_to_expect: expected }];
    const item = weatherAlerts(entity, ALERT_NOW).items[0];
    expect(item.headline).toBe(headline);
    expect(item.advice).toEqual([advice]);
    expect(item.expected).toEqual([expected]);
    expect(item.weatherTypes).toEqual(["Rain", "Wind"]);
    expect(item.statusText).toBe("Updated");
    expect(item.attribution).toBe("Met Office Weather Warnings © Crown Copyright 2026");
    entity.attributes.warnings = [{ ...weatherWarning(), version: "", issued: null }];
    expect(weatherAlerts(entity, ALERT_NOW).items[0].statusText).toBeUndefined();
    expect(weatherAlerts(entity, ALERT_NOW).items[0].issuedAt).toBeNull();
  });

  it("does not silently discard unsupported warning text or weather types", () => {
    for (const patch of [{ what_to_do: [{ description: "unsupported" }] }, { weather_types: ["Unverified hazard"] }]) {
      const entity = weatherEntity(); entity.attributes.warnings = [{ ...weatherWarning(), ...patch }];
      expect(weatherAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    }
  });
});

describe("NRW flood warning normalization", () => {
  it.each([[1, "severe_flood_warning", 3], [2, "flood_warning", 2], [3, "flood_alert", 1]])("maps NRW level %i in the correct order", (code, severity, rank) => {
    const feed = floodAlerts(floodEntity(code as number), ALERT_NOW);
    expect(feed.status).toBe("warnings");
    expect(feed.items[0]).toMatchObject({ severity, rank, validFrom: null, validTo: null, timing: "active" });
  });

  it("keeps an unchanged warning active for days, using feed freshness rather than its issue date", () => {
    const entity = floodEntity();
    entity.attributes.warnings = [{ ...floodWarning(), raised: "2026-01-01T00:00:00Z", message_changed: "2026-01-01T00:00:00Z" }];
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("warnings");
    expect(floodAlerts(entity, ALERT_NOW + 30 * 60_000).status).toBe("stale");
  });

  it("does not show cleared warnings as active and does not treat a malformed active code as clear", () => {
    const entity = floodEntity(0); entity.attributes.cleared_warnings = [floodWarning(4)];
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("clear");
    entity.attributes.warnings = [floodWarning(4)];
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
  });

  it("rejects warnings outside an explicit area selection and labels broad Wales scope", () => {
    const entity = floodEntity(); entity.attributes.warnings = [{ ...floodWarning(), area_code: "OTHER" }];
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    entity.attributes.scope = { type: "all_wales", label: "Home", area_codes: [] };
    expect(floodAlerts(entity, ALERT_NOW).items[0].scope).toBe("All Wales");
  });

  it("hides a fresh successful empty home selection without making a flood-risk claim", () => {
    const feed = floodAlerts(noMatchingFloodAreas(), ALERT_NOW);
    expect(feed).toMatchObject({ status: "clear", items: [], scope: "Home flood areas" });
    expect(feed.notice).toBeUndefined();
  });

  it("never interprets an empty home selection as a national warning selection", () => {
    const entity = noMatchingFloodAreas();
    entity.attributes.warnings = [floodWarning()];
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    entity.attributes.warnings = [];
    entity.attributes.cleared_warnings = [floodWarning(4)];
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    entity.attributes.cleared_warnings = null;
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
  });

  it("requires current feed proof as well as successful empty area selection", () => {
    const entity = noMatchingFloodAreas();
    expect(floodAlerts(entity, ALERT_NOW + 30 * 60_000).status).toBe("stale");
    delete entity.attributes.fetched_at;
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    for (const state of ["unavailable", "unknown", "flood_alert"]) {
      expect(floodAlerts({ ...noMatchingFloodAreas(), state }, ALERT_NOW).status).toBe("unavailable");
    }
  });

  it.each([
    { coverage_status: "outside_known_areas" }, { coverage_status: "unknown" },
    { coverage_status: "stale" }, { coverage_status: "current" },
    { selection_method: "radius" }, { resolved_at: "2026-10-27T12:00:00Z" },
    { resolved_at: "2026-10-28T12:02:00Z" }, { resolved_at: "2026-10-28T12:00:00" },
  ])("does not clear an unverified or expired empty-area result: %j", patch => {
    const entity = noMatchingFloodAreas();
    entity.attributes.scope = { ...(entity.attributes.scope as object), ...patch };
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
  });

  it("keeps legacy unavailable primary data unavailable without restating the old coverage diagnosis", () => {
    const entity = noMatchingFloodAreas(); entity.state = "unavailable";
    entity.attributes.scope = { ...(entity.attributes.scope as object), coverage_status: "outside_known_areas" };
    expect(floodAlerts(entity, ALERT_NOW)).toMatchObject({ status: "unavailable", items: [] });
    expect(floodAlerts(entity, ALERT_NOW).notice).toBeUndefined();
  });

  it("does not truncate an explicit multi-area selection or the provider's bounded warning message", () => {
    const entity = floodEntity();
    entity.attributes.scope = { type: "area_codes", area_codes: [...Array.from({ length: 50 }, (_, i) => `AREA${i}`), "DEMO001"] };
    entity.attributes.warnings = [{ ...floodWarning(), message_english: "Message ".repeat(1000) }];
    const feed = floodAlerts(entity, ALERT_NOW);
    expect(feed.status).toBe("warnings");
    expect(feed.items[0].details).toHaveLength(7999);
  });

  it("rejects malformed/future freshness, missing scope, duplicate IDs and wrong aggregate state", () => {
    expect(floodAlerts(undefined, ALERT_NOW).status).toBe("unavailable");
    const entity = floodEntity(); delete entity.attributes.scope;
    expect(floodAlerts(entity, ALERT_NOW).status).toBe("unavailable");
    const duplicate = floodEntity(); duplicate.attributes.warnings = [floodWarning(), floodWarning()];
    expect(floodAlerts(duplicate, ALERT_NOW).status).toBe("unavailable");
    const wrong = floodEntity(); wrong.state = "none";
    expect(floodAlerts(wrong, ALERT_NOW).status).toBe("unavailable");
  });

  it("uses official fallback for credentials, hostile domains, protocols and ports", () => {
    for (const source_url of ["https://naturalresources.wales.evil.test/", "https://user:pass@naturalresources.wales/", "http://naturalresources.wales/", "https://naturalresources.wales:444/"]) {
      const entity = floodEntity(); entity.attributes.warnings = [{ ...floodWarning(), source_url }];
      expect(floodAlerts(entity, ALERT_NOW).items[0].url).toBe(FLOOD_URL);
    }
  });

  it("formats times in the HA time zone across British Summer Time", () => {
    expect(alertTime(Date.parse("2026-07-01T12:00:00Z"), "Europe/London")).toContain("13:00 BST");
    expect(alertTime(ALERT_NOW, "Europe/London")).toContain("12:00 GMT");
    expect(alertTime(ALERT_NOW, "invalid-zone")).toBe("2026-10-28T12:00:00.000Z");
  });
});
