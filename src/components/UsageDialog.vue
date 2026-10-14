<script setup>
import { watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'never']);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}

// 打开时锁定页面滚动 + 监听 ESC 关闭
watch(
  () => props.visible,
  (v) => {
    if (v) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    }
  }
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <div v-if="visible" class="dlg-mask" @click.self="emit('close')">
    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <!-- 标题 -->
      <div class="dlg-head">
        <h2 id="dlg-title">使用说明 · How to Use</h2>
        <button class="dlg-x" aria-label="关闭" @click="emit('close')">×</button>
      </div>

      <!-- 内容 -->
      <div class="dlg-body">
        <!-- 一 -->
        <section class="dlg-sec">
          <h3>【一】压缩图片</h3>
          <ol>
            <li>把 <b>JPG / PNG</b> 图片拖入页面，或点击上传区选择（其他格式会被自动忽略并提示）</li>
            <li>点「<b>开始处理</b>」，每张图都会压到 <b>200 KB 以内</b></li>
            <li>卡片上用滑块左右拖动，可对比原图与压缩后的画面</li>
            <li>满意后点「<b>下载</b>」；多张图可点「<b>打包下载全部</b>」一次下载 ZIP</li>
          </ol>
        </section>

        <!-- 二 -->
        <section class="dlg-sec">
          <h3>【二】画质不满意？点「再来一次」</h3>
          <ul>
            <li>文件大小固定 200 KB</li>
            <li>每点一次「<b>再来一次</b>」，会重新使用更保守的参数压缩，可以多次点击直至满意</li>
          </ul>
        </section>

        <!-- 三 -->
        <section class="dlg-sec">
          <h3>【三】检查封面是否合规（辅助功能）</h3>
          <ul>
            <li>页面底部点「<b>辅助功能 · Auxiliary</b>」展开</li>
            <li>选择封面文件夹（或把图片拖进去），点「<b>开始检查</b>」</li>
            <li>按 <b>6 条规格</b>自动检查：</li>
          </ul>

          <table class="dlg-table">
            <thead>
              <tr>
                <th>规格</th>
                <th>要求</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>592×840 无标题 / 有标题</td>
                <td>尺寸须为 592×840；无标题版 ≤200 KB</td>
              </tr>
              <tr>
                <td>258×380 无标题 / 有标题</td>
                <td>尺寸须为 258×380；无标题版 ≤200 KB</td>
              </tr>
              <tr>
                <td>原图 4K 无标题 / 有标题</td>
                <td>高度 ≥2048px、9:16 竖版比例；无标题版 ≤200 KB</td>
              </tr>
            </tbody>
          </table>

          <ul>
            <li>文件名需包含规格关键词（例：<code>592-840-无标题.jpg</code>）</li>
            <li>结果显示：<b>✓ 通过</b> / <b>✗ 缺失</b> / <b>⚠ 有问题</b>（并说明具体原因）</li>
          </ul>
        </section>

        <!-- 隐私 -->
        <section class="dlg-sec dlg-privacy">
          <span class="dlg-label">隐私 · Privacy</span>
          <p>所有图片仅在你的浏览器本地处理，<b>不会上传到任何服务器</b>。</p>
        </section>
      </div>

      <!-- 按钮 -->
      <div class="dlg-foot">
        <button class="btn btn-ghost" @click="emit('never')">不再提示</button>
        <button class="btn btn-primary" @click="emit('close')">确定</button>
      </div>
    </div>
  </div>
</template>
