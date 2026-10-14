<script setup>
import { ref, reactive, watch, computed, nextTick, onMounted } from 'vue';
import ImageCard from './components/ImageCard.vue';
import CoverChecker from './components/CoverChecker.vue';
import UsageDialog from './components/UsageDialog.vue';
import PreviewModal from './components/PreviewModal.vue';
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
const auxOpen = ref(false); // 辅助功能折叠区
const rejected = ref([]);   // 被拒绝的非 JPG/PNG 文件名

/* ---------- 使用说明弹窗 ---------- */
const showUsage = ref(false);
const USAGE_KEY = 'cover-compressor:usage-never';

onMounted(() => {
  try {
    if (localStorage.getItem(USAGE_KEY) !== '1') showUsage.value = true;
  } catch {
    showUsage.value = true;
  }
});

function closeUsage() {
  showUsage.value = false;
}

/* 「不再提示」：写入缓存，之后不再自动弹出 */
function neverUsage() {
  try {
    localStorage.setItem(USAGE_KEY, '1');
  } catch {
    /* 忽略隐私模式等写入失败的情况 */
  }
  showUsage.value = false;
}

/* ---------- 全屏预览（点击卡片预览放大） ---------- */
const previewItem = ref(null);

function openPreview(item) {
  previewItem.value = item;
}

function closePreview() {
  previewItem.value = null;
}

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
const canRetryAll = computed(() => items.value.some((i) => i.status === 'done' && !i.atMin));

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
  // 仅允许 JPG / PNG，其余格式提示报错
  const bad = [];
  const files = Array.from(fileList).filter((f) => {
    if (f.type === 'image/jpeg' || f.type === 'image/png') return true;
    bad.push(f.name);
    return false;
  });
  if (bad.length) rejected.value = bad;
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
      steps: 0,            // 「再来一次」降档次数
      atMin: false,        // 已达最低分辨率，无法再次压缩
      reachedTarget: false,
      baseEdge: null,
      targetKB: null,
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
      minEdge: 2560, // 最低分辨率 2K（1440×2560），原图小于 2K 时不受影响
      steps: item.steps || 0, // 「再来一次」降档次数
    });

    // 释放旧结果
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.resultUrl = URL.createObjectURL(result.blob);
    item.resultSize = result.blob.size;
    item.resultWidth = result.width;
    item.resultHeight = result.height;
    item.resultType = settings.outType;
    item.steps = result.steps; // 实际使用的档位（「再来一次」在此基础上继续降）
    item.atMin = result.atMin;
    item.reachedTarget = result.reachedTarget;
    item.baseEdge = result.baseEdge;
    item.targetKB = settings.targetKB;
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

/* ---------- 单张「再来一次」：降一档分辨率重压 ---------- */
async function retryOne(item) {
  if (processing.value || item.status === 'processing') return;
  if (item.atMin) return; // 已达最低分辨率，无法再次压缩
  item.steps = (item.steps || 0) + 1;
  await compressOne(item);
}

/* ---------- 全部「再来一次」 ---------- */
async function retryAll() {
  if (processing.value) return;
  processing.value = true;
  try {
    for (const item of items.value) {
      if (item.status !== 'done' || item.atMin) continue;
      item.steps = (item.steps || 0) + 1;
      await compressOne(item);
    }
  } finally {
    processing.value = false;
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
    if (previewItem.value === item) previewItem.value = null; // 移除时关闭预览
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
    accept="image/jpeg,image/png"
    multiple
    hidden
    @change="onInputChange"
  />

  <main class="app-main">
    <!-- 页面标题 -->
    <section class="page-title">
      <h1>体面的图片压缩</h1>
      <p class="page-subtitle">为体面人提供的图片压缩工具 · 在尽量不影响画面的情况下进行压缩</p>
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
      <div class="upload-sub">仅支持 JPG / PNG 格式 · 其他格式将被忽略并提示</div>
      <div class="upload-hint">所有图片均在本地浏览器中处理，不会上传到服务器</div>
    </div>

    <!-- 格式不支持提示 -->
    <div v-if="rejected.length" class="format-alert" role="alert">
      <span class="format-alert-label">格式不支持 · Unsupported</span>
      <div>仅支持 <b>JPG / PNG</b>，以下 <b>{{ rejected.length }}</b> 个文件已被忽略：</div>
      <div class="format-alert-list">{{ rejected.join('、') }}</div>
      <button class="format-alert-close" @click="rejected = []">关闭</button>
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

    <!-- 有图：处理 -->
    <template v-else>
      <!-- 操作栏 -->
      <div class="action-bar">
        <button class="btn btn-primary" :disabled="processing || !hasWork" @click="compressAll">
          {{ processing ? '处理中…' : hasWork ? '开始处理' : '全部已完成 ✓' }}
        </button>
        <button class="btn btn-ghost" :disabled="processing || !canRetryAll" @click="retryAll">
          ↻ 全部再来一次
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
          @retry="retryOne"
          @preview="openPreview"
        />
      </div>
    </template>

    <!-- 辅助功能（折叠展开区） -->
    <section class="aux">
      <button
        class="aux-toggle"
        :class="{ open: auxOpen }"
        :aria-expanded="auxOpen"
        @click="auxOpen = !auxOpen"
      >
        <span class="aux-label">辅助功能 · Auxiliary</span>
        <span class="aux-arrow">{{ auxOpen ? '↑ 收起' : '↓ 展开' }}</span>
      </button>
      <div class="aux-body" :class="{ open: auxOpen }" :aria-hidden="!auxOpen">
        <div class="aux-inner">
          <CoverChecker />
        </div>
      </div>
    </section>

    <!-- 使用说明入口 -->
    <footer class="page-foot">
      <button class="link-btn" @click="showUsage = true">使用说明 · How to Use</button>
    </footer>
  </main>

  <!-- 使用说明弹窗 -->
  <UsageDialog :visible="showUsage" @close="closeUsage" @never="neverUsage" />

  <!-- 全屏预览（点击卡片预览放大） -->
  <PreviewModal
    :item="previewItem"
    @close="closePreview"
    @download="downloadOne"
    @retry="retryOne"
    @remove="removeItem"
  />
</template>
