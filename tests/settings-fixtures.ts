import type { ImageMap, SkyConfig } from "../src/types";

export function configFixture(): SkyConfig {
  const images = (): ImageMap => ({ clear_day: null, clear_night: null, rain_day: null, rain_night: null, frost_day: null, frost_night: null, snow_day: null, snow_night: null });
  return {
    revision: 4, weatherEntity: "weather.met_office", frostEntity: null,
    applyToAll: false, dashboards: ["dashboard-overview"],
    priority: ["christmas", "halloween", "easter", "rugby", "soccer"], quality: "medium", lightning: false,
    themes: ["default", "christmas", "halloween", "easter", "rugby", "soccer"].map(id => ({
      id, name: id[0].toUpperCase() + id.slice(1), enabled: id === "default" || id === "christmas",
      schedule: id === "christmas" ? { start: "12-01", end: "01-05", annual: true } : null,
      images: images(),
    })),
  };
}
