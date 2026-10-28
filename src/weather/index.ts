import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import type { HomeAssistant } from "../types";
import { GUIDE_URL, currentWeather, displayTime, forecastPeriods, measurement, timestamp, weatherStatus, weatherUnits, windDirection, type WeatherMode, type WeatherPeriod, type WeatherSymbol, type WeatherUnits } from "./model";
import "./editor";
import { WEATHER_LAYOUTS, cardLayout, forecastMode, validateWeatherConfig, type WeatherCardConfig, type WeatherSurface } from "./config";
export type { WeatherCardConfig } from "./config";
import { strongGust, temperatureBand, uvBand, type ColourBand } from "./palette";

interface ForecastEvent { forecast: unknown; }

/** Local symbols and HA's converted forecast subscription; no provider HTTP calls. */
export class SkyCanvasWeatherCard extends LitElement {
  static properties = { hass: { attribute: false }, config: { state: true }, forecast: { state: true }, failed: { state: true }, globalSurface: { state: true } };
  static styles = css`
    :host{display:block;height:100%;min-width:0;--mo-blue:#147bbe;--mo-panel:#114465;--mo-chip:#114f77;--mo-bar:#1d1d1d;--mo-lime:#c4e90c;color:#fff;font-family:var(--ha-font-family,Arial,sans-serif);font-size:13px;line-height:1.25;font-variant-numeric:tabular-nums;container-type:inline-size}
    *{box-sizing:border-box}ha-card{display:flex;flex-direction:column;position:relative;overflow:hidden;height:100%;min-height:var(--weather-min-height,56px);border-radius:var(--ha-card-border-radius,12px);background:var(--mo-blue);color:#fff;font-size:13px;line-height:1.25;border:1px solid rgba(255,255,255,.16);box-shadow:var(--ha-card-box-shadow,none)}
    ha-card.glass{--mo-panel:rgba(8,31,48,.74);--mo-chip:rgba(8,31,48,.7);background:rgba(12,54,83,.78);backdrop-filter:blur(22px) saturate(135%);-webkit-backdrop-filter:blur(22px) saturate(135%);border-color:rgba(255,255,255,.3)}
    .brand-bar{display:flex;align-items:center;gap:8px;min-height:30px;padding:5px 12px;background:var(--mo-bar);font-size:11px;line-height:1.3}.brand{font-weight:750;letter-spacing:.01em;white-space:nowrap}.brand::before{content:"";display:inline-block;width:5px;height:14px;background:var(--mo-lime);margin-right:7px;vertical-align:-2px}.brand-bar .source{margin-left:auto;color:#d2d8dc;font-size:10px}.body{padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}header{display:flex;flex-direction:column;gap:3px}h2{font-size:16px;line-height:1.3;font-weight:700;margin:0;overflow-wrap:anywhere}p{margin:0;line-height:1.45}.sub,.meta{font-size:11px;color:#dce8ef}.current{display:flex;gap:14px;align-items:center;min-width:0}.current-main{display:flex;flex-direction:column;gap:5px;min-width:0}.symbol{display:flex;flex-direction:column;gap:5px;align-items:center;justify-content:center}.symbol img{display:block;width:42px;height:42px;object-fit:contain;flex-shrink:0}.symbol span{font-size:12px;line-height:1.3;white-space:normal;max-width:14em}.current .symbol img{width:56px;height:56px}.current .symbol span{display:none}.condition{font-size:13px;font-weight:650;line-height:1.3}.temperature{font-size:34px;line-height:1.1;white-space:nowrap}.current-action{display:flex;flex:1;gap:12px;align-items:center;border:0;background:transparent;padding:0;text-align:left;color:inherit;min-height:44px;cursor:pointer;font:inherit;min-width:0}.current-action:focus-visible{outline-offset:3px}
    .chips{display:flex;gap:4px;flex-wrap:wrap}.chip{padding:4px 6px;border-radius:3px;background:var(--mo-chip);font-size:11px;line-height:1.3;white-space:nowrap}.measurements{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin:0;padding:8px;background:var(--mo-panel);border-radius:3px}.measurements div{font-size:11px;line-height:1.4;min-width:0}.measurements dt{color:#dce8ef;font-size:10px}.measurements dd{margin:0;font-weight:600;overflow-wrap:anywhere}
    .scroll{overflow:auto;overscroll-behavior-x:contain;min-height:0;padding-bottom:4px}.scroll:focus-visible,a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--mo-lime);outline-offset:2px}table{width:100%;border-collapse:separate;border-spacing:3px;font-size:12px}th,td{padding:9px 8px;background:var(--mo-panel);text-align:center;vertical-align:middle;min-width:100px}thead th{font-weight:700;line-height:1.4;border-top:3px solid var(--mo-lime)}tbody th{font-weight:500;text-align:left}th:first-child{position:sticky;left:0;z-index:1;background:#113f5c;min-width:112px;max-width:136px;box-shadow:1px 0 rgba(255,255,255,.2)}.scroll .symbol{min-height:86px}.scroll-hint{font-size:11px;color:#dce8ef}
    .scroll,.periods{scrollbar-color:#8fc5e4 var(--mo-panel);scrollbar-width:thin}.scroll::-webkit-scrollbar,.periods::-webkit-scrollbar{height:8px;width:8px}.scroll::-webkit-scrollbar-track,.periods::-webkit-scrollbar-track{background:var(--mo-panel)}.scroll::-webkit-scrollbar-thumb,.periods::-webkit-scrollbar-thumb{background:#8fc5e4;border-radius:6px}
    .periods{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(72px,1fr);gap:4px;overflow-x:auto;overscroll-behavior-x:contain;min-width:0;scroll-snap-type:x proximity;padding:0 0 4px}.period{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;background:var(--mo-panel);min-width:0;text-align:center;scroll-snap-align:start;border-top:3px solid transparent}.period:first-child{border-top-color:var(--mo-lime)}.period time{font-size:12px;font-weight:700;white-space:nowrap}.period .symbol img{width:32px;height:32px}.period .symbol span{font-size:10px;min-height:26px}.period .forecast-temp{font-size:17px;font-weight:650}.period .rain{font-size:12px;color:#b8e8ff}.period .wind,.period .feels{font-size:10px;color:#dce8ef}.forecast-layout{display:flex;flex-direction:column;gap:10px;min-height:0}.overview-body{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(0,1.6fr);gap:12px;align-items:center;flex:1;min-height:0}.overview-body .current{align-self:start}.overview-body .current-action{flex-direction:column;align-items:flex-start;gap:5px}.overview-body .current .symbol img{width:40px;height:40px}
    .source-details{font-size:11px;line-height:1.5;margin-top:auto}.source-details>summary{cursor:pointer;color:#e3edf3;min-height:24px;padding:4px 0;list-style-position:inside}.source-details[open]{position:absolute;inset:30px 0 0;z-index:3;background:#103d5c;padding:12px;overflow:auto}.source-details[open]>summary{font-weight:700;color:var(--mo-lime);margin-bottom:12px}.meta{display:grid;gap:8px}.actions{display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap}a{color:#e0f4ff;text-underline-offset:3px}.retry{font:inherit;color:#fff;background:var(--mo-panel);border:1px solid #9ab3c4;border-radius:6px;min-height:44px;padding:8px 12px;cursor:pointer}.empty{padding:12px 0;font-size:13px}.neutral{width:42px;height:42px;display:grid;place-items:center;font-size:28px;color:#dce8ef}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
    .band{display:inline-block;padding:2px 5px;border-radius:3px;font-variant-numeric:tabular-nums}.temp-band{text-align:center}.temperature .temp-band{background:transparent!important;color:#fff!important;padding:0}.uv-band{font-size:10px;font-weight:650;line-height:1.4;text-align:center}strong{font-weight:750}.scroll .temp-band{display:block}.table-layout .body{padding:16px}.table-layout .source-details[open]{position:static;background:var(--mo-panel);border-radius:4px}.table-layout .period-note{margin-top:8px}
    .glance-layout .brand-bar,.tile-layout .brand-bar,.strip-layout .brand-bar{display:none}.glance-layout .body,.tile-layout .body,.strip-layout .body{padding:6px 10px;justify-content:center;gap:3px}.glance-layout header,.tile-layout header,.strip-layout header,.glance-layout .source-details,.tile-layout .source-details,.strip-layout .source-details,.now-layout .source-details,.column-layout .source-details{display:none}.mini-brand{display:none;font-size:8px;font-weight:700;letter-spacing:.02em;color:#e0edf5}.glance-layout .mini-brand,.tile-layout .mini-brand,.strip-layout .mini-brand{display:block}.glance-layout .empty,.tile-layout .empty,.strip-layout .empty{font-size:10px;line-height:1.2;padding:0}.glance-layout .temperature,.tile-layout .temperature{font-size:23px}.glance-layout .current .symbol img{width:24px;height:24px}.tile-layout .current .symbol img{width:30px;height:30px}.glance-layout .current-main{gap:0}.glance-layout .condition,.glance-layout .feels,.tile-layout .feels{display:none}.tile-layout .current-main{flex-direction:row;align-items:center;gap:8px}.tile-layout .condition{font-size:11px}.tile-layout .current-action,.glance-layout .current-action{gap:5px;min-height:30px}.now-layout .brand-bar,.column-layout .brand-bar{min-height:22px;padding:4px 8px;font-size:10px}.now-layout .source,.column-layout .source{display:none}.now-layout header,.column-layout header{display:none}.now-layout .body{padding:8px;gap:6px}.now-layout .current .symbol img{width:36px;height:36px}.now-layout .temperature{font-size:26px}.now-layout .feels{display:none}.now-layout .condition{font-size:11px}.now-layout .chip{font-size:10px;padding:3px 5px}.column-layout .body{padding:8px}.column-layout .current-action{flex-direction:column;text-align:center;align-items:center;gap:5px}.column-layout .current-main{align-items:center}.column-layout .current .symbol img{width:40px;height:40px}.column-layout .temperature{font-size:28px}.column-layout .condition{font-size:10px}.column-layout .feels{display:none}.column-layout .chips{justify-content:center}.column-layout .chip{font-size:10px}.detail-layout .body{gap:8px}.detail-layout .current .symbol img{width:44px;height:44px}.detail-layout .temperature{font-size:30px}.detail-layout .condition{font-size:12px}.detail-layout .measurements{gap:5px 8px}.detail-layout .source-details{font-size:10px}.strip-layout .periods{grid-auto-columns:minmax(56px,1fr);gap:2px;padding:0;overflow-x:auto}.strip-layout .period{padding:0 4px;background:transparent;border:0;display:grid;grid-template-columns:auto auto;gap:2px}.strip-layout .period time{font-size:10px;grid-column:1/-1}.strip-layout .period .symbol img{width:20px;height:20px}.strip-layout .period .symbol span,.strip-layout .rain,.strip-layout .wind,.strip-layout .feels,.strip-layout .night{display:none}.strip-layout .period .forecast-temp{font-size:13px}.strip-layout .period .band{background:transparent!important;color:#fff!important;padding:0}.strip-layout .forecast-layout{gap:0}.overview-layout .periods{grid-auto-columns:minmax(62px,1fr)}.overview-layout .period{padding:6px 4px}.overview-layout .period .symbol span{display:none}.overview-layout .period .wind,.overview-layout .period .feels{display:none}.overview-layout .source-details{font-size:10px}
    .column-layout .condition{display:none}.detail-layout header,.overview-layout header,.forecast-layout header{display:none}.detail-layout .body{padding:8px;gap:6px}.detail-layout .feels{display:none}.detail-layout .source-details>summary{min-height:18px;padding:0}.detail-layout .measurements{padding:8px}.overview-layout .body{padding:10px;gap:0}.overview-layout .brand-bar>.source{display:none}.overview-layout .current-action{flex-direction:row;align-items:center;gap:7px}.overview-layout .current-main{gap:3px}.overview-layout .temperature{font-size:27px}.overview-layout .condition{font-size:11px}.overview-layout .feels{font-size:10px}.overview-layout .period{gap:4px;padding:4px}.overview-layout .period .forecast-temp{font-size:15px}.overview-layout .period .rain{font-size:10px}.overview-layout .source-details:not([open]){position:absolute;top:4px;right:10px;margin:0}.overview-layout .source-details>summary{min-height:20px;padding:0}.strip-layout .periods{scrollbar-width:none;overflow-y:hidden}.strip-layout .periods::-webkit-scrollbar{display:none}.strip-layout .period{row-gap:1px}.strip-layout .period time{line-height:11px}.strip-layout .body{padding:4px 10px;gap:2px}.strip-layout .mini-brand{line-height:9px}.forecast-layout>.body{padding:10px;gap:8px}.forecast-layout .period{gap:3px;padding:4px 6px}ha-card.forecast-layout .period .symbol span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.25;max-width:100%}.forecast-layout .source-details>summary{min-height:18px;padding:0}.forecast-layout .current .feels{display:none}.forecast-layout .current .symbol img{width:48px;height:48px}.forecast-layout .current-main{gap:3px}.forecast-layout .temperature{font-size:30px}.forecast-layout .condition{font-size:12px}.now-layout .condition{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.now-layout .temperature{font-size:24px}
    .tile-layout .condition{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-width:0;font-size:10px;line-height:12px}.tile-layout .temperature{font-size:20px;flex-shrink:0}.tile-layout .current-main{gap:5px}.detail-layout .measurements{padding:6px;gap:4px 8px}.detail-layout .measurements dt{font-size:9px;line-height:12px}.detail-layout .measurements dd{font-size:11px;line-height:14px}
    .detail-layout .condition{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.detail-layout .body{padding:7px;gap:5px}
    @container(max-width:110px){.glance-layout .body{padding:4px}.glance-layout .temperature{font-size:18px}.glance-layout .current .symbol img{width:18px;height:18px}.glance-layout .current-action{gap:2px}.glance-layout .mini-brand{font-size:7px}}
    @container(max-width:400px){.overview-layout .current-action{flex-direction:column;align-items:flex-start;gap:4px}.overview-layout .current-main{gap:2px}.overview-layout .current .symbol img{width:28px;height:28px}.overview-layout .temperature{font-size:24px}.overview-layout .overview-body{grid-template-columns:minmax(88px,.7fr) minmax(0,1.3fr);gap:8px}}
    @container(max-width:340px){.overview-layout .temperature{font-size:24px}.overview-layout .current .symbol img{width:32px;height:32px}.overview-layout .current-action{gap:5px}.overview-layout .current-main{min-width:0}.overview-layout .feels .band{padding:1px 3px}}
    @container(max-width:320px){.measurements{grid-template-columns:repeat(2,minmax(0,1fr))}.overview-body{grid-template-columns:minmax(82px,.7fr) minmax(0,1.3fr);gap:8px}.brand-bar .source{display:none}h2{font-size:14px}.overview-layout .temperature{font-size:24px}.table-layout .body{padding:12px}}
    @media(prefers-reduced-transparency:reduce){ha-card.glass{background:#114465;backdrop-filter:none;-webkit-backdrop-filter:none}}
  `;
  declare hass: HomeAssistant;
  private config: WeatherCardConfig = { entity: "weather.metoffice_direct", mode: "current", compact: false };
  private forecast: unknown = undefined;
  private failed = false;
  private subscriptionKey = "";
  private connection: HomeAssistant["connection"] | undefined;
  private unsubscribe?: () => void;
  private generation = 0;
  private timer?: number;
  private badSymbols = new Set<string>();
  private visible = (): void => { if (!document.hidden) this.requestUpdate(); };

