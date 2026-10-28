import { LitElement, html, nothing, type PropertyValues } from "lit";
import type { Dashboard, HomeAssistant, ImageSlot, SkyConfig, SkyTheme } from "../types";
import { availableDashboards, BUILTIN_THEMES, errorMessage, SettingsDrafts, validateTheme } from "./model";
import { styles } from "./styles";

const slots: ImageSlot[] = ["clear_day", "clear_night", "rain_day", "rain_night", "frost_day", "frost_night", "snow_day", "snow_night"];
const titleCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const isGlobal = (id: string): boolean => id === "settings" || id === "dashboards";

/** Authenticated thumbnails never place a bearer token in a visible image URL. */
class SkyImagePreview extends LitElement {
  static properties = { hass: { attribute: false }, imageId: { type: String }, label: { type: String }, _url: { state: true }, _error: { state: true } };
  declare hass: HomeAssistant;
  declare imageId: string;
  label = "";
  private _url = "";
  private _error = false;
  private controller?: AbortController;
  private request = 0;

  connectedCallback(): void {
    super.connectedCallback();
    // HA can detach and reconnect a panel without changing its image properties.
    if (this.hasUpdated && this.imageId && this.hass) void this.load();
  }
  protected updated(changed: PropertyValues): void {
    if (changed.has("imageId") || (!this._url && !this._error && changed.has("hass") && !this.controller)) void this.load();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.controller?.abort();
    this.request++;
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = "";
    this.controller = undefined;
  }
  private async load(): Promise<void> {
    this.controller?.abort();
    const request = ++this.request;
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = "";
    this._error = false;
    if (!this.imageId || !this.hass) return;
    this.controller = new AbortController();
    try {
      const response = await this.hass.fetchWithAuth(`/api/ha_sky_canvas/image/${encodeURIComponent(this.imageId)}?thumbnail=1`, { signal: this.controller.signal });
      if (!response.ok) throw new Error("Preview unavailable");
      const blob = await response.blob();
      if (request === this.request && this.isConnected) this._url = URL.createObjectURL(blob);
    } catch (error) {
      if (request === this.request && !(error instanceof DOMException && error.name === "AbortError")) this._error = true;
    } finally { if (request === this.request) this.controller = undefined; }
  }
  render() {
    return html`<style>:host{display:block;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:cover}span{display:grid;place-items:center;height:100%;font:13px sans-serif;color:var(--secondary-text-color,#64748b)}button{font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;padding:8px;cursor:pointer}</style>${this._url ? html`<img src=${this._url} alt=${this.label} loading="lazy">` : html`<span>${this._error ? html`<button @click=${this.load}>Retry preview</button>` : "Loading preview…"}</span>`}`;
  }
}
if (!customElements.get("ha-sky-canvas-image-preview")) customElements.define("ha-sky-canvas-image-preview", SkyImagePreview);

