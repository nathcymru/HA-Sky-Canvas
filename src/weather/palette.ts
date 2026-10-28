/** Published Met Office forecast backgrounds; see palette-source.json for provenance. */
export const TEMPERATURE_COLOURS: readonly string[] = [
  "#132d7c", "#203883", "#2c438a", "#374e90", "#435897", "#4f639d", "#5b6da4", "#6778aa", "#7382b1", "#7f8db8",
  "#8b98bf", "#98a4c6", "#a2accb", "#afb8d3", "#bbc2d9", "#c6ccdf", "#d3d7e6", "#dee2ed", "#eaedf3", "#f5f6fa",
  "#fff9e8", "#fff5d9", "#fff1ca", "#ffedba", "#ffeaac", "#ffe59b", "#ffe28d", "#ffde7d", "#ffda6d", "#ffd765",
  "#ffd262", "#ffcc5f", "#ffc75c", "#ffc259", "#ffbd56", "#ffb853", "#ffb350", "#ffad4d", "#ffa84a", "#ffa447",
  "#ff9e44", "#ff9942", "#ff943e", "#ff8f3b", "#ff8a39", "#ff8335", "#fe7d33", "#fa7433", "#f86d33", "#f36233",
  "#ef5733", "#eb4e33", "#e74433", "#e33a33", "#de2e33", "#da2433", "#d61933", "#d10d33", "#cd0333", "#c30031",
 ];
export interface ColourBand { background: string; foreground: "#000000" | "#ffffff"; }
/** Black/white chosen by measured sRGB contrast; preserves the source background. */
export function colourBand(background: string): ColourBand {
  const linear = (offset: number) => { const value = parseInt(background.slice(offset, offset + 2), 16) / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
  const luminance = 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  return { background, foreground: (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff" };
}
export function temperatureBand(value: number | null, unit: string | null): ColourBand | null {
  if (value === null || !Number.isFinite(value) || !unit || !["°C", "°F", "K"].includes(unit)) return null;
  const celsius = unit === "°F" ? (value - 32) * 5 / 9 : unit === "K" ? value - 273.15 : value;
  // Nearest whole Celsius selects the published band. Saturation retains numeric values.
  return colourBand(TEMPERATURE_COLOURS[Math.max(-19, Math.min(40, Math.round(celsius))) + 19]);
}
export function uvBand(value: number | null): (ColourBand & { label: string }) | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const [background, label] = value < 1 ? ["#606060", "No significant UV"]
    : value < 3 ? ["#71b466", "Low"] : value < 6 ? ["#f8e71c", "Moderate"]
    : value < 8 ? ["#ff950c", "High"] : value < 11 ? ["#d72921", "Very high"]
    : ["#6600e0", "Extreme"];
  return { ...colourBand(background), label };
}
/** Guide threshold: 25 knots / 29 mph; other HA units use 25 knots exactly. */
export function strongGust(value: number | null, unit: string | null): boolean {
  const thresholds: Record<string, number> = { kn: 25, mph: 29, "km/h": 46.3, "m/s": 25 * 1852 / 3600, "ft/s": 25 * 1852 / 3600 / 0.3048 };
  return value !== null && Number.isFinite(value) && unit !== null && Object.hasOwn(thresholds, unit) && value >= thresholds[unit];
}
