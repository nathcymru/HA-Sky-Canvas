import type { HassEntity } from "../types";

export type AlertKind = "weather" | "flood";
export type AlertStatus = "warnings" | "clear" | "unavailable" | "stale";
export type AlertSeverity = "yellow" | "amber" | "red" | "flood_alert" | "flood_warning" | "severe_flood_warning";
export interface AlertItem {
  id: string;
  revision: string;
  severity: AlertSeverity;
  rank: number;
  label: string;
  headline: string;
  timing: "active" | "upcoming";
  validFrom: number | null;
  validTo: number | null;
  updatedAt: number | null;
  issuedAt?: number | null;
  statusText?: string;
  weatherTypes?: string[];
  expected?: string[];
  attribution?: string;
  updateDescription?: string;
  scope: string;
  advice: string[];
  details: string;
  url: string;
}
export interface AlertFeed {
  kind: AlertKind;
  source: string;
  status: AlertStatus;
  items: AlertItem[];
  fetchedAt: number | null;
  scope: string;
  url: string;
  notice?: string;
}

export const WEATHER_URL = "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings";
export const FLOOD_URL = "https://flood-warning.naturalresources.wales/";
const LABELS = {
  yellow: "Yellow weather warning", amber: "Amber weather warning", red: "Red weather warning",
  flood_alert: "Flood alert", flood_warning: "Flood warning", severe_flood_warning: "Severe flood warning",
} as const;
const WEATHER_RANK = { yellow: 1, amber: 2, red: 3 };
const FLOOD_LEVELS = { 1: "severe_flood_warning", 2: "flood_warning", 3: "flood_alert" } as const;
const FLOOD_ADVICE = {
  flood_alert: "Flooding is possible. Be prepared.",
  flood_warning: "Flooding is expected. Take action now.",
  severe_flood_warning: "Severe flooding. Danger to life.",
};
const weatherSource = { kind: "weather", source: "Met Office Weather Warnings", scope: "Configured warning area", url: WEATHER_URL } as const;
const floodSource = { kind: "flood", source: "Natural Resources Wales", scope: "Configured flood areas", url: FLOOD_URL } as const;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 6000): string => typeof value === "string" ? value.trim().slice(0, max) : "";

/** Require an explicit offset: browser-local dates must not reinterpret warning times. */
export function alertTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeUrl(value: unknown, kind: AlertKind): string {
  const fallback = kind === "weather" ? WEATHER_URL : FLOOD_URL;
  if (typeof value !== "string") return fallback;
  try {
    const url = new URL(value);
    const allowed = kind === "weather" ? ["weather.metoffice.gov.uk", "www.metoffice.gov.uk"]
      : ["flood-warning.naturalresources.wales", "naturalresources.wales", "www.naturalresources.wales"];
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && allowed.includes(url.hostname) ? url.href : fallback;
  } catch { return fallback; }
}

function failed(kind: AlertKind, fetchedAt: number | null = null, status: "unavailable" | "stale" = "unavailable"): AlertFeed {
  return { ...(kind === "weather" ? weatherSource : floodSource), status, items: [], fetchedAt };
}

function freshness(entity: HassEntity | undefined, kind: AlertKind, now: number): AlertFeed | null {
  if (!entity || ["unavailable", "unknown", ""].includes(entity.state) || !isRecord(entity.attributes)) return failed(kind);
  const fetched = alertTimestamp(entity.attributes.fetched_at);
  if (fetched === null || fetched > now + 60_000) return failed(kind);
  const maximum = kind === "weather" ? 600 : 1800;
  const declared = entity.attributes.stale_after_seconds;
  // A source may tighten its expiry, but cannot extend the verified provider limit.
  const seconds = typeof declared === "number" && Number.isFinite(declared) && declared > 0 ? Math.min(declared, maximum) : maximum;
  return now - fetched >= seconds * 1000 ? failed(kind, fetched, "stale") : null;
}

