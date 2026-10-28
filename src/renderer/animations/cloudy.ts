/*! Derived from Dynamic Weather Card v2026.10.2. Copyright (c) 2026 Teuchezh Nurbiy. MIT; see LICENSE. Refactored for HA-Sky-Canvas. */
import { BaseAnimation } from './base';
import type { TimeOfDay } from '../types';

/**
 * Cloudy weather animation
 */
export class CloudyAnimation extends BaseAnimation {
  /**
   * Draw cloudy weather
   * @param time - Shared monotonic animation time in seconds
   * @param width - Canvas width
   * @param height - Canvas height
   * @param timeOfDay - Time of day info
   */
  draw(time: number, width: number, height: number, _timeOfDay: TimeOfDay): void {
    const currentTime = this.runtime.time;
    this.drawClouds(currentTime, width, height, 0.7);
  }
}
