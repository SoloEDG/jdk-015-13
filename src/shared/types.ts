export type SceneKind = "orbit" | "spectrum" | "wave" | "tunnel";

/** 入场方式：淡化 / 方向擦除 / 几何揭幕 / 跟随低频扩张 */
export type EntranceMode = "fade" | "wipe" | "reveal" | "expand";
export type DurationUnit = "seconds" | "beats";
/** 擦除方向：目标画面进入时覆盖过来的方向 */
export type WipeDirection = "left" | "right" | "up" | "down";
/** 几何揭幕形状 */
export type RevealShape = "circle" | "square" | "diamond";

export interface Entrance {
  mode: EntranceMode;
  /** 时长数值；配合 unit 解释 */
  duration: number;
  unit: DurationUnit;
  /** mode === "wipe" 时有效 */
  direction: WipeDirection;
  /** mode === "reveal" 时有效 */
  shape: RevealShape;
}

export interface Scene {
  id: string;
  name: string;
  kind: SceneKind;
  theme: string;
  intensity: number;
  speed: number;
  /** 每个场景保存自己的入场契约参数（演出时按场景快照读取） */
  entrance: Entrance;
}
export interface Analysis {
  bins: number[];
  wave: number[];
  rms: number;
  bass: number;
  beat: boolean;
  time: number;
}
export interface StageDocument {
  scenes: Scene[];
  activeId: string;
  gain: number;
  sensitivity: number;
  smoothing: number;
  blackout: boolean;
  frozen: boolean;
  strobe: boolean;
  master: number;
}
export interface Take {
  id: string;
  url: string;
  size: number;
  duration: number;
  name: string;
  mime: string;
}
export interface Theme {
  id: string;
  name: string;
  colors: [string, string, string];
  background: string;
}

export function defaultEntrance(): Entrance {
  return {
    mode: "fade",
    duration: 1.2,
    unit: "seconds",
    direction: "left",
    shape: "circle",
  };
}

/** 时长归一化为秒；拍数在触发时按当前 BPM 结算，结算后契约不再受改速影响 */
export function entranceSeconds(e: Pick<Entrance, "duration" | "unit">, bpm: number): number {
  if (e.unit === "beats") {
    const safeBpm = Math.min(300, Math.max(40, Number.isFinite(bpm) && bpm > 0 ? bpm : 120));
    return Math.max(0, e.duration) * (60 / safeBpm);
  }
  return Math.max(0, e.duration);
}
