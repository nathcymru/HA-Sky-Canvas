import type { HomeAssistant, SkyConfig } from "../types";
import type { SceneState } from "./model";
import type { TimeOfDay } from "./types";
import { AnimationRuntime } from "./runtime";
import { getSkyColors, rgb } from "./sky";
import { SunnyAnimation } from "./animations/sunny";
import { RainyAnimation } from "./animations/rainy";
import { SnowyAnimation } from "./animations/snowy";
import { HailAnimation } from "./animations/hail";
import { FoggyAnimation } from "./animations/foggy";
import { ThunderstormAnimation } from "./animations/thunderstorm";
import { WindEffect } from "./animations/wind";
import { CloudField } from "./animations/clouds";
import { createQualitySettings } from "./animations/quality";

export function solarTime(hass: HomeAssistant, state: SceneState): TimeOfDay {
  const attributes = hass.states["sun.sun"]?.attributes;
  const elevation = attributes?.elevation;
  if (typeof elevation === "number" && elevation > -6 && elevation < 6 && typeof attributes?.rising === "boolean") {
    const progress = Math.max(0, Math.min(1, (elevation + 6) / 12));
    return { type: attributes.rising ? "sunrise" : "sunset", progress: attributes.rising ? progress : 1 - progress };
  }
  return { type: state.period, progress: 0.5 };
}

/** The upstream effects are independent from HA, image loading, and browser scheduling. */
export class WeatherEngine {
  private readonly clouds = new CloudField();
  private readonly sun: SunnyAnimation;
  private readonly rain: RainyAnimation;
  private readonly snow: SnowyAnimation;
  private readonly hail: HailAnimation;
  private readonly fog: FoggyAnimation;
  private readonly storm: ThunderstormAnimation;
  private readonly wind: WindEffect;

  constructor(private sky: CanvasRenderingContext2D, private foreground: CanvasRenderingContext2D, readonly runtime = new AnimationRuntime()) {
    this.sun = new SunnyAnimation(sky, runtime);
    this.rain = new RainyAnimation(foreground, runtime);
    this.snow = new SnowyAnimation(foreground, runtime);
    this.hail = new HailAnimation(foreground, runtime);
    this.fog = new FoggyAnimation(foreground, runtime);
    this.storm = new ThunderstormAnimation(foreground, runtime);
    this.wind = new WindEffect(runtime);
  }

  draw(width: number, height: number, state: SceneState, config: SkyConfig, hass: HomeAssistant, staticFrame: boolean): void {
    const time = this.runtime.time;
    const timeOfDay = solarTime(hass, state);
    const condition = hass.states[config.weatherEntity]?.state ?? "unknown";
    // Sun state determines day/night even when the provider's clear-night state is stale.
    const paletteCondition = condition === "clear-night" ? "clear" : condition;
    const colors = getSkyColors(paletteCondition, timeOfDay);
    const quality = createQualitySettings(config.quality);
    if (staticFrame) quality.details = false;
    this.sun.attach(null, quality);
    [this.rain, this.snow, this.hail, this.fog, this.storm].forEach((animation) => animation.attach(this.clouds, quality));
    this.clouds.setWeather(paletteCondition, timeOfDay);
    this.clouds.setWind(state.effect === "wind" ? 3 : 1);
    if (staticFrame) this.clouds.settle();

    this.sky.clearRect(0, 0, width, height);
    const gradient = this.sky.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, rgb(colors.top));
    gradient.addColorStop(1, rgb(colors.bottom));
    this.sky.fillStyle = gradient;
    this.sky.fillRect(0, 0, width, height);
    if (["clear", "partlycloudy", "wind"].includes(state.effect)) {
      this.sun.draw(time, width, height, timeOfDay);
    }

    this.foreground.clearRect(0, 0, width, height);
    switch (state.effect) {
      case "rain": case "pouring":
        this.rain.draw(time, width, height, timeOfDay, state.effect === "pouring"); break;
      case "snow":
        this.snow.draw(time, width, height, timeOfDay); break;
      case "sleet":
        this.clouds.draw(this.foreground, time, width, height, quality.cloudLayers);
        this.rain.drawRain(width, height, false);
        this.snow.drawSnowflakes(width, height); break;
      case "hail":
        this.hail.draw(time, width, height, timeOfDay); break;
      case "fog":
        this.fog.draw(time, width, height, timeOfDay); break;
      case "storm":
        if (config.lightning && !staticFrame) {
          this.storm.draw(time, width, height, timeOfDay, condition === "lightning-rainy");
        } else {
          this.clouds.draw(this.foreground, time, width, height, quality.cloudLayers);
          if (condition === "lightning-rainy") this.rain.drawRain(width, height, false);
        }
        break;
      case "wind":
        this.clouds.draw(this.foreground, time, width, height, quality.cloudLayers);
        this.wind.draw(this.foreground, time, width, height, 1, true, colors.daylight, quality); break;
      case "unknown":
        // Neutral grey sky: unavailable weather is never a false sunny report.
        break;
      default:
        this.clouds.draw(this.foreground, time, width, height, quality.cloudLayers);
    }
  }
}
