import { SkyCanvasWeatherAlerts } from "../../src/alerts/banner";
import { floodAlerts, weatherAlerts } from "../../src/alerts/model";
import type { AlertFeed } from "../../src/alerts/model";
import { ALERT_NOW, floodEntity, weatherEntity, weatherWarning } from "../alerts-fixtures";

const add = (host: Element, feeds: AlertFeed[]) => {
  const element = document.createElement("ha-sky-canvas-weather-alerts") as SkyCanvasWeatherAlerts;
  element.timeZone = "Europe/London"; element.feeds = feeds; host.append(element); return element;
};
const weather = (value: string) => {
  const entity = weatherEntity(["upcoming", "unavailable", "stale"].includes(value) ? "red" : value);
  if (value === "upcoming") entity.attributes.warnings = [{ ...weatherWarning("red"), valid_from: "2026-10-28T15:00:00Z" }];
  if (value === "unavailable") entity.state = "unavailable";
  if (value === "stale") entity.attributes.fetched_at = "2026-10-28T10:00:00Z";
  return weatherAlerts(entity, ALERT_NOW);
};
const flood = (value: string) => {
  const entity = floodEntity(["unavailable", "stale", "outside"].includes(value) ? 1 : Number(value));
  if (value === "unavailable") entity.state = "unavailable";
  if (value === "stale") entity.attributes.fetched_at = "2026-10-28T10:00:00Z";
  if (value === "outside") {
    entity.state = "unavailable";
    entity.attributes.scope = { type: "area_codes", label: "Home flood areas", area_codes: [], selection_method: "home_polygon", coverage_status: "outside_known_areas", resolved_at: new Date(ALERT_NOW).toISOString() };
  }
  return floodAlerts(entity, ALERT_NOW);
};
const interactive = add(document.querySelector("#interactive")!, []);
const update = () => {
  interactive.feeds = [weather(document.querySelector<HTMLSelectElement>("#weather")!.value), flood(document.querySelector<HTMLSelectElement>("#flood")!.value)];
  document.querySelector<HTMLElement>("#device")!.style.width = `${document.querySelector<HTMLSelectElement>("#width")!.value}px`;
};
document.querySelectorAll("select").forEach(select => select.addEventListener("change", update));
update();
for (const [title, feed] of [
  ["Yellow weather warning", weather("yellow")], ["Amber weather warning", weather("amber")], ["Red weather warning", weather("red")],
  ["Upcoming weather warning", weather("upcoming")], ["Flood alert · level 3", flood("3")], ["Flood warning · level 2", flood("2")],
  ["Severe flood warning · level 1", flood("1")], ["No active flood warnings", flood("0")],
  ["Weather information unavailable", weather("unavailable")], ["Flood information out of date", flood("stale")],
  ["Home outside published NRW warning areas", flood("outside")],
] as const) {
  const box = document.createElement("section"); box.className = "example";
  const heading = document.createElement("h3"); heading.textContent = title; box.append(heading);
  add(box, [feed]);
  if (feed.status === "clear") { const note = document.createElement("p"); note.className = "empty"; note.textContent = "No banner is shown for a fresh empty warning list. This does not imply that there is no flood risk."; box.append(note); }
  document.querySelector("#gallery")!.append(box);
}
