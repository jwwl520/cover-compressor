<script setup>
import { ref, computed } from 'vue';

/* ---------- 规格定义（与 cover_checker.py 完全一致） ---------- */
const SPECS = [
  { keywords: ['592', '840', '无标题'], label: '01-592x840 无标题', expectedW: 592, expectedH: 840, minH: null, checkRatio: false, maxKB: 200 },
  { keywords: ['592', '840', '有标题'], label: '01-592x840 有标题', expectedW: 592, expectedH: 840, minH: null, checkRatio: false, maxKB: null },
  { keywords: ['258', '380', '无标题'], label: '02-258x380 无标题', expectedW: 258, expectedH: 380, minH: null, checkRatio: false, maxKB: 200 },
  { keywords: ['258', '380', '有标题'], label: '02-258x380 有标题', expectedW: 258, expectedH: 380, minH: null, checkRatio: false, maxKB: null },
  { keywords: ['4k', '无标题'], label: '原图-4K 无标题版本', expectedW: null, expectedH: null, minH: 2048, checkRatio: true, maxKB: 200 },
  { keywords: ['4k', '有标题'], label: '原图-4K 有标题版本', expectedW: null, expectedH: null, minH: 2048, checkRatio: true, maxKB: null },
];
const RATIO_TOLERANCE = 0.03; // 9:16 允许 ±3%

/* ---------- 状态 ---------- */
const fileInput = ref(null);
const files = ref([]);
const checking = ref(false);
const result = ref(null);
const isDragging = ref(false);
const error = ref(null);

const fileCount = computed(() => files.value.length);

/* ---------- 选择 / 拖拽 ---------- */
function onPick() {
  fileInput.value.click();
}
function onInputChange(e) {
  collect(e.target.files);
  e.target.value = '';
}
function onDrop(e) {
  isDragging.value = false;
  const dt = e.dataTransfer;
  // 优先用 entry API，支持拖入整个文件夹
  if (dt?.items?.length) {
    const entries = [...dt.items]
      .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (entries.length) {
      collectEntries(entries);
      return;
    }
  }
  if (dt?.files?.length) collect(dt.files);
}

/* 收集 FileList（选择文件夹 / 普通文件拖拽） */
function collect(fileList) {
  files.value = Array.from(fileList).filter((f) => /\.(jpe?g|png)$/i.test(f.name));
  result.value = null;
  error.value = null;
}

/* 递归收集文件夹 entry（拖入文件夹时） */
async function collectEntries(entries) {
  const out = [];
  async function walk(entry) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      if (/\.(jpe?g|png)$/i.test(file.name)) out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e);
      } while (batch.length > 0);
    }
  }
  for (const en of entries) await walk(en);
  files.value = out;
  result.value = null;
  error.value = null;
}

/* ---------- 检查逻辑（前端版 cover_checker.py） ---------- */

/** 文件名模糊匹配：文件名（不含扩展名）必须同时包含所有关键词，不区分大小写 */
function findFile(keywords) {
  const kws = keywords.map((k) => k.toLowerCase());
  return (
    files.value.find((f) => {
      const dot = f.name.lastIndexOf('.');
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
      const name = stem.toLowerCase();
      return kws.every((k) => name.includes(k));
    }) || null
  );
}

/** 9:16 比例检查（竖版，±3%） */
function checkRatio916(w, h) {
  if (!h) return false;
  const expected = 9 / 16;
  return Math.abs(w / h - expected) / expected <= RATIO_TOLERANCE;
}

/** 读取图片尺寸（createImageBitmap 拿到原始宽高） */
async function readDimensions(file) {
  const bmp = await createImageBitmap(file);
  const dims = { w: bmp.width, h: bmp.height };
  bmp.close();
  return dims;
}

