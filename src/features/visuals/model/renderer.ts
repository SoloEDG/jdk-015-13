import type { Analysis, Entrance, Scene, StageDocument } from "../../../shared/types";
import { getTheme } from "./themes";
import { drawScene } from "../lib/geometry";
import { clipToMask, entranceMask } from "../lib/mask";
import { TransitionEngine, type TransitionEngineApi } from "./transitionEngine";

export const STAGE_W = 1280;
export const STAGE_H = 720;

export interface StageApi {
  /** 转场引擎（只读 HUD + 预演控制） */
  engine: TransitionEngineApi;
  /** 预演某场景的入场草稿：只在叠层播放，不改变正在演出的版本/身份 */
  previewEntrance: (sceneId: string, draft: Entrance) => void;
  stopPreview: () => void;
  dispose: () => void;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  doc: StageDocument,
  read: () => Analysis,
  bpm: () => number,
): StageApi {
  const c = canvas.getContext("2d")!;
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;

  // 正式转场期间保存“上一画面”的基底（连续切换时为切换前的合成帧）
  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = STAGE_W;
  baseCanvas.height = STAGE_H;
  const baseCtx = baseCanvas.getContext("2d")!;

  // 预演叠层：独立 canvas，CSS 覆盖在舞台上；不属于 captureStream，录制不到
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = STAGE_W;
  previewCanvas.height = STAGE_H;
  const pc = previewCanvas.getContext("2d")!;
  previewCanvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
  canvas.parentElement?.appendChild(previewCanvas);

  // 预演基底：开始预演当下的正式输出快照
  const previewBase = document.createElement("canvas");
  previewBase.width = STAGE_W;
  previewBase.height = STAGE_H;
  const pbc = previewBase.getContext("2d")!;

  const engine = new TransitionEngine();
  // 开场即把当前正式场景登记为已落定，避免首帧误判为切场
  engine.init(doc.activeId);
  let raf = 0,
    last = 0,
    now = 0,
    phase = 0,
    previewSceneId = "";

  function findScene(id: string): Scene {
    return doc.scenes.find((s) => s.id === id) ?? doc.scenes[0];
  }

  function render(ms: number) {
    const dt = Math.min(0.08, (ms - last) / 1000) || 0;
    last = ms;
    now = ms;
    const active = findScene(doc.activeId);
    const a = read();

    // 正式切场检测：
    // - 无在途契约且 activeId 变化 → 普通切场
    // - 有在途契约但目标与契约不同 → 连续切换，立刻以当前合成帧为新基底再定契约
    const contract = engine.current;
    if (
      doc.activeId !== engine.hud.activeTargetId &&
      (!contract || contract.targetId !== doc.activeId)
    ) {
      baseCtx.clearRect(0, 0, STAGE_W, STAGE_H);
      baseCtx.drawImage(canvas, 0, 0);
      engine.trigger(doc.activeId, active.entrance, bpm(), ms);
    }

    if (!doc.frozen) phase += dt * active.speed;

    const live = engine.update(ms, a.bass);
    const target = findScene(live ? live.targetId : doc.activeId);

    // 1) 基底：在途时画冻结的上一画面，否则画当前正式场景
    if (live) {
      c.drawImage(baseCanvas, 0, 0);
    } else {
      drawScene(c, STAGE_W, STAGE_H, active, a, getTheme(active.theme), phase, doc.sensitivity);
    }

    // 2) 按契约把目标画面合成进来（几何遮罩与淡化共用同一 backing 像素坐标）
    if (live) {
      const p = engine.hud.progress;
      const ent = live.entrance;
      if (ent.mode === "fade") {
        c.globalAlpha = p;
        drawScene(c, STAGE_W, STAGE_H, target, a, getTheme(target.theme), phase, doc.sensitivity);
        c.globalAlpha = 1;
      } else {
        clipToMask(c, entranceMask(ent, p, STAGE_W, STAGE_H), () => {
          drawScene(c, STAGE_W, STAGE_H, target, a, getTheme(target.theme), phase, doc.sensitivity);
        });
      }
    }

    // 3) 闪光/黑场/亮度只作用于正式输出
    if (doc.strobe && a.beat) {
      c.fillStyle = "#ffffff66";
      c.fillRect(0, 0, STAGE_W, STAGE_H);
    }
    c.fillStyle = `rgba(0,0,0,${doc.blackout ? 1 : 1 - doc.master})`;
    c.fillRect(0, 0, STAGE_W, STAGE_H);

    // 4) 预演叠层：与正式输出、录制流完全隔离
    renderPreview(a);

    raf = requestAnimationFrame(render);
  }

  function renderPreview(a: Analysis) {
    if (!engine.isPreviewing || !previewSceneId) {
      pc.clearRect(0, 0, STAGE_W, STAGE_H);
      return;
    }
    const ent = engine.previewEntrance!;
    const p = engine.hud.previewProgress;
    const target = findScene(previewSceneId);
    pc.clearRect(0, 0, STAGE_W, STAGE_H);
    pc.drawImage(previewBase, 0, 0);
    if (ent.mode === "fade") {
      pc.globalAlpha = p;
      drawScene(pc, STAGE_W, STAGE_H, target, a, getTheme(target.theme), phase, doc.sensitivity);
      pc.globalAlpha = 1;
    } else {
      clipToMask(pc, entranceMask(ent, p, STAGE_W, STAGE_H), () => {
        drawScene(pc, STAGE_W, STAGE_H, target, a, getTheme(target.theme), phase, doc.sensitivity);
      });
    }
  }

  raf = requestAnimationFrame(render);

  function dispose() {
    cancelAnimationFrame(raf);
    previewCanvas.remove();
    engine.stopPreview();
  }

  return {
    engine,
    dispose,
    previewEntrance(sceneId: string, draft: Entrance) {
      // 快照当下正式输出作为预演基底；不触碰 activeId 与在途契约
      pbc.clearRect(0, 0, STAGE_W, STAGE_H);
      pbc.drawImage(canvas, 0, 0);
      previewSceneId = sceneId;
      // 与正式转场共用 rAF 时钟，避免起点不同造成首帧进度跳变
      engine.startPreview(draft, bpm(), now, true);
    },
    stopPreview() {
      engine.stopPreview();
      previewSceneId = "";
    },
  };
}
