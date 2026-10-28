/*! Derived from Dynamic Weather Card v2026.10.2. Copyright (c) 2026 Teuchezh Nurbiy. MIT; see LICENSE. Refactored for HA-Sky-Canvas. */
import { AnimationRuntime } from '../../runtime';
/**
 * Classic (pre-2026.10) animation port retained for source completeness.
 * The Sky Canvas UI uses the modern renderer; no classic-style switch is exposed.
 * They draw the simple clouds from BaseAnimation because no CloudField is attached.
 */
import { SunnyAnimation } from './sunny';
import { RainyAnimation } from './rainy';
import { SnowyAnimation } from './snowy';
import { FoggyAnimation } from './foggy';
import { HailAnimation } from './hail';
import { ThunderstormAnimation } from './thunderstorm';
import { CloudyAnimation } from '../cloudy';
import type { TimeOfDay, PositionOverride } from '../../types';

export class ClassicAnimations {
  private runtime: AnimationRuntime;
  private sunny: SunnyAnimation;
  private rainy: RainyAnimation;
  private snowy: SnowyAnimation;
  private cloudy: CloudyAnimation;
  private foggy: FoggyAnimation;
  private hail: HailAnimation;
  private thunderstorm: ThunderstormAnimation;

  constructor(ctx: CanvasRenderingContext2D, runtime: AnimationRuntime = new AnimationRuntime()) {
    this.runtime = runtime;
    this.sunny = new SunnyAnimation(ctx, runtime);
    this.rainy = new RainyAnimation(ctx, runtime);
    this.snowy = new SnowyAnimation(ctx, runtime);
    this.cloudy = new CloudyAnimation(ctx, runtime);
    this.foggy = new FoggyAnimation(ctx, runtime);
    this.hail = new HailAnimation(ctx, runtime);
    this.thunderstorm = new ThunderstormAnimation(ctx, runtime);
  }

  draw(condition: string, width: number, height: number, timeOfDay: TimeOfDay, sunPosition?: PositionOverride): void {
    const now = this.runtime.time * 1000;
    switch (condition) {
      case 'sunny':
      case 'clear':
        this.sunny.draw(now, width, height, timeOfDay, sunPosition);
        break;
      case 'clear-night':
        this.sunny.draw(now, width, height, { type: 'night', progress: 0 }, sunPosition);
        break;
      case 'rainy':
      case 'rain':
        this.rainy.draw(now, width, height, timeOfDay, false);
        break;
      case 'pouring':
        this.rainy.draw(now, width, height, timeOfDay, true);
        break;
      case 'snowy':
      case 'snow':
        this.snowy.draw(now, width, height, timeOfDay);
        break;
      case 'snowy-rainy':
        this.rainy.draw(now, width, height, timeOfDay, false);
        this.snowy.draw(now, width, height, timeOfDay);
        break;
      case 'hail':
        this.hail.draw(now, width, height, timeOfDay);
        break;
      case 'foggy':
      case 'fog':
        this.foggy.draw(now, width, height, timeOfDay);
        break;
      case 'lightning':
        this.thunderstorm.draw(now, width, height, timeOfDay, false);
        break;
      case 'lightning-rainy':
        this.thunderstorm.draw(now, width, height, timeOfDay, true);
        break;
      case 'cloudy':
      case 'partlycloudy':
      default:
        this.cloudy.draw(now, width, height, timeOfDay);
        break;
    }
  }
}
