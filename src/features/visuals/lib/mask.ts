import type { Entrance, RevealShape, WipeDirection } from "../../../shared/types";
import { clamp } from "../../../shared/math";

/**
 * 遮罩只描述 1280×720  backing 像素上的几何区域。
 * 录制走 canvas.captureStream、全屏走 CSS 拉伸同一画布，因此二者边缘完全一致——
 * 不使用任何 CSS mask / clip-path，避免两条渲染路径出现不同边缘。
 */
export type MaskRegion =
  | { kind: "full" }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "polygon"; points: [number, number][] };

export const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

/** 从中心到最远角的距离，p=1 时保证覆盖整幅画面 */
export function coveringRadius(w: number, h: number) {
  return Math.hypot(w / 2, h / 2);
}

function wipeRect(
  p: number,
  w: number,
  h: number,
  direction: WipeDirection,
): MaskRegion {
  const q = clamp(p, 0, 1);
  switch (direction) {
    // 目标从左侧擦入：覆盖区域自左向右生长
    case "left":
      return { kind: "rect", x: 0, y: 0, w: w * q, h };
    // 目标从右侧擦入：覆盖区域自右向左生长
    case "right":
      return { kind: "rect", x: w * (1 - q), y: 0, w: w * q, h };
    // 目标自顶部擦入
    case "up":
      return { kind: "rect", x: 0, y: 0, w, h: h * q };
    // 目标自底部擦入
    case "down":
      return { kind: "rect", x: 0, y: h * (1 - q), w, h: h * q };
  }
}

function revealRegion(
  p: number,
  w: number,
  h: number,
  shape: RevealShape,
): MaskRegion {
  const q = clamp(p, 0, 1),
    cx = w / 2,
    cy = h / 2;
  if (shape === "circle") {
    return { kind: "circle", cx, cy, r: coveringRadius(w, h) * q };
  }
  if (shape === "square") {
    const side = Math.max(w, h) * q;
    return { kind: "rect", x: cx - side / 2, y: cy - side / 2, w: side, h: side };
  }
  // diamond：沿对角线扩张。x/y 采用分离尺度，使 p=1 时四条边
  // 恰好穿过屏幕四角（角点满足 |x-cx|/dx + |y-cy|/dy = 1），完整覆盖
  const dx = w * q,
    dy = h * q;
  return {
    kind: "polygon",
    points: [
      [cx, cy - dy],
      [cx + dx, cy],
      [cx, cy + dy],
      [cx - dx, cy],
    ],
  };
}

/**
 * 返回目标画面在进度 p 时的可见区域。
 * fade 不需要几何遮罩（用全局 alpha 混合），返回 full。
 */
export function entranceMask(
  entrance: Pick<Entrance, "mode" | "direction" | "shape">,
  p: number,
  w: number,
  h: number,
): MaskRegion {
  const q = clamp(p, 0, 1);
  switch (entrance.mode) {
    case "wipe":
      return wipeRect(easeInOutCubic(q), w, h, entrance.direction);
    case "reveal":
      return revealRegion(easeInOutCubic(q), w, h, entrance.shape);
    case "expand":
      // 几何本身为圆形扩张；音乐跟随发生在进度层（见 transitionEngine）
      return {
        kind: "circle",
        cx: w / 2,
        cy: h / 2,
        r: coveringRadius(w, h) * q,
      };
    case "fade":
    default:
      return { kind: "full" };
  }
}

function pathRegion(c: CanvasRenderingContext2D, region: MaskRegion) {
  c.beginPath();
  switch (region.kind) {
    case "full":
      c.rect(0, 0, c.canvas.width, c.canvas.height);
      break;
    case "rect":
      c.rect(region.x, region.y, region.w, region.h);
      break;
    case "circle":
      c.arc(region.cx, region.cy, Math.max(0, region.r), 0, Math.PI * 2);
      break;
    case "polygon":
      region.points.forEach(([x, y], i) =>
        i ? c.lineTo(x, y) : c.moveTo(x, y),
      );
      c.closePath();
      break;
  }
}

/** 在 ctx 上把 draw 限制在遮罩区域内绘制 */
export function clipToMask(
  c: CanvasRenderingContext2D,
  region: MaskRegion,
  draw: () => void,
) {
  c.save();
  pathRegion(c, region);
  c.clip();
  draw();
  c.restore();
}
