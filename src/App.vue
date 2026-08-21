<script setup>
import { ref, reactive, watch, computed, nextTick } from 'vue';
import ImageCard from './components/ImageCard.vue';
import {
  decodeImage,
  compressImage,
  formatBytes,
  extFor,
} from './lib/imageProcessor.js';
import { zipSync } from 'fflate';

/* ---------- 状态 ---------- */
const items = ref([]);
const processing = ref(false);
const isDragging = ref(false);
const fileInput = ref(null);

const settings = reactive({
  targetKB: 200,
  outType: 'image/jpeg', // image/jpeg | image/png
  sizeMode: 'original',  // original | maxEdge | custom | percent
  maxEdge: 1920,
  customW: 1600,
  customH: null,
  percent: 80,
});

const totalOriginal = computed(() => items.value.reduce((s, i) => s + (i.origSize || 0), 0));
const totalResult = computed(() => items.value.reduce((s, i) => s + (i.resultSize || 0), 0));
const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length);
const hasWork = computed(() => items.value.some((i) => i.status !== 'done'));

/* ---------- 上传 ---------- */
function onPick() {
  fileInput.value.click();
}
function onInputChange(e) {
  addFiles(e.target.files);
  e.target.value = '';
}
function onDrop(e) {
  isDragging.value = false;
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
}
function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  for (const file of files) {
    items.value.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      origSize: file.size,
      origUrl: URL.createObjectURL(file),
      origWidth: null,
      origHeight: null,
      status: 'pending',
      progress: 0,
      resultUrl: null,
      resultSize: null,
      resultWidth: null,
      resultHeight: null,
      resultType: null,
      error: null,
    });
  }
}

/* ---------- 单张压缩 ---------- */
async function compressOne(item) {
  item.status = 'processing';
  item.progress = 5;
  item.error = null;
  let bitmap = null;
  try {
    bitmap = await decodeImage(item.file);
    item.progress = 20;
    await nextTick();
    item.origWidth = bitmap.width;
    item.origHeight = bitmap.height;

    const sizeValue =
      settings.sizeMode === 'maxEdge' ? settings.maxEdge
      : settings.sizeMode === 'custom' ? { width: settings.customW, height: settings.customH }
      : settings.sizeMode === 'percent' ? settings.percent
      : null;

    const result = await compressImage(bitmap, {
      targetKB: settings.targetKB,
      outType: settings.outType,
      sizeMode: settings.sizeMode,
      sizeValue,
      maxEdge: 4096,
      minEdge: 480,
    });

    // 释放旧结果
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.resultUrl = URL.createObjectURL(result.blob);
    item.resultSize = result.blob.size;
    item.resultWidth = result.width;
    item.resultHeight = result.height;
    item.resultType = settings.outType;
    item.progress = 100;
    item.status = 'done';
  } catch (err) {
    console.error(err);
    item.status = 'error';
    item.error = err?.message || '压缩失败';
  } finally {
    if (bitmap) bitmap.close();
  }
}

/* ---------- 批量压缩（串行，控制内存） ---------- */
async function compressAll() {
  if (processing.value) return;
  processing.value = true;
  try {
    for (const item of items.value) {
      if (item.status === 'done' || item.status === 'processing') continue;
      await compressOne(item);
    }
  } finally {
    processing.value = false;
  }
}

/* 设置变化 -> 仅将已完成/失败项标记为等待中，需用户点击"开始处理"后才压缩 */
watch(
  () => [
    settings.targetKB,
    settings.outType,
    settings.sizeMode,
    settings.maxEdge,
    settings.customW,
    settings.customH,
    settings.percent,
  ],
  () => {
    for (const item of items.value) {
      if (item.status === 'done' || item.status === 'error') {
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        item.status = 'pending';
        item.resultUrl = null;
        item.resultSize = null;
        item.resultWidth = null;
        item.resultHeight = null;
        item.resultType = null;
        item.error = null;
      }
    }
  }
);

/* ---------- 下载 ---------- */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function downloadOne(item) {
  if (!item.resultUrl) return;
  const base = item.name.replace(/\.[^.]+$/, '');
  const ext = extFor(item.resultType);
  fetch(item.resultUrl)
    .then((r) => r.blob())
    .then((blob) => downloadBlob(blob, `${base}-compressed.${ext}`));
}

async function downloadAll() {
  const done = items.value.filter((i) => i.resultUrl && i.status === 'done');
  if (!done.length) return;
  try {
    const files = {};
    for (const item of done) {
      const blob = await fetch(item.resultUrl).then((r) => r.blob());
      const buf = new Uint8Array(await blob.arrayBuffer());
      const base = item.name.replace(/\.[^.]+$/, '');
      files[`${base}.${extFor(item.resultType)}`] = buf;
    }
    const zipped = zipSync(files, { level: 6 });
    downloadBlob(new Blob([zipped], { type: 'application/zip' }), '封面压缩-打包下载.zip');
  } catch (err) {
    console.error(err);
  }
}

function removeItem(item) {
  const idx = items.value.indexOf(item);
  if (idx > -1) {
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    URL.revokeObjectURL(item.origUrl);
    items.value.splice(idx, 1);
  }
}

function clearAll() {
  for (const item of items.value) {
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    URL.revokeObjectURL(item.origUrl);
  }
  items.value = [];
}

const totalSave = computed(() => {
  if (!totalOriginal.value) return null;
  return ((1 - totalResult.value / totalOriginal.value) * 100).toFixed(1);
});
</script>

