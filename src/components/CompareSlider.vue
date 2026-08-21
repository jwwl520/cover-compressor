<script setup>
import { ref } from 'vue';

const props = defineProps({
  beforeUrl: { type: String, required: true },
  afterUrl: { type: String, required: true },
});

const pos = ref(50);
const dragging = ref(false);
const wrapEl = ref(null);

function updateFromEvent(e) {
  const rect = wrapEl.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  let pct = (x / rect.width) * 100;
  pct = Math.min(95, Math.max(5, pct));
  pos.value = pct;
}

function onDown(e) {
  dragging.value = true;
  updateFromEvent(e);
}
function onMove(e) {
  if (dragging.value) updateFromEvent(e);
}
function onUp() {
  dragging.value = false;
}
</script>

<template>
  <div
    ref="wrapEl"
    class="compare-wrap"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointerleave="onUp"
    style="touch-action: none"
  >
    <img class="compare-img" :src="beforeUrl" alt="原图" draggable="false" />
    <div class="compare-after" :style="{ width: pos + '%' }">
      <img :src="afterUrl" alt="压缩后" draggable="false" />
    </div>
    <div class="compare-divider" :style="{ left: pos + '%' }"></div>
    <span class="compare-tag">原图</span>
    <span class="compare-tag after">压缩后</span>
  </div>
</template>
