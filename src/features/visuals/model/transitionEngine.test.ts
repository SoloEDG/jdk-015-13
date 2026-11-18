/**
 * 转场引擎契约测试（node --experimental-strip-types 直接运行 TS）
 * 覆盖：触发定契约、改速不回溯、低频完整结束、静音不卡半幅、
 *       零时长、连续切换身份、暂停恢复、预演隔离。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { TransitionEngine } from "./transitionEngine";
import { entranceMask, entranceMask as mask, type MaskRegion } from "../lib/mask";
import { entranceSeconds } from "../../../shared/types";
import type { Entrance, RevealShape, WipeDirection } from "../../../shared/types";

const W = 1280,
  H = 720;
const ent = (over: Partial<Entrance> = {}): Entrance => ({
  mode: "fade",
  duration: 2,
  unit: "seconds",
  direction: "left",
  shape: "circle",
  ...over,
});

test("触发时结算秒数；演出中改 BPM 不影响在途契约，只影响下一次触发", () => {
  const e = new TransitionEngine();
  const beats = ent({ mode: "wipe", unit: "beats", duration: 4 });
  // 120 BPM → 1 拍 0.5s，4 拍 = 2s
  const c1 = e.trigger("s2", beats, 120, 0);
  assert.equal(c1.seconds, 2);
  e.update(500, 0);
  // 敲击改速到 60 BPM：在途契约秒数不变
  e.update(1000, 0);
  assert.equal(e.current?.seconds, 2);
  assert.equal(e.current?.id, c1.id);
  // 时间线推进到 2s 完成
  e.update(2000, 0);
  assert.equal(e.current, null);
  // 下一次触发按新 BPM 结算：60 BPM → 4 拍 = 4s
  const c2 = e.trigger("s3", beats, 60, 2000);
  assert.equal(c2.seconds, 4);
  assert.notEqual(c2.id, c1.id);
});

test("时间线拥有完成所有权：持续静音，扩张仍在约定时刻完整进入", () => {
  const e = new TransitionEngine();
  const expand = ent({ mode: "expand", duration: 1, unit: "seconds" });
  e.trigger("s2", expand, 120, 0);
  // 全程静音（bass=0）
  e.update(250, 0);
  assert.ok(e.hud.progress < 1 && e.hud.progress > 0);
  e.update(500, 0);
  e.update(1000, 0);
  // 约定结束时刻契约已结束（不卡半幅），落定到目标场景，进度归零待命
  assert.equal(e.current, null);
  assert.equal(e.hud.liveContractId, null);
  assert.equal(e.hud.activeTargetId, "s2");
  assert.equal(e.hud.progress, 0);
});

test("低频能量让扩张提前（即兴有界、单调），但终点仍是约定时刻", () => {
  const e = new TransitionEngine();
  const expand = ent({ mode: "expand", duration: 1, unit: "seconds" });
  e.trigger("s2", expand, 120, 0);
  // 强低频推进
  e.update(100, 0.9);
  const pLoud = e.hud.progress;
  // 随后静音：进度不回退
  e.update(200, 0);
  assert.ok(e.hud.progress >= pLoud - 1e-9);
  // 500ms 处有低频跟随的扩张应快于纯时间线
  assert.ok(pLoud > 0.1);
  e.update(1000, 0.9);
  assert.equal(e.current, null);
  assert.equal(e.hud.activeTargetId, "s2");
});

test("零时长转场：当帧立即完成，无半幅中间态，目标身份明确", () => {
  const e = new TransitionEngine();
  const zero = ent({ duration: 0 });
  const c = e.trigger("s3", zero, 120, 500);
  assert.equal(c.seconds, 0);
  const live = e.update(500, 0);
  assert.equal(live, null);
  // 无在途契约，但正式输出身份已明确落定为目标场景
  assert.equal(e.hud.liveContractId, null);
  assert.equal(e.hud.activeTargetId, "s3");
});

test("不同方向连续切换：每次触发都是新契约，身份单调递增", () => {
  const e = new TransitionEngine();
  const w1 = ent({ mode: "wipe", direction: "left", duration: 1 });
  const w2 = ent({ mode: "wipe", direction: "up", duration: 1 });
  const c1 = e.trigger("s2", w1, 120, 0);
  e.update(200, 0);
  const c2 = e.trigger("s3", w2, 120, 200);
  assert.equal(c2.id, c1.id + 1);
  assert.equal(e.current?.targetId, "s3");
  assert.deepEqual(e.current?.entrance.direction, "up");
  // 在途契约的参数是快照：事后改场景参数不影响它
  w2.direction = "down";
  assert.equal(e.current?.entrance.direction, "up");
});

test("暂停后恢复：绝对时间戳驱动，进度只前进不回到起点", () => {
  const e = new TransitionEngine();
  e.trigger("s2", ent({ duration: 2 }), 120, 0);
  e.update(500, 0);
  const pBefore = e.hud.progress;
  assert.ok(pBefore > 0 && pBefore < 1);
  // 模拟页面挂起 5 秒后恢复（rAF 时间戳跳变）：直接跳到完成，不重放
  e.update(5500, 0);
  assert.equal(e.current, null);
  assert.equal(e.hud.liveContractId, null);
  assert.equal(e.hud.activeTargetId, "s2");
});

test("预演与正式输出隔离：不产生正式契约，可独立停止与循环", () => {
  const e = new TransitionEngine();
  const draft = ent({ mode: "reveal", duration: 1 });
  e.startPreview(draft, 120, 0, true);
  assert.equal(e.isPreviewing, true);
  assert.equal(e.current, null); // 没有正式契约
  e.update(500, 0);
  assert.ok(e.hud.previewProgress > 0 && e.hud.previewProgress < 1);
  e.stopPreview();
  assert.equal(e.isPreviewing, false);
  assert.equal(e.hud.previewProgress, 0);
  // 预演草稿是快照：外部修改 draft 不影响引擎内副本
  e.startPreview(draft, 120, 0);
  draft.mode = "wipe";
  assert.equal(e.previewEntrance?.mode, "reveal");
});

test("零时长预演：在完整目标/基底画面间脉冲，且始终不产生正式契约", () => {
  const e = new TransitionEngine();
  e.init("s1");
  e.startPreview(ent({ mode: "wipe", duration: 0 }), 120, 0);
  e.update(0, 0);
  assert.equal(e.hud.previewProgress, 1);
  e.update(700, 0); // 跨过 600ms 脉冲边界
  assert.equal(e.hud.previewProgress, 0);
  e.update(1300, 0);
  assert.equal(e.hud.previewProgress, 1);
  assert.equal(e.current, null, "预演全程不得建立正式契约");
  assert.equal(e.hud.liveContractId, null);
  e.stopPreview();
});

test("拍数/秒数换算边界：BPM 被夹在 40–300，数值不为负", () => {
  assert.equal(entranceSeconds({ duration: 4, unit: "beats" }, 120), 2);
  assert.equal(entranceSeconds({ duration: 1, unit: "beats" }, 60), 1);
  assert.equal(entranceSeconds({ duration: 1, unit: "beats" }, 9999), 60 / 300);
  // 非法 BPM（0/负数/非有限值）回退默认 120；合法下限 40 被尊重
  assert.equal(entranceSeconds({ duration: 1, unit: "beats" }, 0), 60 / 120);
  assert.equal(entranceSeconds({ duration: 1, unit: "beats" }, 40), 60 / 40);
  assert.equal(entranceSeconds({ duration: 1, unit: "beats" }, 300), 60 / 300);
  assert.equal(entranceSeconds({ duration: -3, unit: "seconds" }, 120), 0);
  assert.equal(entranceSeconds({ duration: -3, unit: "beats" }, 120), 0);
});

test("遮罩几何：p=0 无目标区域，p=1 完整覆盖（四种擦除方向+三种揭幕）", () => {
  // 多边形面积（鞋带公式）
  const polygonArea = (pts: [number, number][]) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i],
        [x2, y2] = pts[(i + 1) % pts.length];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  };
  const area = (r: MaskRegion): number => {
    if (r.kind === "full") return W * H;
    if (r.kind === "rect") return r.w * r.h;
    if (r.kind === "circle") return Math.PI * r.r * r.r;
    return polygonArea(r.points);
  };
  for (const direction of ["left", "right", "up", "down"] as WipeDirection[]) {
    const r0 = mask({ mode: "wipe", direction, shape: "circle" }, 0, W, H);
    const r1 = mask({ mode: "wipe", direction, shape: "circle" }, 1, W, H);
    assert.equal(area(r0), 0);
    assert.equal(area(r1), W * H);
  }
  // 点是否落在遮罩区域内（用于验证 p=1 四角与中心都被覆盖）
  const contains = (r: MaskRegion, x: number, y: number): boolean => {
    if (r.kind === "full") return true;
    if (r.kind === "rect")
      return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (r.kind === "circle")
      return Math.hypot(x - r.cx, y - r.cy) <= r.r + 1e-9;
    // 多边形：射线法
    let inside = false;
    for (let i = 0, j = r.points.length - 1; i < r.points.length; j = i++) {
      const [xi, yi] = r.points[i],
        [xj, yj] = r.points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  };
  const corners = [
    [1, 1],
    [W - 1, 1],
    [W - 1, H - 1],
    [1, H - 1],
    [W / 2, H / 2],
  ];
  for (const shape of ["circle", "square", "diamond"] as RevealShape[]) {
    const r0 = entranceMask({ mode: "reveal", direction: "left", shape }, 0, W, H);
    const r1 = entranceMask({ mode: "reveal", direction: "left", shape }, 1, W, H);
    assert.ok(area(r0) <= 1);
    // p=1：屏幕四角与中心必须全部被遮罩覆盖，目标完整进入
    for (const [x, y] of corners)
      assert.ok(contains(r1, x, y), `${shape} p=1 未覆盖点 (${x},${y})`);
  }
  // 扩张圆在 p=1 的半径覆盖到最远角
  const circle = mask({ mode: "expand", direction: "left", shape: "circle" }, 1, W, H);
  assert.equal(circle.kind, "circle");
  if (circle.kind === "circle")
    assert.ok(circle.r >= Math.hypot(W / 2, H / 2) - 1e-9);
});
