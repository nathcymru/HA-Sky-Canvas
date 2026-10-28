import type { HassEntity, HomeAssistant } from "../types";

const PLATFORM = "nrw_flood_direct";
const RETRY_DELAY = 60_000;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Registry identity survives user renames; names and suffixes convey no trust. */
function coverageEntityId(rows: unknown, selected: string): string | null {
  if (!Array.isArray(rows) || rows.length > 100_000) return null;
  const primary = rows.filter(row => isRecord(row) && row.entity_id === selected && row.platform === PLATFORM && row.unique_id === `${PLATFORM}_warnings`);
  if (primary.length !== 1) return null;
  const entry = primary[0].config_entry_id;
  if (typeof entry !== "string" || !entry) return null;
  const companions = rows.filter(row => isRecord(row) && row.platform === PLATFORM && row.config_entry_id === entry && row.unique_id === `${PLATFORM}_coverage_status`);
  if (companions.length !== 1) return null;
  const id = companions[0].entity_id;
  return typeof id === "string" && /^sensor\.[a-z0-9_]+$/.test(id) && id !== selected ? id : null;
}

/** One cached lookup and at most one delayed recovery per connection/selection. */
export class FloodCoverageResolver {
  private connection: HomeAssistant["connection"];
  private selected: string | null = null;
  private companion: string | null = null;
  private generation = 0;
  private attempts = 0;
  private lastAttempt = 0;
  private pending = false;
  private disposed = false;

  constructor(private readonly changed: () => void, private readonly now: () => number) {}

  reset(): void {
    this.generation++;
    this.connection = undefined;
    this.selected = null;
    this.companion = null;
    this.attempts = 0;
    this.lastAttempt = 0;
    this.pending = false;
  }

  update(selected: string | null, hass: HomeAssistant): HassEntity | undefined {
    if (this.disposed) return undefined;
    if (selected !== this.selected || hass.connection !== this.connection) {
      this.reset();
      this.selected = selected;
      this.connection = hass.connection;
    }
    if (!selected || !hass.connection) return undefined;
    const entity = this.companion ? hass.states[this.companion] : undefined;
    // Unavailable is a real state, not a rename. Only a missing entity warrants
    // re-resolving the registry; neither case can imply that warning data is clear.
    if (!entity && !this.pending && this.attempts < 2 && (this.attempts === 0 || this.now() - this.lastAttempt >= RETRY_DELAY)) {
      this.pending = true;
      this.attempts++;
      this.lastAttempt = this.now();
      const generation = this.generation;
      // The ordinary, read-only HA command is available to dashboard users.
      // No provider request, authentication material or extra subscription exists.
      void Promise.resolve().then(() => {
        if (this.disposed || generation !== this.generation) return undefined;
        return hass.callWS({ type: "config/entity_registry/list" });
      }).then(rows => {
        if (this.disposed || generation !== this.generation) return;
        this.companion = coverageEntityId(rows, selected);
        this.pending = false;
        this.changed();
      }, () => {
        if (this.disposed || generation !== this.generation) return;
        this.companion = null;
        this.pending = false;
        this.changed();
      });
    }
    return entity;
  }

  destroy(): void { this.disposed = true; this.reset(); }
}
