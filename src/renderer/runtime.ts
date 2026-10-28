import { seededRandom } from "./model";

/** A single injected clock and random stream; animation code never reads wall time. */
export class AnimationRuntime {
  time = 1;
  date = new Date(0);
  readonly random: () => number;
  constructor(seed = 1079) { this.random = seededRandom(seed); }
  advance(deltaSeconds: number, date: Date): void {
    this.time += Math.max(0, Math.min(0.1, deltaSeconds));
    this.date = date;
  }
}
