/**
 * 核心图片压缩引擎
 *
 * 技术方案：
 *  - 解码/缩放：Canvas + createImageBitmap（浏览器原生，尊重 EXIF 方向）
 *  - JPG 编码：@jsquash/jpeg（MozJPEG WASM，质量优于浏览器内置编码器）
 *  - PNG 编码：upng-js（无损 cnum=0，或 K-d tree 有损量化，类似 TinyPNG）
 *  - 目标大小：限尺寸 -> 二分质量 -> 不够再降尺寸的迭代降级算法
 */
import { encode as encodeJpeg } from '@jsquash/jpeg';
import UPNG from 'upng-js';

/* ---------- 1. 解码 ---------- */

/** 解码图片为 ImageBitmap（自动处理 EXIF 方向） */
export async function decodeImage(file) {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/* ---------- 2. 缩放 ---------- */

/** 用高质量插值把 bitmap 绘制到指定尺寸的 canvas */
export function drawScaled(bitmap, { width, height }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  // willReadFrequently：后续要多次 getImageData，避免 GPU 回读慢
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 根据尺寸模式计算目标尺寸 */
export function computeTargetSize(srcW, srcH, sizeMode, sizeValue, maxEdge = 4096) {
  let w = srcW, h = srcH;
  if (sizeMode === 'maxEdge') {
    const edge = sizeValue && sizeValue > 0 ? sizeValue : maxEdge;
    const s = Math.min(1, edge / Math.max(srcW, srcH));
    w = srcW * s; h = srcH * s;
  } else if (sizeMode === 'custom') {
    const v = sizeValue || {};
    if (v.width > 0 && v.height > 0) { w = v.width; h = v.height; }
    else if (v.width > 0) { const s = v.width / srcW; w = v.width; h = srcH * s; }
    else if (v.height > 0) { const s = v.height / srcH; w = srcW * s; h = v.height; }
  } else if (sizeMode === 'percent') {
    const p = (sizeValue && sizeValue > 0 ? sizeValue : 100) / 100;
    w = srcW * p; h = srcH * p;
  }
  // 兜底：限制在浏览器 canvas 安全范围
  const scale = Math.min(1, 8192 / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function canvasToImageData(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

/* ---------- 3. JPG 编码（MozJPEG） ---------- */

/**
 * 在给定 canvas 上用 MozJPEG 二分质量，找到「大小 ≤ targetBytes」的最高质量
 * @returns ArrayBuffer | null
 */
async function encodeJpegBest(canvas, targetBytes) {
  const imageData = canvasToImageData(canvas);
  let lo = 35;   // 最低容忍质量（MozJPEG 0-100）
  let hi = 92;
  let best = null;
  for (let i = 0; i < 6; i++) {
    const q = Math.round((lo + hi) / 2);
    // MozJPEG 逐条扫描，progressive 优化
    const buf = await encodeJpeg(imageData, {
      quality: q,
      baseline: false,
      arithmetic: false,
      progressive: true,
      optimize_coding: true,
    });
    if (buf.byteLength <= targetBytes) { best = buf; lo = q + 1; }
    else hi = q - 1;
    if (lo > hi) break;
  }
  return best;
}

/* ---------- 4. PNG 编码（UPNG.js） ---------- */

async function encodePngWith(canvas, cnum) {
  const imageData = canvasToImageData(canvas);
  return UPNG.encode([imageData.data.buffer], canvas.width, canvas.height, cnum);
}

/**
 * PNG 目标大小编码：先无损，装不下则用有损量化逐步减少颜色数
 * @returns ArrayBuffer | null
 */
async function encodePngBest(canvas, targetBytes) {
  // 无损
  const lossless = await encodePngWith(canvas, 0);
  if (lossless.byteLength <= targetBytes) return lossless;
  // 有损量化（调色板），颜色数递减
  for (const cnum of [256, 192, 128, 96, 72, 56, 40, 32, 24, 16]) {
    const buf = await encodePngWith(canvas, cnum);
    if (buf.byteLength <= targetBytes) return buf;
  }
  return null;
}

/* ---------- 5. 主入口：压缩到目标大小 ---------- */

/**
 * @param {ImageBitmap} bitmap 已解码的图
 * @param {Object} options
 *   targetKB  目标大小 KB（默认 200）
 *   outType   输出格式 'image/jpeg' | 'image/png'
 *   sizeMode  尺寸模式 'maxEdge' | 'custom' | 'percent' | 'original'
 *   sizeValue maxEdge: 数字; custom: {width,height}; percent: 0-100 数字
 *   maxEdge   尺寸模式下的硬性最长边上限
 *   minEdge   迭代降级的尺寸下限（最长边，默认 2K=2560，防止压到 2K 以下）
 */
export async function compressImage(bitmap, options) {
  const {
    targetKB = 200,
    outType = 'image/jpeg',
    sizeMode = 'maxEdge',
    sizeValue,
    maxEdge = 4096,
    minEdge = 2560,
  } = options;

  const targetBytes = Math.max(1, targetKB * 1024);
  const base = computeTargetSize(bitmap.width, bitmap.height, sizeMode, sizeValue, maxEdge);

  let edge = Math.max(base.width, base.height);
  let bestResult = null;

  // 迭代降级：同一比例下逐渐缩小最长边
  for (let attempt = 0; attempt < 10; attempt++) {
    const s = Math.min(1, edge / Math.max(base.width, base.height));
    const w = Math.max(1, Math.round(base.width * s));
    const h = Math.max(1, Math.round(base.height * s));
    const canvas = drawScaled(bitmap, { width: w, height: h });

    let buf = null;
    if (outType === 'image/jpeg') buf = await encodeJpegBest(canvas, targetBytes);
    else buf = await encodePngBest(canvas, targetBytes);

    if (buf) {
      const blob = new Blob([buf], { type: outType });
      if (blob.size <= targetBytes) {
        return { blob, width: w, height: h, size: blob.size, reachedTarget: true, attempt };
      }
      // 记录 best-effort（最小的一次）
      if (!bestResult || blob.size < bestResult.blob.size) {
        bestResult = { blob, width: w, height: h, size: blob.size, reachedTarget: false, attempt };
      }
    }
    if (edge <= minEdge) break;
    // 钳制下限：尺寸最低保持 minEdge（2K），不会压到 2K 以下
    edge = Math.max(minEdge, Math.round(edge * 0.82));
  }

  if (bestResult) return bestResult;
  throw new Error('图片压缩失败，请换用更小的目标尺寸');
}

/* ---------- 6. 工具函数 ---------- */

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function extFor(mime) {
  return mime === 'image/png' ? 'png' : 'jpg';
}
