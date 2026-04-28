# SynapFlow - AI 驱动的学习与研究辅助平台

> 集知识库、论文推送、智能出题、AI 问答于一体的科研学习工具

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3E88C6?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-black?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)

## 功能概览

### 论文推送
每天自动从 arXiv 抓取 AI/NLP 领域最新论文，DeepSeek 生成中文标题 + 三要点摘要，支持收藏和一键导入知识库。
- 关键词 + 分类可配置（`scripts/arxiv-config.json`）
- 标题匹配加权排序，排除无关领域
- PM2 定时任务，每天 9:00 自动执行

### 知识库 & Hyper-RAG
创建知识库，上传文档，自动构建超图索引。
- 支持 Markdown / DOCX / TXT 文档上传
- **超图可视化**：选择实体 → 展开邻居子图，交互式探索知识网络
- **知识问答**：基于 Hyper-RAG 的文档对话，支持多轮问答
- **AI 阅读**：文档阅读器 + 侧边 AI 分析面板，支持高亮和笔记

### 题库 & 智能出题
- 题目上传：文本、图片、PDF/Word 多格式支持
- 搜索过滤：标签分类、全文搜索、排序
- **AI 出题机**：输入源文本或上传文档，自动生成选择题、填空题、简答题

### 笔记
Markdown 笔记编辑器，支持上传文件附件、标签分类、点赞和收藏。

### 英语训练
AI 英语对话练习，多场景（旅行、商务、日常、学术），实时语法纠错，词汇量追踪。

### 文档转换
集成 MinerU API，PDF/DOCX 转 Markdown，显示实时转换进度，下载 ZIP 结果包。

### 团队协作
创建学习团队，成员管理，加入审核，团队专属资源。

### 其他
- **悬浮 AI 助手**：任意页面调出 DeepSeek 对话
- **消息通知**：评论、关注、团队动态实时通知
- **主题切换**：6 种配色方案 + 深色模式
- **管理后台**：标签管理、团队审核、系统设置

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 16 + React 19 + TypeScript + Tailwind CSS |
| 数据库 | Supabase (PostgreSQL + Auth + Storage) |
| AI | DeepSeek API (deepseek-v4-flash) |
| 文档解析 | MinerU API |
| 超图引擎 | Hyper-RAG (Python 服务) |
| 图可视化 | @antv/graphin |
| 定时任务 | PM2 + cron |

## 项目结构

```
question-bank/
├── app/                       # Next.js 页面
│   ├── papers/               # 论文推送
│   ├── kb/                   # 知识库
│   ├── qa/                   # 知识问答
│   ├── generator/            # 智能出题
│   ├── english/              # 英语训练
│   ├── convert/              # 文档转换
│   ├── notes/                # 笔记
│   ├── search/               # 题库搜索
│   ├── upload/               # 上传题目
│   ├── classes/              # 团队
│   ├── reader/[docId]/       # AI 阅读器
│   └── api/                  # API 路由
├── components/                # 可复用组件
├── lib/                       # 工具函数
├── scripts/
│   ├── arxiv-cron.ts         # 论文抓取脚本
│   └── arxiv-config.json     # 抓取配置
├── supabase/                  # SQL 迁移脚本
└── hyper-rag-service/         # Python 超图服务
```

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.10 (Hyper-RAG 服务)

### 安装

```bash
npm install
```

### 配置

创建 `.env.local`：

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx    # 论文抓取脚本用
DEEPSEEK_API_KEY=sk-xxx             # 可选，也可在设置页面配置
```

### 数据库

在 Supabase SQL Editor 中按顺序执行 `supabase/` 下的 SQL 脚本。

### 运行

```bash
# 开发
npm run dev

# 生产
npm run build && npm start
```

### 论文定时抓取

```bash
# PM2 方式（推荐）
pm2 start ecosystem.config.js --only arxiv-cron

# 手动执行
npx tsx scripts/arxiv-cron.ts
```

抓取配置见 `scripts/arxiv-config.json`，可自定义分类、关键词、排除词和每日数量。

## 许可证

MIT
