import { LitElement, css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { alertFingerprint, alertTime } from "./model";
import type { AlertFeed, AlertItem } from "./model";

/** Opaque, normal-flow warnings: independent of the decorative scene's opacity. */
export class SkyCanvasWeatherAlerts extends LitElement {
  @property({ attribute: false }) feeds: AlertFeed[] = [];
  @property() timeZone = "Europe/London";
  @state() private announcement = "";
  private fingerprint = "";

  static styles = css`
    :host { display: block; box-sizing: border-box; container-type: inline-size; width: 100%; min-width: 0; color: #17212b; font: 400 14px/1.45 var(--paper-font-body1_-_font-family, system-ui, sans-serif); }
    *, *::before, *::after { box-sizing: border-box; }
    .strip { display: grid; gap: 8px; padding: 12px max(12px, env(safe-area-inset-right)) 12px max(12px, env(safe-area-inset-left)); }
    .feed { min-width: 0; background: #f5f7fa; border: 1px solid #bdc7d1; border-radius: 8px; overflow: hidden; }
    /* Exact public-site severity tokens; provenance and selectors: README.md. */
    .yellow { --accent: #ffe923; }
    .amber { --accent: #ff9900; }
    .red { --accent: #ca0a37; }
    .flood_alert { --accent: #eb7100; }
    .flood_warning, .severe_flood_warning { --accent: #c40000; }
    .warning { border-inline-start: 7px solid var(--accent); background: #fff; }
    .weather-list { display: grid; gap: 8px; }
    summary { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 10px; align-items: start; min-height: 60px; padding: 12px; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .weather summary { grid-template-columns: minmax(0, 1fr) auto; }
    summary::marker { content: ""; }
    summary:focus-visible, a:focus-visible { outline: 3px solid #174ea6; outline-offset: -3px; border-radius: 4px; }
    .symbol { width: 30px; height: 30px; flex-shrink: 0; }
    .symbol path { fill: var(--accent, #536477); stroke: #17212b; stroke-width: 1.2px; }
    .symbol text { fill: #17212b; font: 800 21px system-ui; }
    .red .symbol text, .flood_warning .symbol text, .severe_flood_warning .symbol text { fill: white; }
    .source { font-weight: 600; font-size: 12px; display: block; letter-spacing: .02em; }
    .title { display: block; font-weight: 750; font-size: 16px; line-height: 1.4; }
    .headline, .timing, .scope { display: block; overflow-wrap: anywhere; }
    .headline { margin-top: 2px; }
    .timing, .scope { font-size: 12px; margin-top: 3px; }
    .status { display: inline-block; padding: 1px 5px; border: 1px solid currentColor; border-radius: 4px; font-size: 11px; font-weight: 650; margin-inline-start: 5px; vertical-align: 2px; }
    .expand { display: flex; align-items: center; min-height: 44px; gap: 5px; font-size: 12px; white-space: nowrap; }
    .chevron { font-size: 20px; line-height: 1; }
    details[open] > summary .chevron { transform: rotate(180deg); }
    .body { padding: 0 14px 12px; border-top: 1px solid #17212b30; }
    .item { padding-top: 12px; }
    .item + .item { margin-top: 12px; border-top: 1px solid #17212b30; }
    h3 { margin: 0; font-size: 15px; line-height: 1.45; }
    p { margin: 6px 0; overflow-wrap: anywhere; }
    ul { padding-inline-start: 22px; margin: 8px 0; }
    li { margin: 5px 0; overflow-wrap: anywhere; }
    .description { white-space: pre-line; }
    .meta { font-size: 12px; }
    a { display: inline-flex; align-items: center; min-height: 44px; color: #123d72; text-underline-offset: 3px; font-weight: 600; overflow-wrap: anywhere; }
    .unknown { padding: 12px 14px; border-inline-start: 7px solid #536477; }
    .unknown strong { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    @container (max-width: 480px) {
      summary { grid-template-columns: 26px minmax(0, 1fr); gap: 8px; padding: 10px; }
      .symbol { width: 25px; height: 25px; }
      .expand { grid-column: 2; min-height: 28px; }
      .weather summary { grid-template-columns: minmax(0, 1fr); }
      .weather .expand { grid-column: 1; }
      .title { font-size: 15px; }
      .strip { padding: 8px; }
    }
    @media (forced-colors: active) {
      .feed { border: 2px solid CanvasText; }
      .symbol { forced-color-adjust: auto; }
    }
  `;

  protected willUpdate(): void {
    const fingerprint = alertFingerprint(this.feeds);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    // A fetch timestamp alone is not an alert change. Announce once per material
    // update; keep the visible content available without taking keyboard focus.
    this.announcement = this.feeds.map(feed => {
      if (feed.status === "clear") return `${feed.source}: no current warnings in the configured area.`;
      if (feed.status !== "warnings") return `${feed.source} warning information ${feed.status === "stale" ? "is out of date" : "is unavailable"}. ${feed.notice ?? "Check the official source."}`;
      const top = feed.items[0];
      return top ? `${feed.source}: ${top.label}, ${top.timing === "upcoming" ? "upcoming, " : ""}${top.headline.slice(0, 200)}. ${feed.items.length} issued warning${feed.items.length === 1 ? "" : "s"}; full details available.` : "";
    }).join(" ");
  }

  private timing(item: AlertItem): string {
    if (item.validFrom === null) return `In force · ${item.advice[0] ?? "Follow Natural Resources Wales advice"}`;
    return `${item.timing === "upcoming" ? "Upcoming" : "In force"} · ${alertTime(item.validFrom, "Europe/London")} – ${alertTime(item.validTo, "Europe/London")}`;
  }

  private warning(feed: AlertFeed): TemplateResult | typeof nothing {
    // Every weather type/level is visible initially, including overlapping and
    // dual warnings. Full source text remains in each native Details disclosure.
    if (feed.kind === "weather" && feed.items.length > 1) return html`<div class="weather-list">${repeat(feed.items, item => item.id, item => this.warning({ ...feed, items: [item] }))}</div>`;
    const top = feed.items[0];
    if (!top) return nothing;
    const active = feed.items.filter(item => item.timing === "active").length;
    const upcoming = feed.items.length - active;
    const count = [active ? `${active} in force` : "", upcoming ? `${upcoming} upcoming` : ""].filter(Boolean).join(" · ");
    return html`<details class="feed warning ${feed.kind} ${top.severity}">
      <summary>
        ${feed.kind === "flood" ? html`<svg class="symbol" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 2 31 29H1Z"/><text x="16" y="25" text-anchor="middle">!</text></svg>` : nothing}
        <span>
          <span class="source">${top.attribution ?? feed.source}</span>
          <span class="title">${top.label}${top.weatherTypes?.length ? ` · ${top.weatherTypes.join(" & ")}` : ""}${top.timing === "upcoming" ? html`<span class="status">Upcoming</span>` : nothing}</span>
          ${top.statusText ? html`<span class="status">${top.statusText}</span>` : nothing}
          <span class="headline">${top.headline.length > 240 ? `${top.headline.slice(0, 240)}…` : top.headline}</span>
          <span class="timing">${this.timing(top)}</span>
          <span class="scope">${top.scope}</span>
        </span>
        <span class="expand">${count} · Details <span class="chevron" aria-hidden="true">⌄</span></span>
      </summary>
      <div class="body">
        ${repeat(feed.items, item => item.id, item => html`<article class="item">
          <h3>${item.label}${item.weatherTypes?.length ? ` · ${item.weatherTypes.join(" & ")}` : ""}</h3>
          <p>${item.headline}</p>
          <p class="meta">${this.timing(item)}</p>
          <p class="meta">${item.scope}</p>
          ${item.updateDescription ? html`<h3>Warning update</h3><p class="description">${item.updateDescription}</p>` : nothing}
          ${item.expected?.length ? html`<h3>What to expect</h3><ul>${item.expected.map(line => html`<li class="description">${line}</li>`)}</ul>` : nothing}
          ${item.advice.length ? html`${feed.kind === "weather" ? html`<h3>What should I do?</h3>` : nothing}<ul>${item.advice.map(line => html`<li class="description">${line}</li>`)}</ul>` : nothing}
          ${feed.kind === "weather" ? html`<a href="https://www.metoffice.gov.uk/weather/warnings-and-advice/seasonal-advice" target="_blank" rel="noopener noreferrer">What should I do? Read Met Office severe weather advice<span class="sr-only"> (opens a new tab)</span></a>` : nothing}
          ${item.details ? html`${feed.kind === "weather" ? html`<h3>Further details</h3>` : nothing}<p class="description">${item.details}</p>` : nothing}
          ${item.issuedAt != null ? html`<p class="meta">Issued ${alertTime(item.issuedAt, "Europe/London")}</p>` : nothing}
          ${item.updatedAt !== null ? html`<p class="meta">Warning updated ${alertTime(item.updatedAt, feed.kind === "weather" ? "Europe/London" : this.timeZone)}</p>` : nothing}
          <a href=${item.url} target="_blank" rel="noopener noreferrer">Read ${feed.kind === "weather" ? "Met Office" : "NRW"} warning and advice<span class="sr-only"> (opens a new tab)</span></a>
        </article>`)}
        <p class="meta">Checked ${alertTime(feed.fetchedAt, this.timeZone)}</p>
      </div>
    </details>`;
  }

  protected render() {
    const visible = this.feeds.filter(feed => feed.status !== "clear");
    return html`
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.announcement}</div>
      ${visible.length ? html`<section class="strip" aria-label="Weather and flood warnings">
        ${repeat(visible, feed => feed.kind, feed => feed.status === "warnings" ? this.warning(feed) : html`
          <div class="feed unknown">
            <span class="source">${feed.source}</span>
            <strong>${feed.kind === "weather" ? "Weather" : "Flood"} warning information ${feed.status === "stale" ? "is out of date" : "is unavailable"}</strong>
            <p>${feed.notice ?? "Current warning status cannot be confirmed. Check the official source."}</p>
            ${feed.fetchedAt !== null ? html`<p class="meta">Last checked ${alertTime(feed.fetchedAt, this.timeZone)}</p>` : nothing}
            <a href=${feed.url} target="_blank" rel="noopener noreferrer">Check ${feed.kind === "weather" ? "Met Office" : "NRW"} warnings<span class="sr-only"> (opens a new tab)</span></a>
          </div>`)}
      </section>` : nothing}`;
  }
}

if (!customElements.get("ha-sky-canvas-weather-alerts")) customElements.define("ha-sky-canvas-weather-alerts", SkyCanvasWeatherAlerts);
