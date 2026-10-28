import { describe, expect, it } from "vitest";
import type { HassEntity } from "../src/types";
import { forecastTime, frameKey, readForecastMap } from "../src/map/model";

const now = Date.parse("2026-10-28T12:00:00Z");
const iso = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
const frame = (hours: number, id = String(hours + 10).padStart(64, "0")) => ({ id, valid_time: iso(hours), model_run: iso(-1) });
const entity = (frames = [frame(0), frame(1)]): HassEntity => ({
  state: "ready", attributes: { fetched_at: iso(0), model_run: iso(-1), frames, region: "Wales" },
});

describe("forecast map metadata boundary", () => {
  it("sorts unique frames and keeps only the supported rolling window", () => {
    const result = readForecastMap(entity([frame(25), frame(24), frame(1), frame(-2), frame(-1)]), now)!;
    expect(result.frames.map(item => item.valid_time)).toEqual([iso(-1), iso(1), iso(24)]);
    expect(result.stale).toBe(false);
    expect(frameKey(result)).toBe(result.frames.map(item => item.id).join(":"));
  });

  it.each(["2026-02-30T12:00:00Z", "2026-10-28T24:00:00Z", "2026-10-28T12:00:00", "2026-10-28", "12", "nonsense", "2026-10-28T12:00:00+25:00"])("rejects invalid or timezone-ambiguous timestamp %s", value => {
    const item = entity();
    item.attributes.fetched_at = value;
    expect(readForecastMap(item, now)).toBeNull();
    item.attributes.fetched_at = iso(0);
    (item.attributes.frames as ReturnType<typeof frame>[])[0].valid_time = value;
    expect(readForecastMap(item, now)).toBeNull();
  });

  it("accepts an explicit offset denoting the same instant", () => {
    const item = entity();
    item.attributes.fetched_at = "2026-10-28T13:00:00+01:00";
    expect(readForecastMap(item, now)?.fetchedAt).toBe(now);
  });

  it("reads the provider's region name while rejecting non-string names", () => {
    const item = entity();
    item.attributes.region = { name: " Wales ", extent: { x: [-6, -2], y: [51, 54] } };
    expect(readForecastMap(item, now)?.region).toBe("Wales");
    item.attributes.region = { name: { html: "bad" } };
    expect(readForecastMap(item, now)?.region).toBe("Selected region");
  });

  it("rejects mixed runs, duplicate IDs/times and non-opaque frame IDs", () => {
    const mixed = entity();
    (mixed.attributes.frames as ReturnType<typeof frame>[])[1].model_run = iso(-2);
    expect(readForecastMap(mixed, now)).toBeNull();
    expect(readForecastMap(entity([frame(0), frame(1, frame(0).id)]), now)).toBeNull();
    expect(readForecastMap(entity([frame(0), frame(0, "a".repeat(64))]), now)).toBeNull();
    expect(readForecastMap(entity([frame(0, "https://example.test/image.png")]), now)).toBeNull();
    expect(readForecastMap(entity([frame(0, "../../secret")]), now)).toBeNull();
  });

  it("rejects empty, oversized and unavailable inventories", () => {
    expect(readForecastMap(entity([]), now)).toBeNull();
    expect(readForecastMap(entity(Array.from({ length: 26 }, (_, i) => frame(i))), now)).toBeNull();
    expect(readForecastMap({ ...entity(), state: "unavailable" }, now)).toBeNull();
    expect(readForecastMap(undefined, now)).toBeNull();
    expect(readForecastMap(entity(), NaN)).toBeNull();
  });

  it.each([
    ["fetched_at", -2 - 1 / 3600], ["model_run", -24 - 1 / 3600],
    ["fetched_at", 301 / 3600], ["model_run", 301 / 3600],
  ])("marks old or future %s as stale", (attribute, hours) => {
    const item = entity();
    item.attributes[attribute] = iso(Number(hours));
    if (attribute === "model_run") for (const value of item.attributes.frames as ReturnType<typeof frame>[]) value.model_run = String(item.attributes.model_run);
    expect(readForecastMap(item, now)?.stale).toBe(true);
  });

  it("formats in the HA timezone and degrades safely for invalid display input", () => {
    expect(forecastTime("2026-07-01T12:00:00Z", "Europe/London")).toContain("13:00");
    expect(forecastTime("invalid", "Europe/London")).toBe("Unknown time");
    expect(forecastTime(now, "Invalid/Zone")).toBe(iso(0));
  });
});
