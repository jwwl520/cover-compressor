# 封面压缩 · 纯前端图片压缩工具

把大图（如 4K 封面）压缩到指定大小（默认 200KB），**图片全程不出浏览器**，隐私安全。

## 技术方案

| 环节 | 技术 | 说明 |
|------|------|------|
| 框架 | Vite + Vue 3 | 现代前端构建 |
| JPG 编码 | `@jsquash/jpeg`（MozJPEG WASM） | 质量优于浏览器内置 JPEG 编码器 |
| PNG 编码 | `upng-js`（UPNG.js） | 无损 / K-d tree 有损量化（类 TinyPNG） |
| 解码缩放 | Canvas + `createImageBitmap` | 尊重 EXIF 方向，高质量插值 |
| 目标大小 | 自研迭代算法 | 限尺寸 → 二分质量 → 逐级降级 |
| 批量打包 | `fflate` | ZIP 打包下载 |

## 核心策略（解决 4K 压 200KB 严重变色）

1. **先限尺寸再调质量**：绝不把 quality 打到极低，而是降分辨率保颜色
2. **二分质量**：在 35~92 之间找「大小 ≤ 目标」的最高质量
3. **逐级降级**：质量下限仍装不下时，按 0.82 倍逐级缩小最长边（下限 480px）
4. PNG 模式：无损装不下时，逐步减少调色板颜色数（256→16）

## 使用

```bash
npm install     # 安装依赖
npm run dev     # 开发预览 (http://localhost:5173)
npm run build   # 构建到 dist/
npm run preview # 预览构建产物
```

部署：`npm run build` 后把 `dist/` 目录托管到任意静态站点（GitHub Pages / Vercel / Netlify / Cloudflare Pages）即可。

## 功能

- 拖拽/选择批量上传（支持 JPG / PNG / WebP / AVIF / BMP 等）
- 目标大小自定义（默认 200KB）
- 输出格式切换：JPG（MozJPEG）/ PNG（量化）
- 尺寸模式：原尺寸 / 最长边 / 自定义宽高 / 百分比
- 压缩前后对比滑块
- 单张下载 / 全部打包 ZIP
- 设置变化自动重新压缩
