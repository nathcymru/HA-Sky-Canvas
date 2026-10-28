export type AnimationQuality = 'low' | 'medium' | 'high';
export interface TimeOfDay {type: 'sunrise' | 'day' | 'sunset' | 'night'; progress: number;}
export interface Position { x: number; y: number; }
export interface PositionOverride { x?: number | null; y?: number | null; }
export interface RGBColor { r: number; g: number; b: number; }
