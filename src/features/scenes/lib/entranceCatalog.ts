import type {
  DurationUnit,
  Entrance,
  EntranceMode,
  RevealShape,
  WipeDirection,
} from "../../../shared/types";
import { defaultEntrance } from "../../../shared/types";

export const entranceModes: {
  id: EntranceMode;
  label: string;
  hint: string;
}[] = [
  { id: "fade", label: "淡化", hint: "交叉淡入淡出" },
  { id: "wipe", label: "方向擦除", hint: "目标画面沿方向擦入" },
  { id: "reveal", label: "几何揭幕", hint: "自中心几何展开揭幕" },
  { id: "expand", label: "跟随低频扩张", hint: "圆域随低频能量扩张，结束必完整" },
];

export const wipeDirections: { id: WipeDirection; label: string; arrow: string }[] = [
  { id: "left", label: "自左擦入", arrow: "→" },
  { id: "right", label: "自右擦入", arrow: "←" },
  { id: "up", label: "自顶擦入", arrow: "↓" },
  { id: "down", label: "自底擦入", arrow: "↑" },
];

export const revealShapes: { id: RevealShape; label: string }[] = [
  { id: "circle", label: "圆形" },
  { id: "square", label: "方形" },
  { id: "diamond", label: "菱形" },
];

export const durationUnits: { id: DurationUnit; label: string }[] = [
  { id: "seconds", label: "秒" },
  { id: "beats", label: "拍" },
];

export function describeEntrance(e: Entrance): string {
  const dur = `${e.duration}${e.unit === "beats" ? " 拍" : "s"}`;
  switch (e.mode) {
    case "wipe":
      return `擦除 · ${wipeDirections.find((d) => d.id === e.direction)?.label ?? e.direction} · ${dur}`;
    case "reveal":
      return `揭幕 · ${revealShapes.find((s) => s.id === e.shape)?.label ?? e.shape} · ${dur}`;
    case "expand":
      return `低频扩张 · ${dur}`;
    case "fade":
    default:
      return `淡化 · ${dur}`;
  }
}

export function cloneEntrance(e: Entrance): Entrance {
  return { ...defaultEntrance(), ...e };
}