export class SkyCanvasSettings extends LitElement {
  static properties = {
    hass: { attribute: false }, panel: { attribute: false }, narrow: { type: Boolean },
    session: { state: true }, active: { state: true }, busy: { state: true }, error: { state: true }, notice: { state: true },
    dashboards: { state: true }, dashboardsError: { state: true }, dashboardsLoading: { state: true }, uploadSlot: { state: true },
    pendingTab: { state: true }, newName: { state: true }, newNameError: { state: true },
  };
  static styles = styles;
  declare hass: HomeAssistant;
  declare panel: unknown;
  narrow = false;
  private session?: SettingsDrafts;
  private active = "default";
  private busy = false;
  private error = "";
  private notice = "";
  private dashboards: Dashboard[] = [];
  private dashboardsError = "";
  private dashboardsLoading = false;
  private uploadSlot = "";
  private pendingTab = "";
  private newName = "";
  private newNameError = "";
  private unsubscribe?: () => void;
  private loading = false;
  private generation = 0;
  private returnFocus?: HTMLElement;
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.session?.hasChanges) { event.preventDefault(); event.returnValue = ""; }
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("beforeunload", this.beforeUnload);
    if (this.hass && !this.unsubscribe) void this.load();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.loading = false;
    window.removeEventListener("beforeunload", this.beforeUnload);
  }
  protected updated(changed: PropertyValues): void {
    if (changed.has("hass") && this.hass && !this.session && !this.loading) void this.load();
  }

  private async load(): Promise<void> {
    if (this.loading || !this.hass) return;
    this.loading = true;
    this.error = "";
    const generation = ++this.generation;
    this.requestUpdate();
    try {
      let pendingConfig: SkyConfig | undefined;
      // Subscribe before reading so a save between GET and subscription is never lost.
      if (this.hass.connection && !this.unsubscribe) {
        const unsubscribe = await this.hass.connection.subscribeMessage<SkyConfig>(config => {
          if (generation !== this.generation || !this.isConnected) return;
          if (!this.session) {
            if (!pendingConfig || config.revision >= pendingConfig.revision) pendingConfig = config;
            return;
          }
          const hadChanges = this.session.hasChanges && config.revision > this.session.config.revision;
          this.session.receive(config);
          if (this.active === "dashboards" && this.session.settings.value.applyToAll) this.active = "settings";
          if (!isGlobal(this.active) && !this.session.themes.has(this.active)) this.active = "default";
          if (hadChanges) this.notice = "Saved settings changed. Your unsaved draft has been kept.";
          this.requestUpdate();
        }, { type: "ha_sky_canvas/subscribe" });
        if (generation !== this.generation || !this.isConnected) unsubscribe(); else this.unsubscribe = unsubscribe;
      }
      if (generation !== this.generation || !this.isConnected) return;
      const response = await this.hass.callWS<SkyConfig>({ type: "ha_sky_canvas/config" });
      if (generation !== this.generation || !this.isConnected) return;
      const config = pendingConfig && pendingConfig.revision > response.revision ? pendingConfig : response;
      if (this.session) this.session.receive(config); else this.session = new SettingsDrafts(config);
      await this.loadDashboards();
    } catch (error) {
      if (generation === this.generation) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.error = errorMessage(error);
      }
    } finally {
      if (generation === this.generation) { this.loading = false; this.requestUpdate(); }
    }
  }

  private async loadDashboards(): Promise<void> {
    this.dashboardsLoading = true;
    this.dashboardsError = "";
    try {
      const dashboards = await this.hass.callWS<Dashboard[]>({ type: "lovelace/dashboards/list" });
      this.dashboards = availableDashboards(dashboards, this.hass.panels);
    } catch {
      this.dashboardsError = "The dashboard list could not be loaded. Your current selection is unchanged.";
    } finally { this.dashboardsLoading = false; }
  }

  private change(): void { this.notice = ""; this.error = ""; this.requestUpdate(); }
  private tabs(): { id: string; name: string }[] {
    if (!this.session) return [];
    return [
      { id: "settings", name: "Settings" },
      ...(!this.session.settings.value.applyToAll ? [{ id: "dashboards", name: "Dashboards" }] : []),
      ...[...this.session.themes.values()].map(({ value }) => ({ id: value.id, name: value.name })),
    ];
  }

  private async navigate(id: string): Promise<void> {
    if (id === this.active || this.busy || this.uploadSlot) return;
    if (this.session?.isDirty(this.active) && !(isGlobal(id) && isGlobal(this.active))) {
      this.pendingTab = id;
      await this.openDialog("unsaved-dialog");
      return;
    }
    this.active = id;
    this.error = "";
    this.notice = "";
  }
  private async tabKey(event: KeyboardEvent, id: string): Promise<void> {
    const tabs = this.tabs();
    const index = tabs.findIndex(tab => tab.id === id);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    // Manual activation keeps an arrow key from discarding or saving a draft.
    this.renderRoot.querySelector<HTMLButtonElement>(`#tab-${tabs[next].id}`)?.focus();
  }
  private async openDialog(id: string): Promise<void> {
    this.returnFocus = (this.renderRoot as ShadowRoot).activeElement as HTMLElement | undefined;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLDialogElement>(`#${id}`)?.showModal();
  }
  private closeDialog(id: string): void {
    this.renderRoot.querySelector<HTMLDialogElement>(`#${id}`)?.close();
    this.returnFocus?.focus();
  }
  private stay(event?: Event): void {
    event?.preventDefault();
    if (this.busy) return;
    this.pendingTab = "";
    this.closeDialog("unsaved-dialog");
  }
  private async finishNavigation(save: boolean): Promise<void> {
    if (!this.session || this.busy) return;
    if (save && !(await this.save())) return;
    if (!save) this.session.discard(this.active);
    const destination = this.pendingTab;
    this.closeDialog("unsaved-dialog");
    this.pendingTab = "";
    this.active = destination;
    this.error = "";
    this.notice = "";
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLButtonElement>(`#tab-${destination}`)?.focus();
  }

  private async save(): Promise<boolean> {
    if (!this.session || this.busy || this.uploadSlot) return false;
    const scope = this.active;
    this.error = "";
    if (!isGlobal(scope)) {
      const theme = this.session.themes.get(scope)?.value;
      if (!theme) return false;
      const issue = validateTheme(theme);
      if (issue) { this.error = issue; return false; }
    } else if (!this.session.settings.value.weatherEntity || !this.session.settings.value.weatherEntity.startsWith("weather.")) {
      this.error = "Choose the weather entity that should drive the scene.";
      return false;
    }
    this.busy = true;
    try {
      let config: SkyConfig;
      if (isGlobal(scope)) {
        config = await this.hass.callWS<SkyConfig>({ type: "ha_sky_canvas/save_settings", revision: this.session.settings.revision, settings: structuredClone(this.session.settings.value) });
      } else {
        const theme = this.session.themes.get(scope)!;
        const value = structuredClone(theme.value);
        if (value.schedule && !value.schedule.start && !value.schedule.end) value.schedule = null;
        config = await this.hass.callWS<SkyConfig>({ type: "ha_sky_canvas/save_theme", revision: theme.revision, theme: value });
      }
      this.session.receive(config, scope);
      this.notice = "Changes saved. The scene will update automatically.";
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      // Refresh the committed baseline without discarding a conflicting draft.
      try { this.session.receive(await this.hass.callWS<SkyConfig>({ type: "ha_sky_canvas/config" })); } catch { /* Retry remains available. */ }
      return false;
    } finally { this.busy = false; this.requestUpdate(); }
  }
  private discard(): void {
    if (!this.session || this.busy) return;
    this.session.discard(this.active);
    if (!isGlobal(this.active) && !this.session.themes.has(this.active)) this.active = "default";
    this.error = "";
    this.notice = "Unsaved changes discarded.";
    this.requestUpdate();
  }

  private async addTheme(): Promise<void> {
    this.newName = "";
    this.newNameError = "";
    await this.openDialog("new-theme-dialog");
  }
  private async confirmNewTheme(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.session) return;
    const name = this.newName.trim();
    if (!name || name.length > 60) { this.newNameError = "Use a theme name between 1 and 60 characters."; return; }
    if ([...this.session.themes.values()].some(theme => theme.value.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      this.newNameError = "A theme with this name already exists."; return;
    }
    // getRandomValues also works on the local HTTP origin commonly used by HA.
    const id = `custom_${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    this.session.addTheme(id, name);
    this.closeDialog("new-theme-dialog");
    await this.navigate(id);
    this.requestUpdate();
  }

  private updateDate(theme: SkyTheme, field: "start" | "end", value: string): void {
    const schedule = theme.schedule ?? { start: "", end: "", annual: true };
    theme.schedule = { ...schedule, [field]: schedule.annual ? value.slice(5) : value };
    this.change();
  }
  private updateAnnual(theme: SkyTheme, annual: boolean): void {
    const schedule = theme.schedule ?? { start: "", end: "", annual: true };
    const convert = (side: "start" | "end"): string => {
      const value = schedule[side];
      return !value ? "" : annual ? value.slice(-5) : this.dateValue(theme, side);
    };
    theme.schedule = { annual, start: convert("start"), end: convert("end") };
    this.change();
  }
  private dateValue(theme: SkyTheme, side: "start" | "end"): string {
    const value = theme.schedule?.[side];
    if (!value) return "";
    if (!theme.schedule?.annual) return value;
    let year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: this.hass.config.time_zone }).format(new Date()));
    if (side === "end" && value < theme.schedule.start) year++;
    // Keep a saved leap-day selection valid when the current year is not a leap year.
    if (value === "02-29") while (new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) year++;
    return `${year}-${value}`;
  }

  private async upload(event: Event, slot: ImageSlot, theme: SkyTheme): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || this.busy || this.uploadSlot) return;
    this.uploadSlot = slot;
    const session = this.session!;
    session.beginPendingChange(theme.id);
    this.error = "";
    this.notice = "";
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await this.hass.fetchWithAuth("/api/ha_sky_canvas/upload", { method: "POST", body });
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        throw new Error(result && typeof result === "object" && "message" in result ? String(result.message) : `Image upload failed (${response.status}). Try another PNG, JPEG or WebP image.`);
      }
      const result = await response.json() as { id?: string };
      if (!result.id) throw new Error("The upload returned no image. Please try again.");
      theme.images[slot] = result.id;
      this.notice = "Image uploaded to this draft. Choose Save Changes to use it in the scene.";
    } catch (error) { this.error = errorMessage(error); }
    finally { session.finishPendingChange(theme.id); this.uploadSlot = ""; this.requestUpdate(); }
  }

  private renderTheme(theme: SkyTheme) {
    const isDefault = theme.id === "default";
    return html`
      <div class="panel-heading"><div><h2>${theme.name}</h2><p class="muted">${isDefault ? "Your everyday house scenes. Other themes use these images wherever their own slots are empty." : "Choose the house scene for each condition. Empty slots use the matching Default image."}</p></div></div>
      ${!BUILTIN_THEMES.has(theme.id) ? html`<div class="card"><label class="field"><span>Theme name</span><input maxlength="60" .value=${theme.name} @input=${(event: Event) => { theme.name = (event.target as HTMLInputElement).value; this.change(); }}></label></div>` : nothing}
      ${!isDefault ? html`<div class="card">
        <div class="switch-row"><label for="theme-enabled"><strong>Enable ${theme.name}</strong><small>Use this theme during its dates. When schedules overlap, the priority order in Settings decides which runs.</small></label><input class="switch" id="theme-enabled" role="switch" type="checkbox" .checked=${theme.enabled} @change=${(event: Event) => { theme.enabled = (event.target as HTMLInputElement).checked; this.change(); }}></div>
        <div class="controls">
          <label class="field"><span>Runs from</span><input type="date" .value=${this.dateValue(theme, "start")} @change=${(event: Event) => this.updateDate(theme, "start", (event.target as HTMLInputElement).value)}></label>
          <label class="field"><span>Runs to · inclusive</span><input type="date" .value=${this.dateValue(theme, "end")} @change=${(event: Event) => this.updateDate(theme, "end", (event.target as HTMLInputElement).value)}></label>
          <label class="check"><input type="checkbox" .checked=${theme.schedule?.annual ?? true} @change=${(event: Event) => this.updateAnnual(theme, (event.target as HTMLInputElement).checked)}>Repeat every year</label>
        </div>
        <p class="help">${theme.schedule?.annual ?? true ? "Repeats each year on the chosen day and month. A December-to-January range continues across New Year." : "This schedule runs once, on the selected dates."} Dates follow ${this.hass.config.time_zone}.</p>
      </div>` : nothing}
      <div class="images">${slots.map(slot => {
        const [condition, period] = slot.split("_");
        const populated = Boolean(theme.images[slot]);
        const label = `${theme.name}, ${titleCase(condition)}, ${titleCase(period)}`;
        return html`<section class="slot" aria-label=${label}>
          <div class="slot-label"><strong>${titleCase(condition)}</strong><small>${titleCase(period)}</small></div>
          <div class="preview">${populated ? html`<ha-sky-canvas-image-preview .hass=${this.hass} .imageId=${theme.images[slot]} .label=${label}></ha-sky-canvas-image-preview>` : nothing}</div>
          <input class="sr-only" tabindex="-1" id=${`upload-${slot}`} type="file" accept="image/png,image/jpeg,image/webp" aria-label=${`Choose image for ${label}`} @change=${(event: Event) => this.upload(event, slot, theme)}>
          <div class="slot-actions"><button class="button" ?disabled=${this.busy || Boolean(this.uploadSlot)} aria-label=${`${populated ? "Replace" : "Upload"} image for ${label}`} @click=${() => this.renderRoot.querySelector<HTMLInputElement>(`#upload-${slot}`)?.click()}><span aria-hidden="true">${populated ? "↻" : "+"}</span>${this.uploadSlot === slot ? "Uploading…" : populated ? "Replace" : "Upload image"}</button></div>
        </section>`;
      })}</div>
      <p class="help">PNG, JPEG or WebP. Images stay in your draft until saved. Weather animations use these eight scenes independently.</p>
    `;
  }

  private renderSettings() {
    const settings = this.session!.settings.value;
    const weather = Object.entries(this.hass.states).filter(([id]) => id.startsWith("weather.")).sort(([a], [b]) => a.localeCompare(b));
    const frost = Object.entries(this.hass.states).filter(([id]) => id.startsWith("input_boolean.") || id.startsWith("binary_sensor.")).sort(([a], [b]) => a.localeCompare(b));
    const priority = settings.priority.filter(id => id !== "default" && this.session!.config.themes.some(theme => theme.id === id));
    return html`
      <div class="panel-heading"><div><h2>Your sky, your home</h2><p class="muted">Choose the weather source, where the scene appears, and how seasonal themes take turns.</p></div></div>
      <div class="card"><div class="controls">
        <label class="field"><span>Weather source</span><select .value=${settings.weatherEntity} @change=${(event: Event) => { settings.weatherEntity = (event.target as HTMLSelectElement).value; this.change(); }}><option value="" .selected=${!settings.weatherEntity}>Choose a weather entity</option>${settings.weatherEntity && !this.hass.states[settings.weatherEntity] ? html`<option value=${settings.weatherEntity} .selected=${true}>${settings.weatherEntity} · unavailable</option>` : nothing}${weather.map(([id, state]) => html`<option value=${id} .selected=${id === settings.weatherEntity}>${String(state?.attributes.friendly_name || id)}${state?.state === "unavailable" ? " · unavailable" : ""}</option>`)}</select><small class="help">Use your configured Met Office weather entity.</small></label>
        <label class="field"><span>Frost indicator · optional</span><select .value=${settings.frostEntity ?? ""} @change=${(event: Event) => { settings.frostEntity = (event.target as HTMLSelectElement).value || null; this.change(); }}><option value="" .selected=${!settings.frostEntity}>No frost indicator</option>${settings.frostEntity && !this.hass.states[settings.frostEntity] ? html`<option value=${settings.frostEntity} .selected=${true}>${settings.frostEntity} · unavailable</option>` : nothing}${frost.map(([id, state]) => html`<option value=${id} .selected=${id === settings.frostEntity}>${String(state?.attributes.friendly_name || id)}</option>`)}</select><small class="help">Uses an existing frost boolean; rain and snow scenes take priority.</small></label>
      </div></div>
      <div class="card"><div class="switch-row"><label for="all-dashboards"><strong>Apply to all dashboards</strong><small>Include every Lovelace dashboard. Turn this off to choose individual dashboards in the Dashboards tab.</small></label><input class="switch" id="all-dashboards" role="switch" type="checkbox" .checked=${settings.applyToAll} @change=${(event: Event) => { settings.applyToAll = (event.target as HTMLInputElement).checked; this.change(); }}></div></div>
      <div class="card"><h3>Theme priority</h3><p class="help">When enabled schedules overlap, the first matching theme wins. Default is always the fallback.</p>
        <ol class="priority">${priority.map((id, index) => html`<li><span class="order" aria-hidden="true">${index + 1}</span><span class="theme-name">${this.session!.config.themes.find(theme => theme.id === id)?.name}</span><button class="button" ?disabled=${index === 0 || this.busy} aria-label=${`Move ${this.session!.config.themes.find(theme => theme.id === id)?.name} higher`} @click=${() => this.movePriority(id, -1)}>↑</button><button class="button" ?disabled=${index === priority.length - 1 || this.busy} aria-label=${`Move ${this.session!.config.themes.find(theme => theme.id === id)?.name} lower`} @click=${() => this.movePriority(id, 1)}>↓</button></li>`)}</ol>
      </div>
      <div class="card"><div class="controls"><label class="field"><span>Animation detail</span><select .value=${settings.quality} @change=${(event: Event) => { settings.quality = (event.target as HTMLSelectElement).value as SkyConfig["quality"]; this.change(); }}><option value="low">Low · lighter on tablets</option><option value="medium">Medium</option><option value="high">High</option></select></label></div><p class="help">Animations pause in hidden tabs and respect your device’s reduced-motion preference.</p><div class="switch-row" style="margin-top:20px"><label for="lightning"><strong>Lightning flashes</strong><small>Optional flashes during thunderstorms. Off by default.</small></label><input class="switch" id="lightning" role="switch" type="checkbox" .checked=${settings.lightning} @change=${(event: Event) => { settings.lightning = (event.target as HTMLInputElement).checked; this.change(); }}></div></div>
    `;
  }
  private movePriority(id: string, direction: number): void {
    const priority = this.session!.settings.value.priority;
    const index = priority.indexOf(id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= priority.length || priority[next] === "default") return;
    [priority[index], priority[next]] = [priority[next], priority[index]];
    this.change();
  }
  private renderDashboards() {
    const settings = this.session!.settings.value;
    const unknown = settings.dashboards.filter(path => !this.dashboards.some(dashboard => dashboard.url_path === path));
    return html`<div class="panel-heading"><div><h2>Choose your dashboards</h2><p class="muted">The scene appears behind dashboard cards and controls. Select where it belongs.</p></div></div>
      ${this.dashboardsError ? html`<div class="notice error" role="alert">${this.dashboardsError} <button class="button" @click=${this.loadDashboards}>Retry</button></div>` : nothing}
      <div class="card">${this.dashboardsLoading ? html`<p role="status">Loading dashboards…</p>` : this.dashboards.length ? this.dashboards.map(dashboard => html`<label class="dashboard"><input type="checkbox" .checked=${settings.dashboards.includes(dashboard.url_path)} @change=${(event: Event) => { settings.dashboards = (event.target as HTMLInputElement).checked ? [...new Set([...settings.dashboards, dashboard.url_path])] : settings.dashboards.filter(path => path !== dashboard.url_path); this.change(); }}><span>${dashboard.title}<small>/${dashboard.url_path}</small></span></label>`) : html`<p class="muted">No Lovelace dashboards were returned by this installation.</p>`}</div>
      ${unknown.length ? html`<p class="help">Saved selections not currently listed: ${unknown.join(", ")}. They will be preserved.</p>` : nothing}
      <button class="button" ?disabled=${this.dashboardsLoading} @click=${this.loadDashboards}>Refresh dashboards</button>`;
  }
  private renderSavebar() {
    const dirty = this.session!.isDirty(this.active);
    return html`<div class="savebar"><p>${this.uploadSlot ? "Image upload in progress…" : dirty ? "You have unsaved changes." : "All changes saved."}</p><div class="actions"><button class="button" ?disabled=${!dirty || this.busy || Boolean(this.uploadSlot)} @click=${this.discard}>Discard</button><button class="button primary" ?disabled=${!dirty || this.busy || Boolean(this.uploadSlot)} @click=${this.save}>${this.busy ? "Saving…" : "Save Changes"}</button></div></div>`;
  }

  render() {
    const theme = this.session?.themes.get(this.active)?.value;
    return html`<div class="shell">
      <header><ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button><span class="brand" aria-hidden="true">☀</span><div><h1>HA Sky Canvas</h1><p>A living backdrop for your home.</p></div></header>
      ${!this.session ? html`${this.error ? html`<div class="notice error" role="alert">${this.error}</div><button class="button" @click=${this.load}>Retry</button>` : html`<p role="status">Loading your scenes…</p>`}` : html`
        <nav class="tabs" role="tablist" aria-label="Sky Canvas settings">${this.tabs().map(tab => html`<button id=${`tab-${tab.id}`} class="tab" role="tab" aria-controls="settings-panel" aria-selected=${this.active === tab.id} tabindex=${this.active === tab.id ? 0 : -1} ?disabled=${this.busy || Boolean(this.uploadSlot)} @click=${() => this.navigate(tab.id)} @keydown=${(event: KeyboardEvent) => this.tabKey(event, tab.id)}>${tab.name}${this.session!.isDirty(tab.id) ? html`<span class="tab-dot" aria-label="unsaved changes"></span>` : nothing}</button>`)}</nav>
        <button class="add" style="margin-top:14px" ?disabled=${this.busy || Boolean(this.uploadSlot)} @click=${this.addTheme}>+ Add theme</button>
        <main class="panel" id="settings-panel" role="tabpanel" aria-labelledby=${`tab-${this.active}`}>
          <fieldset ?disabled=${this.busy}>${this.active === "settings" ? this.renderSettings() : this.active === "dashboards" ? this.renderDashboards() : theme ? this.renderTheme(theme) : nothing}</fieldset>
          ${this.error ? html`<div class="notice error" role="alert">${this.error}</div>` : nothing}
          ${this.notice ? html`<div class="notice success" role="status">${this.notice}</div>` : nothing}
          ${this.renderSavebar()}
        </main>`}
      <dialog id="unsaved-dialog" aria-labelledby="unsaved-title" aria-describedby="unsaved-description" @cancel=${this.stay}>
        <h2 id="unsaved-title">Save your changes?</h2><p id="unsaved-description">This tab has unsaved changes. Save them before leaving, discard them, or stay here to keep editing.</p>
        ${this.error ? html`<div class="notice error" role="alert">${this.error}</div>` : nothing}
        <div class="actions"><button class="button" ?disabled=${this.busy} @click=${this.stay}>Stay</button><button class="button" ?disabled=${this.busy} @click=${() => this.finishNavigation(false)}>Discard</button><button class="button primary" ?disabled=${this.busy} @click=${() => this.finishNavigation(true)}>${this.busy ? "Saving…" : "Save Changes"}</button></div>
      </dialog>
      <dialog id="new-theme-dialog" aria-labelledby="new-theme-title" @cancel=${(event: Event) => { event.preventDefault(); this.closeDialog("new-theme-dialog"); }}><form @submit=${this.confirmNewTheme}>
        <h2 id="new-theme-title">Add a theme</h2><p class="muted">Start with eight blank image slots, then choose when your theme runs.</p><label class="field"><span>Theme name</span><input autofocus required maxlength="60" .value=${this.newName} @input=${(event: Event) => { this.newName = (event.target as HTMLInputElement).value; this.newNameError = ""; }}></label>
        ${this.newNameError ? html`<p class="error" role="alert">${this.newNameError}</p>` : nothing}
        <div class="actions"><button type="button" class="button" @click=${() => this.closeDialog("new-theme-dialog")}>Cancel</button><button type="submit" class="button primary">Add theme</button></div>
      </form></dialog>
    </div>`;
  }
}
if (!customElements.get("ha-sky-canvas-settings")) customElements.define("ha-sky-canvas-settings", SkyCanvasSettings);