async function runCheck() {
  if (checking.value) return;
  error.value = null;
  if (!files.value.length) {
    error.value = '请先选择封面文件夹，或将封面图片拖入上方区域';
    return;
  }
  checking.value = true;
  const items = [];
  const allProblems = [];
  try {
    for (const spec of SPECS) {
      const item = {
        label: spec.label,
        status: '',
        problems: [],
        fileName: null,
        sizeKB: null,
        width: null,
        height: null,
      };
      const matched = findFile(spec.keywords);
      if (!matched) {
        item.status = 'missing';
        item.problems.push('文件缺失');
        allProblems.push(`${spec.label}：文件缺失`);
        items.push(item);
        continue;
      }
      item.fileName = matched.name;
      const sizeKB = matched.size / 1024;
      item.sizeKB = Math.round(sizeKB * 10) / 10;

      // ── 文件大小检查 ──
      if (spec.maxKB != null && sizeKB > spec.maxKB) {
        const prob = `文件过大 ${Math.round(sizeKB)}KB > ${spec.maxKB}KB`;
        item.problems.push(prob);
        allProblems.push(`${spec.label}：${prob}`);
      }

      // ── 尺寸检查 ──
      try {
        const dims = await readDimensions(matched);
        item.width = dims.w;
        item.height = dims.h;

        if (spec.expectedW && spec.expectedH) {
          if (dims.w !== spec.expectedW || dims.h !== spec.expectedH) {
            const prob = `尺寸错误 ${dims.w}×${dims.h}，应为 ${spec.expectedW}×${spec.expectedH}`;
            item.problems.push(prob);
            allProblems.push(`${spec.label}：${prob}`);
          }
        }
        if (spec.minH && dims.h < spec.minH) {
          const prob = `尺寸不够 高度 ${dims.h}px，封面要求 4K`;
          item.problems.push(prob);
          allProblems.push(`${spec.label}：${prob}`);
        }
        if (spec.checkRatio && !checkRatio916(dims.w, dims.h)) {
          const ratio = dims.h ? `${(dims.w / dims.h * 9).toFixed(2)}:16` : '?';
          const prob = `比例非 9:16（实际 ${dims.w}×${dims.h}，约 ${ratio}）`;
          item.problems.push(prob);
          allProblems.push(`${spec.label}：${prob}`);
        }
      } catch (err) {
        const prob = `无法读取图片：${err?.message || err}`;
        item.problems.push(prob);
        allProblems.push(`${spec.label}：${prob}`);
      }

      item.status = item.problems.length ? 'problem' : 'pass';
      items.push(item);
    }

    const missingCount = items.filter((i) => i.status === 'missing').length;
    result.value = {
      ok: allProblems.length === 0,
      total: SPECS.length,
      missing: missingCount,
      problems: allProblems,
      items,
    };
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="cc">
    <!-- 说明 -->
    <div class="cc-intro">
      <p>按 <b>6 条封面规格</b> 检查封面图（文件名关键词匹配，不区分大小写，仅接受 JPG / PNG）</p>
    </div>

    <!-- 选择区 -->
    <div
      class="cc-drop"
      :class="{ dragover: isDragging }"
      @click="onPick"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="onDrop"
    >
      <div class="cc-drop-title">选择封面文件夹 · 或拖入封面图片</div>
      <div class="cc-drop-sub">文件名需包含规格关键词（如「592-840-无标题.jpg」）</div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept=".jpg,.jpeg,.png"
      webkitdirectory
      multiple
      hidden
      @change="onInputChange"
    />

    <div v-if="files.length" class="cc-meta">
      已收集 <b>{{ fileCount }}</b> 个图片文件
      <button class="btn btn-ghost btn-sm" :disabled="checking" @click="runCheck">
        {{ checking ? '检查中…' : '开始检查' }}
      </button>
    </div>
    <div v-else class="cc-meta cc-meta-empty">尚未选择文件</div>

    <div v-if="error" class="cc-error">{{ error }}</div>

    <!-- 检查结果 -->
    <template v-if="result">
      <div class="cc-summary" :class="{ ok: result.ok }">
        <span class="cc-summary-status">{{ result.ok ? '✓ 全部通过' : `⚠ ${result.problems.length} 个问题` }}</span>
        <span>共 {{ result.total }} 条规格 · 缺失 {{ result.missing }} 项</span>
      </div>
      <div class="cc-table">
        <div class="cc-row cc-head">
          <span>规格</span>
          <span>状态</span>
          <span>文件</span>
          <span>大小</span>
          <span>尺寸</span>
          <span>问题</span>
        </div>
        <div v-for="(it, i) in result.items" :key="i" class="cc-row" :class="it.status">
          <span class="cc-label">{{ it.label }}</span>
          <span class="cc-status">
            <template v-if="it.status === 'pass'">✓ 通过</template>
            <template v-else-if="it.status === 'missing'">✗ 缺失</template>
            <template v-else>⚠ 有问题</template>
          </span>
          <span class="cc-file">{{ it.fileName || '—' }}</span>
          <span>{{ it.sizeKB != null ? it.sizeKB + ' KB' : '—' }}</span>
          <span>{{ it.width ? `${it.width}×${it.height}` : '—' }}</span>
          <span class="cc-probs">
            <span v-if="!it.problems.length">—</span>
            <span v-for="(p, j) in it.problems" :key="j" class="cc-prob">{{ p }}</span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