// Complete source text is kept intact. Bound the full payload rather than
// silently truncating individual safety advice or dropping unsupported parts.
const completeText = (value: unknown): string | null => typeof value === "string" && value.length <= 8_388_608 ? value : null;
function completeLines(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  const rows = typeof value === "string" ? [value] : value;
  if (!Array.isArray(rows) || rows.length > 2000 || rows.some(line => completeText(line) === null)) return null;
  return rows as string[];
}
const WEATHER_TYPES: Record<string, string> = { rain: "Rain", thunderstorm: "Thunderstorm", wind: "Wind", snow: "Snow", lightning: "Lightning", ice: "Ice", extremeheat: "Extreme Heat", "extreme heat": "Extreme Heat", fog: "Fog" };

export function weatherAlerts(entity: HassEntity | undefined, now = Date.now()): AlertFeed {
  const problem = freshness(entity, "weather", now);
  if (problem) return problem;
  const attributes = entity!.attributes;
  const rows = attributes.warnings;
  if (!Array.isArray(rows) || rows.length > 1000 || !["none", "yellow", "amber", "red"].includes(entity!.state)) return failed("weather");
  const items: AlertItem[] = [];
  const ids = new Set<string>();
  let declaredRank = 0;
  for (const row of rows) {
    if (!isRecord(row) || !["yellow", "amber", "red"].includes(String(row.level))) return failed("weather");
    const id = text(row.id, 200);
    const from = alertTimestamp(row.valid_from), to = alertTimestamp(row.valid_to);
    const severity = row.level as keyof typeof WEATHER_RANK;
    const filter = row.filter_method;
    if (!id || ids.has(id) || from === null || to === null || to <= from || !["polygon", "region_fallback"].includes(String(filter))) return failed("weather");
    ids.add(id);
    declaredRank = Math.max(declaredRank, WEATHER_RANK[severity]);
    const areas = completeLines(row.areas);
    if (!areas || (filter === "region_fallback" && !areas.length)) return failed("weather");
    if (to <= now) continue;
    const headline = completeText(row.headline);
    const issued = alertTimestamp(row.issued);
    const advice = completeLines(row.what_to_do), expectedText = completeLines(row.what_to_expect);
    const details = completeText(row.details ?? "");
    const updateDescription = completeText(row.update_description ?? "");
    const rawTypes = completeLines(row.weather_types);
    if (!headline?.trim() || !advice || !expectedText || details === null || updateDescription === null || !rawTypes?.length || rawTypes.length > 2) return failed("weather");
    const weatherTypes = rawTypes.map(type => WEATHER_TYPES[type.toLowerCase()]);
    if (weatherTypes.some(type => !type)) return failed("weather");
    const version = typeof row.version === "string" && /^\d+(?:\.\d+)?$/.test(row.version) ? Number(row.version) : null;
    const sourceStatus = typeof row.status === "string" ? row.status.toLowerCase() : null;
    if (sourceStatus && sourceStatus !== "issued") return failed("weather");
    const statusText = (version !== null && version >= 2) || (sourceStatus === "issued" && updateDescription.trim()) ? "Updated" : sourceStatus === "issued" || (version !== null && version >= 1) ? "Issued" : undefined;
    const publicationYear = new Date(issued ?? alertTimestamp(attributes.fetched_at)!).getUTCFullYear();
    items.push({
      id, revision: JSON.stringify([row.version, row.modified, row.status, headline, advice, expectedText, details, updateDescription]), severity,
      rank: WEATHER_RANK[severity], label: LABELS[severity], headline,
      timing: from <= now ? "active" : "upcoming", validFrom: from, validTo: to, updatedAt: alertTimestamp(row.modified), issuedAt: issued, statusText, weatherTypes, expected: expectedText,
      attribution: `Met Office Weather Warnings © Crown Copyright ${publicationYear}`,
      scope: filter === "polygon" ? `Home location${areas.length ? ` · Affected areas: ${areas.join(", ")}` : ""}` : `Regional warning · ${areas.join(", ")} · property coverage unconfirmed`,
      advice, details, updateDescription,
      url: safeUrl(row.source_url, "weather"),
    });
  }
  const expected = declaredRank === 0 ? "none" : (["none", "yellow", "amber", "red"] as const)[declaredRank];
  if (entity!.state !== expected) return failed("weather");
  // Stable sorting keeps the provider's impact/likelihood order within a level.
  items.sort((a, b) => b.rank - a.rank);
  return { ...weatherSource, status: items.length ? "warnings" : "clear", items, fetchedAt: alertTimestamp(attributes.fetched_at) };
}

