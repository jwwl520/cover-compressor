/**
 * 压缩状态提示文案（卡片与全屏预览共用）
 * @param {Object} item 图片项
 * @returns {string} 提示文字（未完成时返回空串）
 */
export function compressHint(item) {
  if (!item || item.status !== 'done') return '';
  const target = item.targetKB || 200;
  if (item.atMin) {
    return item.reachedTarget
      ? '✓ 已达标 · 已达最低分辨率'
      : '⚠ 已达最低分辨率，无法再次压缩';
  }
  return item.reachedTarget
    ? `✓ 已达标 ${target} KB · 可点「再来一次」提升画质`
    : `⚠ 未达目标 ${target} KB · 可点「再来一次」降低分辨率`;
}
