<script setup>
import { computed } from 'vue';
import CompareSlider from './CompareSlider.vue';
import { formatBytes } from '../lib/imageProcessor.js';

const props = defineProps({
  item: { type: Object, required: true },
});

const emit = defineEmits(['download', 'remove']);

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

    <div v-if="item.status === 'done'" class="card-foot">
      <button class="btn btn-primary" @click="download">⬇ 下载</button>
      <button class="btn btn-ghost" @click="emit('remove', item)">移除</button>
    </div>
  </div>
</template>