export function floodAlerts(entity: HassEntity | undefined, now = Date.now(), verifiedCoverage?: HassEntity): AlertFeed {
  // HA omits extra attributes on unavailable entities. The caller may provide
  // only a companion verified against the same integration's registry entry.
  // It supplies location coverage, never warning availability or a clear state.
  const companion = entity && ["unavailable", "unknown"].includes(entity.state) && verifiedCoverage?.state === "outside_known_areas" ? verifiedCoverage : undefined;
  const coverage = entity?.attributes.scope ?? companion?.attributes.scope;
  if (isRecord(coverage) && coverage.type === "area_codes" && Array.isArray(coverage.area_codes) && coverage.area_codes.length === 0 && coverage.selection_method === "home_polygon" && coverage.coverage_status === "outside_known_areas") {
    const resolved = alertTimestamp(coverage.resolved_at);
    // A location-coverage result has its own daily refresh, independent of the
    // warning feed. Do not turn old/offline coverage metadata into a current fact.
    if (resolved !== null && resolved <= now + 60_000 && now - resolved < 86_400_000) return {
      ...failed("flood"), scope: "Home flood areas",
      notice: "Home location is outside the published NRW warning areas; this does not mean no flood risk.",
    };
  }
  const problem = freshness(entity, "flood", now);
  if (problem) return problem;
  const attributes = entity!.attributes;
  const rows = attributes.warnings, scope = attributes.scope;
  if (!Array.isArray(rows) || rows.length > 2000 || !isRecord(scope) || !["area_codes", "all_wales"].includes(String(scope.type))) return failed("flood");
  if (!Array.isArray(scope.area_codes) || scope.area_codes.length > 2000 || scope.area_codes.some(code => typeof code !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(code))) return failed("flood");
  const codes = scope.area_codes as string[];
  if (new Set(codes).size !== codes.length || (scope.type === "all_wales" && codes.length)) return failed("flood");
  if (scope.type === "area_codes" && !codes.length) return failed("flood");
  // The broad scope must remain explicit even if a friendly label is configured.
  const scopeLabel = scope.type === "all_wales" ? "All Wales" : text(scope.label, 300) || "Selected flood areas";
  const items: AlertItem[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || ![1, 2, 3].includes(row.severity_code as number)) return failed("flood");
    const id = text(row.id, 200), area = text(row.area_name, 500), areaCode = text(row.area_code, 200);
    const raised = alertTimestamp(row.raised);
    const updates = [alertTimestamp(row.message_changed), alertTimestamp(row.severity_changed), raised].filter((value): value is number => value !== null);
    const changed = updates.length ? Math.max(...updates) : null;
    if (!id || ids.has(id) || !area || !areaCode || raised === null || (scope.type === "area_codes" && !codes.includes(areaCode))) return failed("flood");
    ids.add(id);
    const severity = FLOOD_LEVELS[row.severity_code as keyof typeof FLOOD_LEVELS];
    items.push({
      id, revision: `${changed ?? ""}:${text(row.message_english, 16000)}`, severity, rank: 4 - (row.severity_code as number),
      label: LABELS[severity], headline: area, timing: "active", validFrom: null, validTo: null, updatedAt: changed,
      scope: scopeLabel, advice: [FLOOD_ADVICE[severity]], details: text(row.message_english, 16000), url: safeUrl(row.source_url, "flood"),
    });
  }
  items.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  if (entity!.state !== (items[0]?.severity ?? "none")) return failed("flood");
  // NRW publication timestamps describe updates, not expiry. Only a fresh feed
  // can remove/clear a warning; a long-running unchanged warning stays visible.
  return { ...floodSource, scope: scopeLabel, status: items.length ? "warnings" : "clear", items, fetchedAt: alertTimestamp(attributes.fetched_at) };
}

export function alertFingerprint(feeds: AlertFeed[]): string {
  return JSON.stringify(feeds.map(feed => [feed.kind, feed.status, feed.notice, feed.items.map(item => [item.id, item.revision, item.severity, item.timing, item.validFrom, item.validTo, item.scope])]));
}

export function alertTime(timestamp: number | null, timeZone: string): string {
  if (timestamp === null) return "Time not supplied";
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short" }).format(timestamp);
  } catch {
    return new Date(timestamp).toISOString();
  }
}
