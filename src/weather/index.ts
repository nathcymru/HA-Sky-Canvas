import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import type { HomeAssistant } from "../types";
import { GUIDE_URL, currentWeather, displayTime, forecastPeriods, measurement, timestamp, weatherStatus, weatherUnits, windDirection, type WeatherMode, type WeatherPeriod, type WeatherSymbol, type WeatherUnits } from "./model";
import { strongGust, temperatureBand, uvBand, type ColourBand } from "./palette";

export interface WeatherCardConfig { entity: string; mode?: WeatherMode; title?: string; compact?: boolean; limit?: number; }
interface ForecastEvent { forecast: unknown; }

/** Local symbols and HA's converted forecast subscription; no provider HTTP calls. */
export class SkyCanvasWeatherCard extends LitElement {
  static properties = { hass: { attribute: false }, config: { state: true }, forecast: { state: true }, failed: { state: true } };
  static styles = css`
    :host{display:block;color:var(--primary-text-color)}ha-card{display:block;overflow:hidden;padding:20px;border-radius:var(--ha-card-border-radius,16px);background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color)}
    h2{font-size:20px;line-height:1.3;font-weight:550;margin:0 0 6px}p{margin:0;line-height:1.5}.sub,.meta{font-size:12px;color:var(--secondary-text-color)}
    .current{display:grid;grid-template-columns:auto 1fr;gap:12px 18px;align-items:center;margin:20px 0}.symbol{display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center}.symbol img{display:block;width:48px;height:48px;object-fit:contain;flex-shrink:0}.symbol span{font-size:13px;line-height:1.4;white-space:normal;max-width:14em}.current .symbol img{width:84px;height:84px}.current .symbol span{font-size:15px}.temperature{font-size:44px;line-height:1.15;font-variant-numeric:tabular-nums}.compact .temperature{font-size:36px}.compact .current .symbol img{width:64px;height:64px}
    .measurements{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px;margin:16px 0}.measurements div{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:13px;line-height:1.5}.measurements dt{color:var(--secondary-text-color)}dd{margin:0;font-variant-numeric:tabular-nums;text-align:right}
    .scroll{overflow-x:auto;overscroll-behavior-x:contain;margin:16px -4px;padding:0 4px 6px}.scroll:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid var(--primary-color);outline-offset:3px}table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}th,td{padding:12px 10px;border-bottom:1px solid var(--divider-color);text-align:center;vertical-align:middle;min-width:116px;box-sizing:border-box}thead th{font-weight:600;white-space:normal;line-height:1.5}tbody th{font-weight:500;text-align:left}th:first-child{position:sticky;left:0;z-index:1;background:var(--ha-card-background,var(--card-background-color));min-width:132px;max-width:150px;box-shadow:1px 0 var(--divider-color)}td{font-variant-numeric:tabular-nums}.scroll .symbol{min-height:98px}.scroll-hint{font-size:12px;color:var(--secondary-text-color);margin-top:10px}
    .meta{display:grid;gap:7px;padding-top:14px;margin-top:10px;border-top:1px solid var(--divider-color)}a{color:var(--primary-color);text-underline-offset:3px}button{font:inherit;color:var(--primary-color);background:transparent;border:1px solid var(--divider-color);border-radius:8px;min-height:44px;padding:8px 12px;cursor:pointer}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.empty{padding:22px 0;font-size:14px}.neutral{width:48px;height:48px;display:grid;place-items:center;font-size:32px;color:var(--secondary-text-color)}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
    .band{display:inline-block;box-sizing:border-box;padding:5px 9px;border-radius:5px;font-variant-numeric:tabular-nums}.temp-band{min-width:4em;text-align:center}.temperature .temp-band{min-width:2.8em;margin-bottom:5px}.uv-band{font-size:12px;font-weight:600;line-height:1.5;text-align:center}strong{font-weight:750}.scroll .temp-band{display:block}
    @media(max-width:500px){ha-card{padding:16px}.measurements{gap:10px 12px}.measurements div{display:block}.measurements dd{text-align:left}.temperature{font-size:38px}th,td{padding:10px 8px;min-width:112px}th:first-child{min-width:116px;max-width:126px}.symbol span{font-size:12px}}
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

  setConfig(config: WeatherCardConfig): void {
    if (!config || typeof config.entity !== "string" || !/^weather\.[a-z0-9_]+$/.test(config.entity)) throw new Error("Choose a weather entity.");
    if (config.mode !== undefined && !["current", "hourly", "daily"].includes(config.mode)) throw new Error("Choose current, hourly or daily weather.");
    if (config.title !== undefined && (typeof config.title !== "string" || config.title.length > 120)) throw new Error("Use a short weather card title.");
    if (config.compact !== undefined && typeof config.compact !== "boolean") throw new Error("Compact must be true or false.");
    const maxLimit = config.mode === "daily" ? 10 : 72;
    if (config.limit !== undefined && (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > maxLimit)) throw new Error(`Forecast limit must be between 1 and ${maxLimit}.`);
    this.config = { ...config, mode: config.mode ?? "current", compact: config.compact ?? false };
  }
  static getStubConfig(): WeatherCardConfig { return { entity: "weather.metoffice_direct", mode: "current" }; }
  getCardSize(): number { return this.config.mode === "current" ? 4 : 7; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }
  connectedCallback(): void {
    super.connectedCallback();
    this.timer = window.setInterval(() => { if (!document.hidden) this.requestUpdate(); }, 60_000);
    document.addEventListener("visibilitychange", this.visible);
    this.requestUpdate();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
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
    const key = `${this.config.entity}:${this.config.mode}`;
    if (this.subscriptionKey === key && this.connection === this.hass.connection) return;
    this.releaseSubscription();
    this.subscriptionKey = key; this.connection = this.hass.connection;
    this.forecast = undefined; this.failed = false;
    if (this.config.mode === "current") return;
    if (!this.connection) { this.failed = true; return; }
    const generation = this.generation;
    const current = () => this.isConnected && this.generation === generation;
    void this.connection.subscribeMessage<ForecastEvent>((event) => {
      if (current()) { this.forecast = event?.forecast ?? null; this.failed = false; }
    }, { type: "weather/subscribe_forecast", entity_id: this.config.entity, forecast_type: this.config.mode }).then(stop => {
      if (!current()) stop(); else this.unsubscribe = stop;
    }).catch(() => { if (current()) { this.failed = true; this.forecast = null; } });
  }
  private retry = (): void => { this.releaseSubscription(); this.ensureSubscription(); };
  private moreInfo = (): void => { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this.config.entity }, bubbles: true, composed: true })); };
  private symbol(value: WeatherSymbol | null): TemplateResult {
    const usable = value && !this.badSymbols.has(value.url);
    return html`<div class="symbol">${usable ? html`<img src=${value.url} alt="" loading="lazy" decoding="async" @error=${() => { this.badSymbols.add(value.url); this.requestUpdate(); }}>` : html`<span class="neutral" aria-hidden="true">—</span>`}<span>${value?.label ?? "Symbol unavailable"}</span>${value && !usable ? html`<span class="sr-only">Image unavailable</span>` : nothing}</div>`;
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
    const pairs = [
      ["Wind (from)", this.wind(period, units)], ["Gust · previous 10 min", this.gust(period.gust, units.wind)],
      ["Precipitation chance", measurement(period.probability, "%", 0)], ["UV index", this.uv(period.uv)],
      ...(!this.config.compact ? [["Humidity", measurement(period.humidity, "%", 0)], ["Pressure", measurement(period.pressure, units.pressure)]] : []),
    ];
    return html`<div class="current">${this.symbol(period.symbol)}<div><div class="temperature">${this.temperature(period.temperature, units.temperature)}</div><p class="sub">Feels like ${this.temperature(period.feelsLike, units.temperature)}</p></div></div><dl class="measurements">${pairs.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl><p class="sub period-note">Global Spot timing: precipitation chance covers the hour centred on the estimate time. Gust is a 3-second maximum over the previous 10 minutes.</p><button @click=${this.moreInfo}>Weather details</button>`;
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
    const entity = this.hass?.states[this.config.entity], now = Date.now();
    const status = weatherStatus(entity, now, this.config.mode), zone = this.hass?.config.time_zone ?? "UTC";
    const units = weatherUnits(entity), current = currentWeather(entity, now);
    const mode = this.config.mode ?? "current";
    const matching = this.subscriptionKey === `${this.config.entity}:${mode}` && this.connection === this.hass?.connection;
    const forecast = matching ? this.forecast : undefined;
    const periods = mode === "current" ? null : forecastPeriods(forecast, mode, zone, now)?.slice(0, this.config.limit ?? (mode === "daily" ? 7 : 48));
    const title = this.config.title ?? ({ current: "Current weather", hourly: "Hourly forecast", daily: "Daily forecast" }[mode]);
    const time = timestamp(entity?.attributes.current_time);
    const fetched = timestamp(entity?.attributes[mode === "daily" ? "metoffice_daily_fetched_at" : "fetched_at"]);
    const modelRun = timestamp(entity?.attributes[mode === "daily" ? "metoffice_daily_model_run" : "model_run"]);
    return html`<ha-card class=${this.config.compact ? "compact" : ""}><header><h2>${title}</h2><p class="sub">Met Office ${mode === "current" ? "model estimate" : "forecast"}${mode === "current" && time !== null ? ` · ${displayTime(time, zone)}` : ""}</p></header>
      ${status !== "ready" ? html`<p class="empty" role="status">${status === "stale" ? "Weather data is out of date or its timestamp is unavailable." : "Weather data is unavailable."} No ${mode === "current" ? "current conditions" : "forecast conditions"} can be inferred.</p>`
        : mode === "current" && current ? this.current(current, units)
          : periods?.length ? this.table(periods, units, zone)
            : html`<p class="empty" role="status">${forecast === undefined && !this.failed ? "Loading forecast…" : "Forecast unavailable. No conditions can be inferred from missing data."}</p>${this.failed ? html`<button @click=${this.retry}>Retry forecast</button>` : nothing}`}
      <footer class="meta">${modelRun !== null ? html`<span>Model run: ${displayTime(modelRun, zone)}</span>` : nothing}${fetched !== null ? html`<span>Last fetched: ${displayTime(fetched, zone)}</span>` : nothing}<div class="actions"><a href=${GUIDE_URL} target="_blank" rel="noopener noreferrer">Symbols and forecast guide</a><a href="https://datahub.metoffice.gov.uk/docs/glossary?sortOrder=ALPHABETICALLY&models=mo-spot-1hr" target="_blank" rel="noopener noreferrer">Global Spot data periods</a><a href="https://www.metoffice.gov.uk/" target="_blank" rel="noopener noreferrer">Powered by Met Office data</a></div><span>Met Office weather symbols. Contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer">Open Government Licence v3.0</a>.</span></footer>
    </ha-card>`;
  }
}

if (!customElements.get("ha-sky-canvas-weather-card")) customElements.define("ha-sky-canvas-weather-card", SkyCanvasWeatherCard);
const registry = window as unknown as { customCards?: { type: string; name: string; description: string }[] };
registry.customCards ??= [];
if (!registry.customCards.some(card => card.type === "ha-sky-canvas-weather-card")) registry.customCards.push({ type: "ha-sky-canvas-weather-card", name: "Sky Canvas Weather", description: "Met Office current conditions and forecasts with locally stored official symbols." });
