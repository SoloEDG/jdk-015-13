/**
 * 渲染器接线测试：用桩件 Canvas / 2D 上下文 / rAF，
 * 验证切场触发契约、遮罩合成、基底快照、预演叠层隔离与零时长行为。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRenderer } from "./renderer";
import type { TransitionContract } from "./transitionEngine";
import { createDocument } from "../../../shared/document";
import type { Analysis } from "../../../shared/types";

// ---- 桩件 2D 上下文：记录关键调用，几何方法做成 no-op ----
function makeCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    shadowColor: "",
    shadowBlur: 0,
    globalAlpha: 1,
    calls,
    fillRect(...a: number[]) {
      calls.push({ name: "fillRect", args: a });
    },
    clearRect(...a: number[]) {
      calls.push({ name: "clearRect", args: a });
    },
    drawImage(...a: unknown[]) {
      calls.push({ name: "drawImage", args: a });
    },
    save() {
      calls.push({ name: "save", args: [] });
    },
    restore() {
      calls.push({ name: "restore", args: [] });
    },
    beginPath() {},
    clip() {
      calls.push({ name: "clip", args: [] });
    },
    rect() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    fill() {},
    stroke() {},
    translate() {},
    rotate() {},
    setLineDash() {},
  };
  return ctx;
}

type StubCtx = ReturnType<typeof makeCtx>;

function makeCanvas(ctx: StubCtx) {
  return {
    width: 0,
    height: 0,
    style: { cssText: "" },
    parentElement: { appendChild() {} },
    remove() {},
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

const silence = (): Analysis => ({
  bins: new Array(128).fill(0),
  wave: new Array(256).fill(0),
  rms: 0,
  bass: 0,
  beat: false,
  time: 0,
});

function harness() {
  // rAF 桩：捕获回调，由测试手动驱动帧
  let frame: ((ms: number) => void) | null = null;
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (ms: number) => void) => {
    frame = cb;
    return 1;
  };
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
  const created: StubCtx[] = [];
  const origCreate = globalThis.document?.createElement;
  (globalThis as Record<string, unknown>).document = {
    ...(globalThis.document ?? {}),
    createElement(tag: string) {
      if (tag === "canvas") {
        const ctx = makeCtx();
        created.push(ctx);
        return makeCanvas(ctx);
      }
      return origCreate ? origCreate.call(globalThis.document, tag) : {};
    },
  };
  const doc = createDocument();
  const mainCtx = makeCtx();
  const canvas = makeCanvas(mainCtx);
  const api = createRenderer(canvas, doc, silence, () => 120);
  const tick = (ms: number) => {
    const f = frame;
    frame = null;
    f?.(ms);
  };
  return { doc, api, mainCtx, created, tick };
}

test("切场后触发契约：主画布先画基底快照，再用遮罩合成目标", () => {
  const { doc, api, mainCtx, created, tick } = harness();
  // 显式指定 s2 为方向擦除，不依赖默认文档
  doc.scenes[1].entrance = {
    ...doc.scenes[1].entrance,
    mode: "wipe",
    direction: "left",
    duration: 1,
    unit: "seconds",
  };
  tick(0); // 首帧：s1 稳态，无契约
  const initial: TransitionContract | null = api.engine.current;
  assert.equal(initial, null);

  doc.activeId = "s2";
  tick(100);
  const contract: TransitionContract | null = api.engine.current;
  if (!contract) throw new assert.AssertionError({ message: "切场当帧应建立转场契约" });
  assert.equal(contract.targetId, "s2");
  assert.equal(contract.entrance.mode, "wipe");

  // 基底 canvas（created[0]）在触发时收到 drawImage(canvas) 快照
  const baseCtx = created[0];
  assert.ok(baseCtx.calls.some((c) => c.name === "drawImage"));
  // 主画布在途期间先 drawImage 基底，再 clip 遮罩合成
  const afterTrigger = mainCtx.calls;
  assert.ok(afterTrigger.some((c) => c.name === "drawImage"));
  assert.ok(afterTrigger.some((c) => c.name === "clip"), "wipe 必须走几何遮罩 clip");

  // 推进到约定结束之后：契约完成，恢复稳态直画
  tick(2000);
  assert.equal(api.engine.current, null);
  api.dispose();
});

test("预演只在独立叠层上下文绘制，不产生正式契约、不改 activeId", () => {
  const { doc, api, mainCtx, created, tick } = harness();
  tick(0);
  const before = mainCtx.calls.length;

  api.previewEntrance("s3", {
    mode: "reveal",
    duration: 1,
    unit: "seconds",
    direction: "left",
    shape: "circle",
  });
  tick(500);

  assert.equal(api.engine.current, null, "预演不得建立正式契约");
  assert.equal(doc.activeId, "s1", "预演不得改变正式场景身份");
  assert.equal(api.engine.isPreviewing, true);

  // 预演叠层是第三个上下文（0=基底 1=预演叠层 2=预演基底），主画布调用数不增长遮罩
  const previewLayerCtx = created[1];
  assert.ok(previewLayerCtx.calls.some((c) => c.name === "clip"));
  // 主画布在预演期间不新增 clip（仍只有正式输出绘制）
  const mainClips = mainCtx.calls.slice(before).filter((c) => c.name === "clip").length;
  assert.equal(mainClips, 0);

  api.stopPreview();
  tick(600);
  assert.equal(api.engine.isPreviewing, false);
  api.dispose();
});

test("零时长切场：下一帧立即完成，主画布无 clip 中间态", () => {
  const { doc, api, mainCtx, tick } = harness();
  tick(0);
  doc.scenes[1].entrance = {
    ...doc.scenes[1].entrance,
    duration: 0,
    mode: "wipe",
  };
  doc.activeId = "s2";
  const before = mainCtx.calls.length;
  tick(100); // 触发同帧 update → 立即完成
  assert.equal(api.engine.current, null);
  assert.equal(api.engine.hud.liveContractId, null);
  assert.equal(api.engine.hud.activeTargetId, "s2"); // 身份已落定
  // 零时长没有在途帧，因此主画布不会出现 clip 合成
  assert.equal(
    mainCtx.calls.slice(before).filter((c) => c.name === "clip").length,
    0,
  );
  api.dispose();
});

test("连续切换：在途期间再切场，以当前合成帧为新基底并生成新契约 id", () => {
  const { doc, api, tick } = harness();
  tick(0);
  doc.activeId = "s2";
  tick(100);
  const first: TransitionContract | null = api.engine.current;
  if (!first) throw new assert.AssertionError({ message: "应存在在途契约" });
  const firstId = first.id;

  // 转场未完成时立刻切到 s3
  doc.activeId = "s3";
  tick(200);
  const second: TransitionContract | null = api.engine.current;
  if (!second) throw new assert.AssertionError({ message: "连续切换后应存在新契约" });
  assert.equal(second.targetId, "s3");
  assert.ok(second.id > firstId, "连续切换契约 id 单调递增");
  api.dispose();
});