  private globalSurface: WeatherSurface = "solid";
  private appearance = (event?: Event): void => {
    const detail = (event as CustomEvent<{ weatherCardSurface?: unknown }> | undefined)?.detail;
    this.globalSurface = (detail?.weatherCardSurface ?? document.documentElement.dataset.skyWeatherSurface) === "glass" ? "glass" : "solid";
  };
  setConfig(config: WeatherCardConfig): void { this.config = validateWeatherConfig(config); }
  static getStubConfig(): WeatherCardConfig { return { entity: "weather.metoffice_direct", mode: "current", layout: "now" }; }
  static getConfigElement(): HTMLElement { return document.createElement("ha-sky-canvas-weather-editor"); }
  getCardSize(): number { const rows = WEATHER_LAYOUTS[cardLayout(this.config)].rows; return rows === "auto" ? 7 : rows; }
  getGridOptions() { const preset = WEATHER_LAYOUTS[cardLayout(this.config)]; return { columns: preset.columns, min_columns: Math.min(3, preset.columns), rows: preset.rows, min_rows: 1 }; }
  connectedCallback(): void {
    super.connectedCallback();
    this.appearance(); window.addEventListener("ha-sky-canvas-appearance", this.appearance);
    this.timer = window.setInterval(() => { if (!document.hidden) this.requestUpdate(); }, 60_000);
    document.addEventListener("visibilitychange", this.visible);
    this.requestUpdate();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("ha-sky-canvas-appearance", this.appearance);
    this.releaseSubscription();
    window.clearInterval(this.timer); this.timer = undefined;
    document.removeEventListener("visibilitychange", this.visible);
  }
  protected updated(): void { this.ensureSubscription(); }
  private releaseSubscription(): void {
    this.generation++;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.subscriptionKey = ""; this.connection = undefined;
  }
  private ensureSubscription(): void {
    if (!this.isConnected || !this.hass) return;
    const forecastType = forecastMode(this.config);
    const key = `${this.config.entity}:${forecastType}`;
    if (this.subscriptionKey === key && this.connection === this.hass.connection) return;
    this.releaseSubscription();
    this.subscriptionKey = key; this.connection = this.hass.connection;
    this.forecast = undefined; this.failed = false;
    if (!forecastType) return;
    if (!this.connection) { this.failed = true; return; }
    const generation = this.generation;
    const current = () => this.isConnected && this.generation === generation;
    void this.connection.subscribeMessage<ForecastEvent>((event) => {
      if (current()) { this.forecast = event?.forecast ?? null; this.failed = false; }
    }, { type: "weather/subscribe_forecast", entity_id: this.config.entity, forecast_type: forecastType }).then(stop => {
      if (!current()) stop(); else this.unsubscribe = stop;
    }).catch(() => { if (current()) { this.failed = true; this.forecast = null; } });
  }
  private retry = (): void => { this.releaseSubscription(); this.ensureSubscription(); };
  private moreInfo = (): void => { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this.config.entity }, bubbles: true, composed: true })); };
  private symbol(value: WeatherSymbol | null): TemplateResult {
    const usable = value && !this.badSymbols.has(value.url);
    return html`<div class="symbol" role="img" aria-label=${value?.label ?? "Symbol unavailable"}>${usable ? html`<img src=${value.url} alt="" loading="lazy" decoding="async" @error=${() => { this.badSymbols.add(value.url); this.requestUpdate(); }}>` : html`<span class="neutral" aria-hidden="true">—</span>`}<span>${value?.label ?? "Symbol unavailable"}</span>${value && !usable ? html`<span class="sr-only">Image unavailable</span>` : nothing}</div>`;
  }
  private wind(period: WeatherPeriod, units: WeatherUnits): string {
    const value = measurement(period.wind, units.wind);
    return value === "—" ? value : `${windDirection(period.bearing)} ${value}`.trim();
  }
  private bandStyle(band: ColourBand): string { return `background-color:${band.background};color:${band.foreground}`; }
  private temperature(value: number | null, unit: string | null): TemplateResult {
    const band = temperatureBand(value, unit), label = measurement(value, unit);
    return band ? html`<span class="band temp-band" style=${this.bandStyle(band)}>${label}</span>` : html`${label}`;
  }
  private uv(value: number | null): TemplateResult {
    const band = uvBand(value);
    return band ? html`<span class="band uv-band" style=${this.bandStyle(band)}>${measurement(value, "")} · ${band.label}</span>` : html`—`;
  }
  private gust(value: number | null, unit: string | null): TemplateResult {
    const label = measurement(value, unit);
    return strongGust(value, unit) ? html`<strong>${label}<span class="sr-only"> · strong gust</span></strong>` : html`${label}`;
  }
  private current(period: WeatherPeriod, units: WeatherUnits): TemplateResult {
    const layout = cardLayout(this.config), tiny = ["glance", "tile"].includes(layout);
    const pairs = [
      ["Wind (from)", this.wind(period, units)], ["Gust · previous 10 min", this.gust(period.gust, units.wind)],
      ["Precipitation chance", measurement(period.probability, "%", 0)], ["UV index", this.uv(period.uv)],
      ...(!this.config.compact && layout !== "detail" ? [["Humidity", measurement(period.humidity, "%", 0)], ["Pressure", measurement(period.pressure, units.pressure)]] : []),
    ];
    return html`<div class="current"><button class="current-action" @click=${this.moreInfo} aria-label=${`Weather details: ${period.symbol?.label ?? "symbol unavailable"}, ${measurement(period.temperature, units.temperature)}`}>${this.symbol(period.symbol)}<span class="current-main"><span class="temperature">${layout === "glance" ? measurement(period.temperature, units.temperature, 0).replace(/°[CF]$/, "°") : this.temperature(period.temperature, units.temperature)}</span><span class="condition">${period.symbol?.label ?? "Symbol unavailable"}</span><span class="sub feels">Feels like ${this.temperature(period.feelsLike, units.temperature)}</span></span></button></div>
      ${tiny ? nothing : ["now", "column", "forecast"].includes(layout) ? html`<div class="chips"><span class="chip" title="Chance of precipitation">Chance ${measurement(period.probability, "%", 0)}</span><span class="chip">${this.wind(period, units)}</span>${layout === "forecast" ? html`<span class="chip">Gust ${this.gust(period.gust, units.wind)}</span>` : nothing}</div>` : layout === "overview" ? nothing : html`<dl class="measurements">${pairs.map(([label, value]) => html`<div><dt title=${String(label)}>${layout === "detail" ? html`<span class="sr-only">${label}</span><span aria-hidden="true">${({ "Wind (from)": "Wind", "Gust · previous 10 min": "Gust · 10 min", "Precipitation chance": "Chance", "UV index": "UV index" } as Record<string, string>)[String(label)] ?? label}</span>` : label}</dt><dd>${value}</dd></div>`)}</dl>`}`;
  }
  private shortForecast(periods: WeatherPeriod[], units: WeatherUnits, zone: string): TemplateResult {
    const daily = forecastMode(this.config) === "daily";
    const clock = (period: WeatherPeriod) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...(daily ? { weekday: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" }) }).format(period.time);
    return html`<div class="periods" tabindex="0" role="region" aria-label=${`${daily ? "Daily" : "Hourly"} forecast; scroll horizontally for more periods`}>${periods.map(period => html`<div class="period"><time datetime=${new Date(period.time).toISOString()} title=${displayTime(period.time, zone, daily)}>${clock(period)}</time>${this.symbol(period.symbol)}<span class="forecast-temp">${this.temperature(period.temperature, units.temperature)}</span>${daily ? html`<span class="night">Night ${measurement(period.low, units.temperature)}</span>` : html`<span class="feels">Feels ${measurement(period.feelsLike, units.temperature)}</span>`}<span class="rain" title="Chance of precipitation">Chance ${measurement(period.probability, "%", 0)}</span><span class="wind">${this.wind(period, units)}</span></div>`)}</div>`;
  }
  private table(periods: WeatherPeriod[], units: WeatherUnits, zone: string): TemplateResult {
    const daily = this.config.mode === "daily";
    const row = (label: string, content: (period: WeatherPeriod) => unknown) => html`<tr><th scope="row">${label}</th>${periods.map(period => html`<td>${content(period)}</td>`)}</tr>`;
    return html`<p class="scroll-hint">Scroll horizontally for more forecast periods. Times follow Home Assistant's timezone.</p><div class="scroll" tabindex="0" role="region" aria-label=${daily ? "Daily forecast, scroll horizontally" : "Hourly forecast, scroll horizontally"}><table><caption class="sr-only">${daily ? "Daily" : "Hourly"} Met Office forecast. Missing measurements are shown as a dash.</caption><thead><tr><th scope="col">${daily ? "Forecast day" : "Forecast time"}</th>${periods.map(period => html`<th scope="col">${displayTime(period.time, zone, daily)}</th>`)}</tr></thead><tbody>
      ${row(daily ? "Day weather" : "Weather", period => this.symbol(period.symbol))}
      ${daily ? row("Following night", period => this.symbol(period.nightSymbol)) : nothing}
      ${row(daily ? "Day high" : "Temperature", period => this.temperature(period.temperature, units.temperature))}
      ${daily ? row("Night low", period => this.temperature(period.low, units.temperature)) : row("Feels like", period => this.temperature(period.feelsLike, units.temperature))}
      ${row(daily ? "Day precipitation chance" : "Precipitation chance", period => measurement(period.probability, "%", 0))}
      ${!daily ? row("Precipitation · previous hour", period => measurement(period.precipitation, units.precipitation)) : nothing}
      ${row(daily ? "Midday wind (from)" : "Wind (from)", period => this.wind(period, units))}
      ${row(daily ? "Midday gust" : "Gust · previous 10 min", period => this.gust(period.gust, units.wind))}
      ${row(daily ? "Maximum UV index" : "UV index", period => this.uv(period.uv))}
    </tbody></table></div><p class="sub">${daily ? "Day precipitation chance covers local dawn to dusk; night low and night symbol cover the following night. Highs and lows can occur between hourly forecast times. Midday gust covers the preceding 10 minutes." : "Global Spot timing: temperature and mean wind apply at the time shown. Precipitation amount covers the previous hour; chance covers the hour centred on that time. Gust is a 3-second maximum over the previous 10 minutes. Symbols combine conditions at that time with recent-period information."} Bold gusts indicate at least 25 knots (about 29 mph).</p>`;
  }
  render() {
    const entity = this.hass?.states[this.config.entity], now = Date.now(), mode = this.config.mode ?? "current";
    const layout = cardLayout(this.config), forecastType = forecastMode(this.config);
    const status = weatherStatus(entity, now, forecastType ?? mode), zone = this.hass?.config.time_zone ?? "UTC";
    const units = weatherUnits(entity), current = currentWeather(entity, now);
    const matching = this.subscriptionKey === `${this.config.entity}:${forecastType}` && this.connection === this.hass?.connection;
    const forecast = matching ? this.forecast : undefined;
    const periods = forecastType ? forecastPeriods(forecast, forecastType, zone, now)?.slice(0, this.config.limit ?? (forecastType === "daily" ? 7 : layout === "table" ? 48 : 12)) : null;
    const title = this.config.title ?? ({ current: "Current weather", hourly: "Hourly forecast", daily: "Daily forecast" }[mode]);
    const time = timestamp(entity?.attributes.current_time);
    const fetched = timestamp(entity?.attributes[forecastType === "daily" ? "metoffice_daily_fetched_at" : "fetched_at"]);
    const modelRun = timestamp(entity?.attributes[forecastType === "daily" ? "metoffice_daily_model_run" : "model_run"]);
    const surface = this.config.surface && this.config.surface !== "default" ? this.config.surface : this.globalSurface;
    const empty = html`<p class="empty" role="status">${forecast === undefined && !this.failed ? "Loading forecast…" : "Forecast unavailable. No conditions can be inferred from missing data."}</p>${this.failed ? html`<button class="retry" @click=${this.retry}>Retry forecast</button>` : nothing}`;
    const forecastContent = periods?.length ? layout === "table" ? this.table(periods, units, zone) : this.shortForecast(periods, units, zone) : empty;
    const withCurrent = ["overview", "forecast"].includes(layout), tiny = ["glance", "tile", "strip", "now", "column"].includes(layout);
    return html`<ha-card class=${`${layout}-layout ${surface}`}><div class="brand-bar"><span class="brand">Met Office</span><span class="source">Forecast data · Sky Canvas</span></div><div class="body"><span class="mini-brand">MET OFFICE DATA</span><header><h2>${title}</h2>${layout === "table" ? html`<p class="sub">${mode === "current" ? "Model estimate" : "Forecast"}${mode === "current" && time !== null ? ` · ${displayTime(time, zone)}` : ""}</p>` : nothing}</header>
      ${status !== "ready" ? html`<p class="empty" role="status">${tiny ? status === "stale" ? "Weather out of date" : "Weather unavailable" : status === "stale" ? "Weather data is out of date or its timestamp is unavailable. No conditions can be inferred." : "Weather data is unavailable. No conditions can be inferred."}</p>`
        : !forecastType && current ? this.current(current, units)
          : withCurrent ? html`<div class=${layout === "overview" ? "overview-body" : "forecast-layout"}><div>${current ? this.current(current, units) : html`<p class="empty">Current estimate unavailable</p>`}</div><div class="forecast-layout">${forecastContent}</div></div>` : forecastContent}
      <details class="source-details"><summary aria-label="Details, source and forecast timing">${layout === "overview" ? "Details" : layout === "detail" ? "Details & source" : "Details, source & forecast timing"}</summary><footer class="meta"><p class="sub period-note">${forecastType === "daily" ? "Day precipitation chance covers local dawn to dusk; night low covers the following night. Midday gust covers the preceding 10 minutes." : "Global Spot timing: precipitation chance covers the hour centred on the estimate time. Gust is a 3-second maximum over the previous 10 minutes."}</p>${modelRun !== null ? html`<span>Model run: ${displayTime(modelRun, zone)}</span>` : nothing}${fetched !== null ? html`<span>Last fetched: ${displayTime(fetched, zone)}</span>` : nothing}<div class="actions"><a href=${GUIDE_URL} target="_blank" rel="noopener noreferrer">Symbols and forecast guide</a><a href="https://datahub.metoffice.gov.uk/docs/glossary?sortOrder=ALPHABETICALLY&models=mo-spot-1hr" target="_blank" rel="noopener noreferrer">Global Spot data periods</a><a href="https://www.metoffice.gov.uk/" target="_blank" rel="noopener noreferrer">Powered by Met Office data</a></div><span>Met Office weather symbols. Contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer">Open Government Licence v3.0</a>.</span></footer></details>
    </div></ha-card>`;
  }
}

if (!customElements.get("ha-sky-canvas-weather-card")) customElements.define("ha-sky-canvas-weather-card", SkyCanvasWeatherCard);
const registry = window as unknown as { customCards?: { type: string; name: string; description: string }[] };
registry.customCards ??= [];
if (!registry.customCards.some(card => card.type === "ha-sky-canvas-weather-card")) registry.customCards.push({ type: "ha-sky-canvas-weather-card", name: "Met Office · Sky Canvas", description: "Grid-sized current weather and forecasts, official Met Office symbols, and optional glass backgrounds." });
