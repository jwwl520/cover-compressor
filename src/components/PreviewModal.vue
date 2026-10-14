<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import CompareSlider from './CompareSlider.vue';
import { formatBytes } from '../lib/imageProcessor.js';
import { compressHint } from '../lib/hints.js';

const props = defineProps({
  item: { type: Object, default: null }, // null = 关闭
});

const emit = defineEmits(['close', 'download', 'retry', 'remove']);

const stageEl = ref(null);
const fitStyle = ref({}); // 计算出的预览尺寸（等比适应窗口）
const ratio = ref(null);  // 图片宽高比

const hint = computed(() => compressHint(props.item));

/* 按容器可用区域等比计算预览尺寸（contain 逻辑） */
function recompute() {
  const stage = stageEl.value;
  if (!stage || !ratio.value) return;
  // clientWidth/Height 含 padding，扣除后才是真实可用区域（否则图片会溢出边框）
  const cs = getComputedStyle(stage);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const W = stage.clientWidth - padX;
  const H = stage.clientHeight - padY;
  if (W <= 0 || H <= 0) return;
  let w = W;
  let h = W / ratio.value;
  if (h > H) {
    h = H;
    w = H * ratio.value;
  }
  fitStyle.value = { width: `${Math.floor(w)}px`, height: `${Math.floor(h)}px` };
}

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}

function cleanup() {
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', recompute);
  document.body.style.overflow = '';
}

watch(
  () => props.item,
  (it) => {
    if (it) {
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', recompute);
      document.body.style.overflow = 'hidden';
      // 取原图宽高比（等比适应窗口）
      ratio.value = null;
      fitStyle.value = {};
      const img = new Image();
      img.onload = () => {
        ratio.value = img.naturalWidth / img.naturalHeight;
        nextTick(recompute);
      };
      img.src = it.origUrl;
    } else {
      cleanup();
    }
  }
);

onBeforeUnmount(cleanup);
</script>

<template>
  <div v-if="item" class="pv-mask" @click.self="emit('close')">
    <div class="pv" role="dialog" aria-modal="true">
      <!-- 顶部：文件名 + 数据 -->
      <div class="pv-head">
        <div class="pv-title">
          <span class="pv-name" :title="item.name">{{ item.name }}</span>
          <span class="pv-meta">
            {{ formatBytes(item.origSize) }} → <b>{{ formatBytes(item.resultSize) }}</b> ·
            {{ item.resultWidth }} × {{ item.resultHeight }} ·
            {{ item.resultType === 'image/png' ? 'PNG' : 'JPG' }}
          </span>
        </div>
        <button class="dlg-x" aria-label="关闭" @click="emit('close')">×</button>
      </div>

      <!-- 预览舞台（点击遮罩可关闭，拖动滑块对比） -->
      <div ref="stageEl" class="pv-stage">
        <div class="pv-fit" :style="fitStyle">
          <CompareSlider :before-url="item.origUrl" :after-url="item.resultUrl" />
        </div>
      </div>

      <!-- 底部：提示 + 操作按钮 -->
      <div class="pv-foot">
        <span v-if="hint" class="pv-hint" :class="{ warn: !item.reachedTarget }">{{ hint }}</span>
        <div class="pv-actions">
          <button class="btn btn-primary" @click="emit('download', item)">⬇ 下载</button>
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
    </div>
  </div>
</template>
