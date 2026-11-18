import { reactive } from "vue";
import type { Entrance } from "../../../shared/types";
import { entranceSeconds } from "../../../shared/types";
import { clamp } from "../../../shared/math";

/**
 * 触发瞬间冻结下来的“本次转场契约”。
 * 演出中敲击改速只会更新 BPM 读数；seconds 在触发时已经结算，
 * 之后任何参数变化都不能把当前转场拉回起点或改变其终点。
 */
export interface TransitionContract {
  id: number;
  targetId: string;
  /** 触发时的入场参数快照（深拷贝，编辑场景不影响在途契约） */
  entrance: Entrance;
  /** 触发时按 BPM 结算好的秒数；拍数单位在此刻换算完毕 */
  seconds: number;
  startMs: number;
  /** 低频跟随的有界累积量：只增不减，保证静音也不回退 */
  expandCarry: number;
}

export interface TransitionHud {
  /**
   * 最近一次落定（或正在进入）的正式场景 id。
   * 开场即初始化为当前 activeId；契约完成后保持为目标 id，
   * 因此“无在途契约”不会被误判成一次新切场。
   */
  activeTargetId: string | null;
  /** 在途契约 id；null 表示当前没有正在播放的转场（正式输出身份稳定） */
  liveContractId: number | null;
  /** 最近一次触发的契约 id（每次触发单调递增），用于区分连续切换身份 */
  contractId: number;
  /** 在途契约 0..1 进度，无在途转场时为 0 */
  progress: number;
  /** 预演是否正在播放（预演不改变正式输出身份） */
  previewing: boolean;
  previewProgress: number;
}

/**
 * 进度归属约定（核心）：
 * - 舞台节奏（可重复）：时间线进度 pTime 拥有“完成”的所有权，
 *   到约定结束时刻必然 = 1，目标画面必然完整进入；
 * - 随机即兴（音乐响应）：低频能量只允许通过有界、单调的叠加量
 *   推进扩张进度，永不回退、永不越过时间线终点。
 *   持续静音时叠加量保持为 0，时间线仍按时把画面送到 100%，
 *   不会卡在半幅画面。
 */
const EXPAND_CAP = 0.35; // 即兴部分最多让扩张提前到 65% 时间处完成
const EXPAND_GAIN = 0.9;

/** 引擎对外结构类型（避免 Vue emit 解包剥离类私有成员） */
export interface TransitionEngineApi {
  readonly hud: TransitionHud;
  readonly current: TransitionContract | null;
  readonly isPreviewing: boolean;
  readonly previewEntrance: Entrance | null;
  init(activeId: string): void;
  trigger(
    targetId: string,
    entrance: Entrance,
    bpm: number,
    ms: number,
  ): TransitionContract;
  startPreview(entrance: Entrance, bpm: number, ms: number, loops?: boolean): void;
  stopPreview(): void;
  update(ms: number, bass: number): TransitionContract | null;
}

export class TransitionEngine implements TransitionEngineApi {
  readonly hud = reactive<TransitionHud>({
    activeTargetId: null,
    liveContractId: null,
    contractId: 0,
    progress: 0,
    previewing: false,
    previewProgress: 0,
  });

  private contract: TransitionContract | null = null;
  private seq = 0;
  private preview:
    | { entrance: Entrance; seconds: number; startMs: number; loops: boolean }
    | null = null;

  /** 开场对齐：把当前正式场景登记为已落定，避免首帧误触发切场 */
  init(activeId: string) {
    this.hud.activeTargetId = activeId;
  }

  /** 正式切场：在触发时刻确定本次转场契约 */
  trigger(
    targetId: string,
    entrance: Entrance,
    bpm: number,
    ms: number,
  ): TransitionContract {
    const contract: TransitionContract = {
      id: ++this.seq,
      targetId,
      // 深拷贝快照：之后编辑场景参数不会改写在途契约
      entrance: { ...entrance },
      seconds: entranceSeconds(entrance, bpm),
      startMs: ms,
      expandCarry: 0,
    };
    this.contract = contract;
    this.hud.activeTargetId = targetId;
    this.hud.liveContractId = contract.id;
    this.hud.contractId = contract.id;
    this.hud.progress = contract.seconds === 0 ? 1 : 0;
    return contract;
  }

  /** 预演入口：独立时间线，可循环；绝不触碰正式契约与 activeId */
  startPreview(entrance: Entrance, bpm: number, ms: number, loops = true) {
    this.preview = {
      entrance: { ...entrance },
      seconds: entranceSeconds(entrance, bpm),
      startMs: ms,
      loops,
    };
    this.hud.previewing = true;
    this.hud.previewProgress = 0;
  }

  stopPreview() {
    this.preview = null;
    this.hud.previewing = false;
    this.hud.previewProgress = 0;
  }

  get current(): TransitionContract | null {
    return this.contract;
  }

  get isPreviewing(): boolean {
    return this.preview !== null;
  }

  get previewEntrance(): Entrance | null {
    return this.preview ? this.preview.entrance : null;
  }

  /**
   * 每帧推进。返回正式契约（若在途）。
   * 时间戳采用 rAF 的绝对 ms：暂停音频/冻结画面都不暂停约定时钟，
   * 后台恢复后 dt 再大也只是让进度跳到对应位置，不会重放或回到起点。
   */
  update(ms: number, bass: number): TransitionContract | null {
    if (this.contract) {
      const c = this.contract;
      if (c.seconds === 0) {
        // 零时长：当帧立即完成，身份明确，无半幅中间态
        this.finishContract();
      } else {
        const pTime = clamp((ms - c.startMs) / (c.seconds * 1000), 0, 1);
        let p = pTime;
        if (c.entrance.mode === "expand") {
          // 低频驱动的即兴叠加：有界 + 单调（只增不减）
          if (bass > 0) c.expandCarry = Math.min(EXPAND_CAP, c.expandCarry + bass * 0.02 * EXPAND_GAIN);
          // 叠加量随时间线消耗：保证 p=1 恰好在约定结束时刻发生
          p = clamp(pTime + c.expandCarry * (1 - pTime), 0, 1);
        }
        this.hud.progress = p;
        if (pTime >= 1) this.finishContract();
      }
    }
    if (this.preview) {
      const pv = this.preview;
      if (pv.seconds === 0) {
        // 零时长预演：在“完整目标画面/完整基底画面”间每秒脉冲，演示硬切边缘
        this.hud.previewProgress = Math.floor(ms / 600) % 2 === 0 ? 1 : 0;
      } else {
        const raw = (ms - pv.startMs) / (pv.seconds * 1000);
        if (raw >= 1.6 && pv.loops) {
          // 留出停留时间后循环，便于反复观察边缘
          pv.startMs = ms;
          this.hud.previewProgress = 0;
        } else {
          this.hud.previewProgress = clamp(raw > 1 ? 1 : raw, 0, 1);
        }
      }
    }
    return this.contract;
  }

  private finishContract() {
    const finishedId = this.contract?.targetId ?? null;
    this.contract = null;
    // 在途身份清空，但保留已落定场景，渲染器据此判断是否发生新切场
    this.hud.liveContractId = null;
    this.hud.activeTargetId = finishedId;
    this.hud.progress = 0;
  }
}
