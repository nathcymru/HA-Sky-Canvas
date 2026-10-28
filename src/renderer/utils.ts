/*! Derived from Dynamic Weather Card v2026.10.2. Copyright (c) 2026 Teuchezh Nurbiy. MIT; see LICENSE. Refactored for HA-Sky-Canvas. */
import type { TimeOfDay, Position, PositionOverride } from './types';

function getAutoSunPosition(timeOfDay: TimeOfDay, width: number, height: number): Position {
  if (timeOfDay.type === 'sunrise') {
    const progress = timeOfDay.progress;
    return {
      x: width * (0.3 + progress * 0.4),
      y: height * (0.85 - progress * 0.55)
    };
  } else if (timeOfDay.type === 'sunset') {
    const progress = timeOfDay.progress;
    return {
      x: width * (0.5 + progress * 0.3),
      y: height * (0.3 + progress * 0.55)
    };
  } else if (timeOfDay.type === 'day') {
    const progress = timeOfDay.progress;
    const angle = progress * Math.PI;
    return {
      x: width * (0.5 + Math.sin(angle) * 0.25),
      y: height * (0.25 - Math.sin(angle) * 0.1)
    };
  } else {
    // Night: moon position
    return {
      x: width * 0.75,
      y: height * 0.3
    };
  }
}

/**
 * Get sun/moon position, optionally pinned by a user override (percent of width/height)
 */
export function getSunPosition(
  timeOfDay: TimeOfDay,
  width: number,
  height: number,
  override?: PositionOverride
): Position {
  const position = getAutoSunPosition(timeOfDay, width, height);
  const toFraction = (percent: number): number => Math.min(100, Math.max(0, percent)) / 100;

  if (typeof override?.x === 'number') {
    position.x = width * toFraction(override.x);
  }
  if (typeof override?.y === 'number') {
    position.y = height * toFraction(override.y);
  }
  return position;
}

