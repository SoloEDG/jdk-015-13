<script setup lang="ts">
import { computed, ref } from "vue";
import type { Entrance, StageDocument } from "../../../shared/types";
import type { SceneStore } from "../model/sceneStore";
import type { StageApi } from "../../visuals/model/renderer";
import { catalog } from "../lib/catalog";
import {
  cloneEntrance,
  describeEntrance,
  durationUnits,
  entranceModes,
  revealShapes,
  wipeDirections,
} from "../lib/entranceCatalog";

const props = defineProps<{
  doc: StageDocument;
  store: SceneStore;
  stage: StageApi | null;
  bpm: number;
}>();

/** 正在编辑入场方式的场景 id；编辑的是草稿，正式演出版本在“保存”前保持不变 */
const editingId = ref<string | null>(null);
const draft = ref<Entrance | null>(null);

const editingScene = computed(() =>
  props.doc.scenes.find((s) => s.id === editingId.value),
);

const durationBounds = computed(() =>
  draft.value?.unit === "beats"
    ? { min: 0, max: 16, step: 1 }
    : { min: 0, max: 8, step: 0.1 },
);

/** 拍数换算预览：让使用者在编辑时就看到按当前 BPM 结算的秒数 */
const draftSeconds = computed(() => {
  if (!draft.value) return 0;
  if (draft.value.unit === "seconds") return draft.value.duration;
  const safeBpm = Math.min(300, Math.max(40, props.bpm > 0 ? props.bpm : 120));
  return draft.value.duration * (60 / safeBpm);
});

function openEditor(id: string) {
  const scene = props.doc.scenes.find((s) => s.id === id);
  if (!scene) return;
  if (editingId.value && editingId.value !== id) props.stage?.stopPreview();
  editingId.value = id;
  draft.value = cloneEntrance(scene.entrance);
}

function closeEditor() {
  props.stage?.stopPreview();
  editingId.value = null;
  draft.value = null;
}

/** 预演：播放草稿，但不改写场景已保存的入场方式，也不动 activeId/在途契约 */
function preview() {
  if (!editingId.value || !draft.value) return;
  props.stage?.previewEntrance(editingId.value, draft.value);
}

/** 保存：写入场景参数；正在演出的转场契约是触发时的快照，不会被回溯修改 */
function save() {
  if (!editingScene.value || !draft.value) return;
  editingScene.value.entrance = cloneEntrance(draft.value);
  props.stage?.stopPreview();
  editingId.value = null;
  draft.value = null;
}
</script>
<template>
  <section class="panel scene-panel">
    <div class="panel-heading">
      <span>02 / SCENE COLLECTION</span><span>04</span>
    </div>
    <div v-for="(s, i) in doc.scenes" :key="s.id" class="scene-block">
      <button
        class="scene-row"
        :class="{ active: doc.activeId === s.id }"
        @click="store.select(s.id)"
      >
        <div class="scene-thumb" :class="s.kind">
          {{ catalog.find((c) => c.kind === s.kind)?.icon }}
        </div>
        <div class="scene-meta">
          <strong>{{ s.name }}</strong>
          <small>{{ describeEntrance(s.entrance) }}</small>
        </div>
        <kbd>{{ i + 1 }}</kbd>
      </button>
      <button
        class="entrance-edit-btn"
        :class="{ open: editingId === s.id }"
        @click="editingId === s.id ? closeEditor() : openEditor(s.id)"
      >
        {{ editingId === s.id ? "收起入场编辑" : "编辑入场方式" }}
      </button>

      <div v-if="editingId === s.id && draft" class="entrance-editor">
        <p class="editor-note">
          草稿仅作用于预演；保存后从下一次正式切场生效，不影响正在演出的版本。
        </p>
        <div class="entrance-grid">
          <button
            v-for="m in entranceModes"
            :key="m.id"
            class="entrance-choice"
            :class="{ selected: draft.mode === m.id }"
            :title="m.hint"
            @click="draft.mode = m.id"
          >
            {{ m.label }}
          </button>
        </div>

        <div v-if="draft.mode === 'wipe'" class="entrance-grid">
          <button
            v-for="d in wipeDirections"
            :key="d.id"
            class="entrance-choice small"
            :class="{ selected: draft.direction === d.id }"
            @click="draft.direction = d.id"
          >
            <i>{{ d.arrow }}</i>{{ d.label }}
          </button>
        </div>

        <div v-if="draft.mode === 'reveal'" class="entrance-grid">
          <button
            v-for="sh in revealShapes"
            :key="sh.id"
            class="entrance-choice small"
            :class="{ selected: draft.shape === sh.id }"
            @click="draft.shape = sh.id"
          >
            {{ sh.label }}
          </button>
        </div>

        <div class="unit-switch">
          <button
            v-for="u in durationUnits"
            :key="u.id"
            class="entrance-choice small"
            :class="{ selected: draft.unit === u.id }"
            @click="draft.unit = u.id"
          >
            时长 / {{ u.label }}
          </button>
        </div>
        <label class="control entrance-duration"
          >转场时长
          <b>{{ draft.duration }} {{ draft.unit === "beats" ? "拍" : "秒" }}</b>
          <input
            type="range"
            :min="durationBounds.min"
            :max="durationBounds.max"
            :step="durationBounds.step"
            v-model.number="draft.duration"
        /></label>
        <small class="duration-convert">
          按当前 {{ bpm }} BPM 结算 ≈ {{ draftSeconds.toFixed(2) }} 秒
          <em v-if="draft.duration === 0">（零时长 = 触发当帧硬切）</em>
        </small>

        <div class="editor-actions">
          <button class="preview-btn" @click="preview">预演草稿</button>
          <button class="stop-preview-btn" @click="stage?.stopPreview()">
            停止预演
          </button>
          <button class="save-btn" @click="save">保存入场</button>
        </div>
      </div>
    </div>
  </section>
</template>
