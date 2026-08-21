import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// @jsquash 系列是 ESM + WASM 包，需要排除出依赖预构建，避免 Vite 优化器与 WASM 冲突
export default defineConfig({
  // base 用相对路径：可部署到任意子路径（如 GitHub Pages 的 /仓库名/），也兼容自定义域名
  base: './',
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['@jsquash/jpeg'],
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'image-codecs': ['@jsquash/jpeg', 'upng-js'],
        },
      },
    },
  },
});
