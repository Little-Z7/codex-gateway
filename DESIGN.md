---
version: alpha
name: Codex / OpenAI Neutral
description: A neutral, content-first skin modeled on Codex Desktop and ChatGPT — white canvas, near-black type, black primary actions, and no color on chrome or selection states. A single soft blue appears only in charts and rare status accents.

colors:
  primary: "#0d0d0d"
  primary-active: "#2f2f2f"
  on-primary: "#ffffff"
  canvas: "#ffffff"
  canvas-soft: "#f9f9f9"
  surface: "#ffffff"
  ink: "#0d0d0d"
  ink-secondary: "#3a3a3a"
  ink-muted: "#5d5d5d"
  ink-faint: "#8f8f8f"
  hairline: "#e3e3e3"
  accent-sky: "#5b8def"
  accent-orange: "#d97706"
  accent-green: "#16a34a"
  accent-brown: "#8a6d4d"

typography:
  body:
    fontFamily: "OpenAI Sans, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.75
  title:
    fontSize: 20px
    fontWeight: 600
    letterSpacing: -0.125px
  heading-3:
    fontSize: 22px
    fontWeight: 700
    letterSpacing: -0.25px

rounded:
  radius: 0.75rem
  composer: ~1.5rem
  avatar: full
---

# 设计语言说明

本主题对齐 Codex Desktop / ChatGPT 的 OpenAI 中性风格：

- **中性黑白为主**：浅色背景 `#ffffff`，次级面板/侧栏 `#f9f9f9`；暗色主背景 `#212121`，侧栏 `#171717`，卡片与弹层 `#2f2f2f`。文字 `#0d0d0d`（暗色 `#ececec`），次级 `#5d5d5d` / `#b4b4b4`，弱提示 `#8f8f8f` / `#8e8e8e`。
- **主按钮反差色**：浅色黑底白字（hover `#2f2f2f`），暗色白底黑字（hover `#ececec`）。次级动作用 outline/ghost，hover 为 `rgba(13,13,13,.05)` 级浅灰。
- **无彩色选中态**：侧栏与列表选中只用 `rgba(13,13,13,.06)`（暗色 `rgba(255,255,255,.08)`）底色，不使用彩色竖条或彩色底。
- **单一强调色**：`#5b8def` 柔和蓝只出现在图表和极少量装饰；`--accent-*` 保留为语义/语法色（警告橙、成功绿、语法高亮紫/青等），不进入按钮与选中态。
- **边框与阴影**：边框 `#e3e3e3`（暗色 `#424242`）；几乎不用阴影，弹层只用极淡阴影 + 边框。
- **字体**：OpenAI Sans 优先，无网络字体，中文走 PingFang SC / 微软雅黑 / Noto Sans CJK 回退。
- **圆角**：`--radius: 0.75rem`；composer 容器约 1.5rem；头像与状态点全圆。