<template>
  <!-- 文件选择器（常驻，供各处触发） -->
  <input
    ref="fileInput"
    type="file"
    accept="image/*"
    multiple
    hidden
    @change="onInputChange"
  />

  <main class="app-main">
    <!-- 页面标题 -->
    <section class="page-title">
      <h1>体面的图片压缩</h1>
      <p class="page-subtitle">在线图片压缩 · 纯前端本地处理</p>
    </section>

    <!-- 上传区（始终显示） -->
    <div
      class="upload-zone"
      :class="{ dragover: isDragging }"
      @click="onPick"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="onDrop"
    >
      <div class="upload-icon">📥</div>
      <div class="upload-title">将文件拖入此处或者点击按钮</div>
      <div class="upload-sub">支持 JPG / PNG / WebP / AVIF / BMP 等常见格式</div>
      <div class="upload-hint">所有图片均在本地浏览器中处理，不会上传到服务器</div>
    </div>

    <!-- 风险提示 / 重要说明 -->
    <div class="notice">
      <span class="notice-label">提示 · Note</span>
      本工具为<strong>纯前端</strong>应用，所有图片均在本机浏览器中完成压缩与转换，图片不会上传至任何服务器，也不会被存储。
      处理速度取决于您的设备性能，超大图片可能较慢；为保证最佳兼容性（含 WebP 等格式支持），
      建议使用最新版 Chrome / Edge / Firefox 浏览器。
    </div>

    <!-- 空状态：引擎说明 -->
    <div v-if="!items.length" class="summary-bar engine-note">
      压缩引擎：<b>MozJPEG</b>（JPG） + <b>UPNG 量化</b>（PNG） · 策略：限尺寸 → 二分质量 → 逐级降级
    </div>

    <!-- 有图：设置 + 处理 -->
    <template v-else>
      <!-- 设置面板 -->
      <div class="settings-panel">
        <div class="setting-group">
          <label>目标大小 (KB)</label>
          <div class="setting-control">
            <input type="number" v-model.number="settings.targetKB" min="1" max="2048" />
            <span style="color: var(--text-dim); font-size: 12px">KB</span>
          </div>
        </div>

        <div class="setting-group">
          <label>输出格式</label>
          <div class="seg">
            <button :class="{ active: settings.outType === 'image/jpeg' }" @click="settings.outType = 'image/jpeg'">JPG</button>
            <button :class="{ active: settings.outType === 'image/png' }" @click="settings.outType = 'image/png'">PNG</button>
          </div>
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 6px">
            {{ settings.outType === 'image/jpeg' ? 'MozJPEG 有损，同大小下更清晰' : 'PNG 量化压缩（目标过小会自动降色数）' }}
          </div>
        </div>

        <div class="setting-group">
          <label>尺寸</label>
          <div class="seg" style="margin-bottom: 8px">
            <button :class="{ active: settings.sizeMode === 'original' }" @click="settings.sizeMode = 'original'">原尺寸</button>
            <button :class="{ active: settings.sizeMode === 'maxEdge' }" @click="settings.sizeMode = 'maxEdge'">最长边</button>
            <button :class="{ active: settings.sizeMode === 'custom' }" @click="settings.sizeMode = 'custom'">自定义</button>
            <button :class="{ active: settings.sizeMode === 'percent' }" @click="settings.sizeMode = 'percent'">百分比</button>
          </div>
          <div v-if="settings.sizeMode === 'maxEdge'" class="setting-control">
            <input type="number" v-model.number="settings.maxEdge" min="100" max="8192" />
            <span style="color: var(--text-dim); font-size: 12px">px</span>
          </div>
          <div v-else-if="settings.sizeMode === 'custom'" class="size-custom">
            <input type="number" v-model.number="settings.customW" min="1" placeholder="宽" />
            <span>×</span>
            <input type="number" v-model.number="settings.customH" min="1" placeholder="高(留空=等比)" />
          </div>
          <div v-else-if="settings.sizeMode === 'percent'" class="setting-control">
            <input type="number" v-model.number="settings.percent" min="1" max="100" />
            <span style="color: var(--text-dim); font-size: 12px">%</span>
          </div>
        </div>
      </div>

      <!-- 操作栏 -->
      <div class="action-bar">
        <button class="btn btn-primary" :disabled="processing || !hasWork" @click="compressAll">
          {{ processing ? '处理中…' : hasWork ? '开始处理' : '全部已完成 ✓' }}
        </button>
        <button class="btn btn-ghost" :disabled="processing || !doneCount" @click="downloadAll">
          📦 打包下载全部 ({{ doneCount }})
        </button>
        <button class="btn btn-ghost" @click="onPick">＋ 添加图片</button>
        <button class="btn btn-ghost" @click="clearAll">清空</button>
      </div>

      <div class="summary-bar">
        <span>共 <b>{{ items.length }}</b> 张 · 已完成 <b>{{ doneCount }}</b></span>
        <span v-if="totalResult">原图 {{ formatBytes(totalOriginal) }} → {{ formatBytes(totalResult) }}</span>
        <span v-if="totalSave !== null"><b style="color: var(--success)">节省 {{ totalSave }}%</b></span>
      </div>

      <!-- 图片网格 -->
      <div class="image-grid">
        <ImageCard
          v-for="item in items"
          :key="item.id"
          :item="item"
          @download="downloadOne"
          @remove="removeItem"
        />
      </div>
    </template>
  </main>
</template>
