import { LitElement, css, html } from "lit";
import type { HomeAssistant } from "../types";
import { WEATHER_LAYOUTS, cardLayout, type WeatherCardConfig, type WeatherLayout } from "./config";

/** Lovelace's native editor owns saving and cancelling the emitted config. */
export class SkyCanvasWeatherEditor extends LitElement {
  static properties = { hass: { attribute: false }, config: { state: true } };
  static styles = css`
    :host{display:block;color:var(--primary-text-color)}.fields{display:grid;gap:18px;padding:12px 0}label{display:grid;gap:7px;font-size:14px}select,input{font:inherit;color:inherit;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:8px;min-height:44px;padding:9px 12px;box-sizing:border-box;width:100%}p{font-size:13px;line-height:1.6;color:var(--secondary-text-color);margin:0}select:focus-visible,input:focus-visible{outline:3px solid var(--primary-color);outline-offset:2px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:400px){.pair{grid-template-columns:1fr}}
  `;
  declare hass: HomeAssistant;
  private config: WeatherCardConfig = { entity: "weather.metoffice_direct", mode: "current" };
  setConfig(config: WeatherCardConfig): void { this.config = { ...config }; }
  private change(key: keyof WeatherCardConfig, value: unknown): void {
    const next = { ...this.config, [key]: value };
    if (key === "layout") {
      const preset = WEATHER_LAYOUTS[value as WeatherLayout];
      next.grid_options = { ...next.grid_options, columns: preset.columns, rows: preset.rows };
      if (["glance", "tile", "now", "column", "detail"].includes(String(value))) next.mode = "current";
      else if (next.mode === "current" || !next.mode) next.mode = "hourly";
    }
    if (key === "mode" && value === "daily" && typeof next.limit === "number" && next.limit > 10) next.limit = 7;
    if (value === "" || value === undefined) delete next[key];
    this.config = next;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
  }
  render() {
    const layout = cardLayout(this.config), preset = WEATHER_LAYOUTS[layout];
    const currentOnly = ["glance", "tile", "now", "column", "detail"].includes(layout);
    const entities = Object.keys(this.hass?.states ?? {}).filter(key => key.startsWith("weather."));
    if (!entities.includes(this.config.entity)) entities.unshift(this.config.entity);
    return html`<div class="fields"><label>Weather entity<select .value=${this.config.entity} @change=${(e: Event) => this.change("entity", (e.target as HTMLSelectElement).value)}>${entities.map(key => html`<option value=${key}>${key}</option>`)}</select></label>
      <label>Card size and layout<select .value=${layout} @change=${(e: Event) => this.change("layout", (e.target as HTMLSelectElement).value)}>${Object.entries(WEATHER_LAYOUTS).map(([key, item]) => html`<option value=${key}>${item.label} · ${item.columns} columns × ${item.rows === "auto" ? "automatic height" : `${item.rows} rows`}</option>`)}</select></label>
      <p>${preset.description}. Selecting a layout sets its Home Assistant grid size. You can then adjust it in the Layout tab.</p>
      <div class="pair"><label>Forecast content<select ?disabled=${currentOnly} .value=${currentOnly ? "current" : this.config.mode ?? "current"} @change=${(e: Event) => this.change("mode", (e.target as HTMLSelectElement).value)}><option value="current">Current weather</option><option value="hourly">Hourly forecast</option><option value="daily">Daily forecast</option></select></label>
      <label>Background<select .value=${this.config.surface ?? "default"} @change=${(e: Event) => this.change("surface", (e.target as HTMLSelectElement).value)}><option value="default">Follow Sky Canvas settings</option><option value="solid">Met Office blue</option><option value="glass">Glass</option></select></label></div>
      <label>Title (optional)<input maxlength="120" .value=${this.config.title ?? ""} @change=${(e: Event) => this.change("title", (e.target as HTMLInputElement).value)}></label>
      <label>Forecast periods (optional)<input type="number" min="1" max=${this.config.mode === "daily" ? "10" : "72"} .value=${this.config.limit?.toString() ?? ""} @change=${(e: Event) => this.change("limit", (e.target as HTMLInputElement).value === "" ? undefined : Number((e.target as HTMLInputElement).value))}></label>
      <p>Met Office data and official weather symbols. Forecast times use Home Assistant's timezone. Missing or out-of-date data is shown explicitly.</p></div>`;
  }
}
if (!customElements.get("ha-sky-canvas-weather-editor")) customElements.define("ha-sky-canvas-weather-editor", SkyCanvasWeatherEditor);
