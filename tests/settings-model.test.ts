import { describe, expect, it } from "vitest";
import { availableDashboards, SettingsDrafts, validateTheme } from "../src/settings/model";
import { configFixture } from "./settings-fixtures";

describe("settings drafts and concurrent browser updates", () => {
  it("restores a newer server baseline if an in-flight upload fails without editing the draft", () => {
    const drafts = new SettingsDrafts(configFixture());
    const original = drafts.themes.get("christmas")!.value;
    drafts.beginPendingChange("christmas");
    const remote = configFixture();
    remote.revision++;
    remote.themes[1].images.snow_night = "uploaded_theirs";
    drafts.receive(remote);
    expect(drafts.themes.get("christmas")!.value).toBe(original);
    drafts.finishPendingChange("christmas");
    expect(drafts.themes.get("christmas")!.value.images.snow_night).toBe("uploaded_theirs");
    expect(drafts.themes.get("christmas")!.revision).toBe(5);
    expect(drafts.hasChanges).toBe(false);
  });

  it("keeps an unsaved image and its original revision while receiving another browser's change", () => {
    const drafts = new SettingsDrafts(configFixture());
    drafts.themes.get("christmas")!.value.images.snow_night = "uploaded_ours";
    const remote = configFixture();
    remote.revision++;
    remote.themes[1].images.snow_night = "uploaded_theirs";
    remote.quality = "high";
    drafts.receive(remote);
    expect(drafts.themes.get("christmas")!.value.images.snow_night).toBe("uploaded_ours");
    expect(drafts.themes.get("christmas")!.revision).toBe(4);
    expect(drafts.settings.value.quality).toBe("high");
    expect(drafts.settings.revision).toBe(5);
    drafts.discard("christmas");
    expect(drafts.themes.get("christmas")!.value.images.snow_night).toBe("uploaded_theirs");
    expect(drafts.isDirty("christmas")).toBe(false);
    expect(drafts.themes.get("christmas")!.revision).toBe(5);
  });

  it("saving one theme preserves another tab's draft and safely rebases its unchanged baseline", () => {
    const drafts = new SettingsDrafts(configFixture());
    drafts.themes.get("christmas")!.value.enabled = false;
    drafts.settings.value.applyToAll = true;
    const saved = configFixture();
    saved.revision++;
    saved.themes[1].enabled = false;
    drafts.receive(saved, "christmas");
    expect(drafts.isDirty("christmas")).toBe(false);
    expect(drafts.settings.value.applyToAll).toBe(true);
    expect(drafts.settings.revision).toBe(5);
    expect(drafts.isDirty("dashboards")).toBe(true);
  });

  it("stages a new custom theme until save and fully removes it when discarded", () => {
    const drafts = new SettingsDrafts(configFixture());
    const theme = drafts.addTheme("custom_test", "Summer");
    expect(Object.keys(theme.images)).toHaveLength(8);
    expect(Object.values(theme.images).every(id => id === null)).toBe(true);
    expect(drafts.config.themes).toHaveLength(6);
    expect(drafts.isDirty("custom_test")).toBe(true);
    drafts.discard("custom_test");
    expect(drafts.themes.has("custom_test")).toBe(false);
    expect(drafts.hasChanges).toBe(false);
  });

  it("preserves committed data independently of mutations and ignores stale push snapshots", () => {
    const config = configFixture();
    const drafts = new SettingsDrafts(config);
    drafts.settings.value.dashboards.push("dashboard-kitchen");
    expect(config.dashboards).toEqual(["dashboard-overview"]);
    const old = configFixture();
    old.revision = 3;
    old.themes[0].name = "Old name";
    drafts.receive(old);
    expect(drafts.config.revision).toBe(4);
    expect(drafts.themes.get("default")!.value.name).toBe("Default");
  });
});

describe("dashboard inventory and schedule input", () => {
  it("adds only observed Lovelace panels, including the real default path", () => {
    const result = availableDashboards([{ url_path: "dashboard-overview", title: "Overview" }], {
      lovelace: { component_name: "lovelace", title: "Home" },
      "dashboard-overview": { component_name: "lovelace", title: "Overview" },
      energy: { component_name: "energy", title: "Energy" },
      map: { component_name: "map", title: "Map" },
      config: { component_name: "config", title: "Settings" },
    });
    expect(result.map(item => item.url_path)).toEqual(["lovelace", "dashboard-overview"]);
    expect(availableDashboards([], {})).toEqual([]);
  });

  it("permits annual Christmas across New Year but rejects a backwards one-off range", () => {
    const christmas = configFixture().themes[1];
    expect(validateTheme(christmas)).toBeNull();
    christmas.schedule = { start: "2026-12-01", end: "2026-01-05", annual: false };
    expect(validateTheme(christmas)).toContain("end date");
    christmas.schedule = { start: "2026-12-01", end: "2027-01-05", annual: false };
    expect(validateTheme(christmas)).toBeNull();
  });

  it("allows an unused empty theme but requires dates before enabling it", () => {
    const halloween = configFixture().themes[2];
    expect(validateTheme(halloween)).toBeNull();
    halloween.enabled = true;
    expect(validateTheme(halloween)).toContain("both a start and end date");
  });
});
