<script setup>
import { computed } from 'vue';
import CompareSlider from './CompareSlider.vue';
import { formatBytes } from '../lib/imageProcessor.js';

const props = defineProps({
  item: { type: Object, required: true },
});

const emit = defineEmits(['download', 'remove', 'retry']);

/* 压缩状态提示：已达标 / 未达标 / 已达最低分辨率 */
const hint = computed(() => {
  const it = props.item;
  if (it.status !== 'done') return null;
  const target = it.targetKB || 200;
  if (it.atMin) {
    return it.reachedTarget
      ? `✓ 已达标 · 已达最低分辨率 ${it.resultWidth}×${it.resultHeight}`
      : `⚠ 已达最低分辨率 ${it.resultWidth}×${it.resultHeight}，无法再次压缩`;
  }
  return it.reachedTarget
    ? `✓ 已达标（目标 ${target} KB）· 可点「再来一次」压得更小`
    : `⚠ 未达目标 ${target} KB · 可点「再来一次」降低分辨率`;
});

const stateLabel = computed(() => {
  const s = props.item.status;
  if (s === 'processing') return '处理中';
  if (s === 'done') return '完成';
  if (s === 'error') return '失败';
  return '等待中';
});

const stateClass = computed(() => props.item.status);

const savePercent = computed(() => {
  const { origSize, resultSize } = props.item;
  if (!resultSize || !origSize) return null;
  return ((1 - resultSize / origSize) * 100).toFixed(1);
});

function download() {
  emit('download', props.item);
}
</script>

<template>
  <div class="image-card">
    <div class="card-head">
      <span class="card-name" :title="item.name">{{ item.name }}</span>
      <span class="card-state" :class="stateClass">{{ stateLabel }}</span>
    </div>

    <div class="card-body">
      <div v-if="item.status === 'processing'" style="text-align: center; padding: 40px 0">
        <div style="font-size: 28px; margin-bottom: 10px">⚙️</div>
        <div style="color: var(--text-dim); font-size: 13px">正在处理，请稍候…</div>
        <div class="progress"><div class="progress-bar" :style="{ width: (item.progress || 5) + '%' }"></div></div>
      </div>

      <template v-else-if="item.resultUrl">
        <CompareSlider :before-url="item.origUrl" :after-url="item.resultUrl" />
      </template>

      <template v-else-if="item.origUrl">
        <img :src="item.origUrl" alt="原图" style="width: 100%; display: block" />
      </template>

      <div v-if="item.error" style="color: var(--danger); font-size: 13px; margin-top: 8px">
        {{ item.error }}
      </div>
    </div>

    <div v-if="item.status === 'done'" class="card-stats">
      <div class="stat">
        <div class="stat-label">原图</div>
        <div class="stat-value red">{{ formatBytes(item.origSize) }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">压缩后</div>
        <div class="stat-value green">{{ formatBytes(item.resultSize) }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">尺寸</div>
        <div class="stat-value" style="font-size: 13px">
          {{ item.resultWidth }} × {{ item.resultHeight }}
        </div>
      </div>
      <div class="stat">
        <div class="stat-label">输出格式</div>
        <div class="stat-value" style="font-size: 13px">{{ item.resultType === 'image/png' ? 'PNG' : 'JPG' }}</div>
      </div>
      <div v-if="savePercent !== null" class="save-badge">共节省 {{ savePercent }}%</div>
    </div>

    <!-- 压缩状态提示 -->
    <div
      v-if="hint"
      class="card-hint"
      :class="{ warn: !item.reachedTarget && !item.atMin, min: item.atMin && !item.reachedTarget }"
    >
      {{ hint }}
    </div>

    <div v-if="item.status === 'done'" class="card-foot">
      <button class="btn btn-primary" @click="download">⬇ 下载</button>
      <button
        class="btn btn-ghost"
        :disabled="item.atMin"
        :title="item.atMin ? '已达最低分辨率，无法再次压缩' : '降低一档分辨率重新压缩'"
        @click="emit('retry', item)"
      >
        ↻ 再来一次
      </button>
      <button class="btn btn-ghost" @click="emit('remove', item)">移除</button>
    </div>
  </div>
</template>
