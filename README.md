# SynapFlowFlow - 学习与研究辅助平台

> 为学习和研究打造的辅助平台，集成AI助手、知识库、智能出题

[![Next.js](https://img.shields.io/badge/Next.js-16.2.4-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3E88C6?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![React](https://img.shields.io/badge/React-19.0.0-black?style=for-the-badge&logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-black?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)

## 📖 项目介绍

SynapFlowFlow 是一个为学习和研究打造的辅助平台，集成了多种AI驱动功能，提供完整的学习与研究解决方案：

### 🎯 核心理念
- **智能化学习**：AI 驱动的智能问答、出题和内容分析
- **知识管理**：结构化的知识库系统，便于管理和检索学习资料
- **协作学习**：团队协作和社区互动，构建学习社区
- **个性化体验**：多主题界面和深色模式，满足个人喜好

### 🌟 主要特色
- 🤖 **AI 融合**：深度集成 DeepSeek AI，提供全方位学习辅助
- 📄 **智能解析**：MinerU 文档转换，支持 PDF/DOCX 到 Markdown
- 🎓 **自动出题**：基于文档内容智能生成各种题型
- 🌍 **英语训练**：AI 辅助英语学习和实时纠错
- 🎨 **美观界面**：现代化设计，流畅动画，优秀的用户体验

## ✨ 主要功能

### 📚 题库管理
- **多格式上传**：支持文本、图片、PDF/Word 文档上传
- **智能解析**：自动解析题目中的数学公式（使用 KaTeX）
- **标签分类**：自定义标签分类题目，便于管理
- **收藏功能**：收藏喜欢的题目，建立个人题库
- **评论互动**：发表评论和回复讨论，增加学习互动
- **搜索功能**：强大的全文搜索，快速定位需要的题目

### 🤖 AI 智能助手
- **悬浮AI助手**：页面内置AI对话功能，随时提问
- **智能问答**：基于DeepSeek AI，提供精准的学习辅助
- **多轮对话**：支持上下文理解的连续对话
- **图片识别**：支持图片内容的AI分析
- **数学公式**：支持LaTeX格式数学公式的渲染和理解

### 📖 知识库系统
- **文档管理**：上传和分类管理学习资料
- **智能预览**：支持Markdown、DOCX、TXT等格式预览
- **AI 分析**：使用AI生成文档大纲和结构化摘要
- **目录导航**：自动生成文档目录，快速定位内容
- **文档对话**：基于文档内容的AI问答功能

### 📄 文档转换 (MinerU)
- **智能转换**：集成MinerU API，支持PDF/DOCX到Markdown转换
- **实时进度**：显示转换进度（页数和百分比）
- **双栏预览**：左侧原文预览，右侧Markdown结果预览
- **格式支持**：输出Markdown、JSON、DOCX、HTML等多种格式
- **批量处理**：支持大文件和多页文档处理

### 🎓 智能出题
- **AI 出题**：基于文档内容智能生成题目
- **多种题型**：支持选择题、填空题、简答题等
- **批量生成**：一次生成多道题目，提高效率
- **自定义要求**：根据学习需求自定义出题要求

### 🌍 英语训练
- **对话练习**：与AI进行英语对话练习
- **自动纠错**：AI实时纠正语法和表达
- **分级难度**：根据用户水平调整对话难度
- **学习记录**：记录学习进度和错误统计

### 📝 学习笔记
- **多格式支持**：支持 Markdown、DOCX、TXT 等格式
- **在线编辑**：富文本编辑器，支持格式化
- **文件附件**：支持上传相关学习资料
- **点赞互动**：喜欢作者的笔记，建立社交关系
- **收藏管理**：分类收藏学习资料，方便复习

### 💬 社区互动
- **评论系统**：支持主评论和回复嵌套，深度讨论
- **关注作者**：关注感兴趣的内容创作者，获取最新动态
- **消息通知**：实时接收互动通知，不错过重要信息
- **社交动态**：发现热门内容和活跃用户，拓展论坛子

### 🎓 团队协作
- **创建团队**：创建学习团队，组织学习活动
- **团队审核**：管理员审核团队创建申请，保证质量
- **成员管理**：灵活的成员添加、移除和权限管理
- **团队专属**：团队内专属的学习资源和讨论区

## 🛠 技术栈

### 前端框架
| 技术 | 版本 | 说明 |
|------|------|------|
| Next.js | 16.2.4 | React 全栈框架 |
| React | 19.0.0 | UI 库 |
| TypeScript | 5.0 | 类型安全 |
| Tailwind CSS | 3.4.1 | 原子CSS框架 |
| Framer Motion | 12.34.3 | 动画库 |

### 数据处理
| 技术 | 版本 | 说明 |
|------|------|------|
| date-fns | 4.1.0 | 日期时间处理 |
| KaTeX | 0.16.28 | 数学公式渲染 |
| Mammoth | 1.11.0 | Word 文档解析 |

### 后端/数据库
| 技术 | 说明 |
|------|------|
| Supabase | BaaS 服务提供商（PostgreSQL + 认证 + 存储） |
| PostgreSQL | 关系型数据库 |
| DeepSeek API | AI 智能服务 |
| MinerU API | 文档智能解析 |

### 开发工具
| 技术 | 说明 |
|------|------|
| PostCSS | CSS 转换工具 |
| Autoprefixer | 自动添加浏览器前缀 |
| ESLint | 代码质量检查 |
| TypeScript | 静态类型检查 |

## 📁 项目结构

```
question-bank/
├── app/                    # Next.js 应用页面
│   ├── admin/            # 管理员页面
│   │   ├── classes/    # 团队审核
│   │   ├── tags/       # 标签管理
│   │   ├── settings/   # 系统设置
│   │   └── announcements/ # 公告管理
│   ├── api/             # API 路由
│   │   ├── ai-assistant/      # AI 助手 API
│   │   ├── convert/          # 文档转换 API
│   │   ├── english/          # 英语训练 API
│   │   ├── generator/        # 智能出题 API
│   │   ├── kb/               # 知识库 API
│   │   ├── mineru/           # MinerU API
│   │   └── settings/         # 用户设置 API
│   ├── classes/          # 团队管理
│   ├── convert/          # 文档转换页面
│   ├── english/          # 英语训练
│   ├── generator/        # 智能出题
│   ├── home/             # 首页
│   ├── kb/               # 知识库
│   ├── login/           # 登录/注册
│   ├── me/              # 个人中心
│   ├── notes/           # 笔记管理
│   ├── notifications/    # 消息通知
│   ├── questions/        # 题库管理
│   ├── search/          # 搜索页面
│   ├── settings/        # 用户设置
│   ├── social/          # 社区动态
│   ├── upload/          # 资源上传
│   └── users/           # 用户主页
├── components/           # 可复用组件
│   ├── FloatingAIButton.tsx  # 悬浮AI助手
│   ├── Sidebar.tsx           # 侧边栏导航
│   ├── DocumentOutline.tsx  # 文档目录生成
│   └── ...
├── lib/                 # 工具函数
│   ├── database.types.ts  # 数据库类型定义
│   ├── render-markdown.ts  # Markdown 渲染
│   ├── supabase.ts         # Supabase 客户端封装
│   ├── theme.ts            # 主题配置系统
│   ├── upload.ts           # 文件上传处理
│   └── user-settings.ts    # 用户配置管理
├── supabase/           # 数据库 SQL 脚本
│   ├── schema.sql             # 基础表结构
│   ├── notes_schema.sql       # 笔记表定义
│   ├── class_system.sql      # 团队系统表
│   ├── migration_settings.sql # 用户配置表
│   └── ultimate_fix.sql       # 完整的RLS策略配置
├── types/               # TypeScript 类型定义
├── public/              # 静态资源
└── 配置文件...
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18.x
- npm 或 yarn 或 pnpm

### 安装依赖

```bash
npm install
# 或
yarn install
# 或
pnpm install
```

### 配置环境变量

在项目根目录创建 `.env.local` 文件：

```env
# Supabase 配置（必需）
NEXT_PUBLIC_SUPABASE_URL=你的_Supabase_Project_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的_Supabase_Anon_Key

# DeepSeek AI 配置（可选，用于AI功能）
# DEEPSEEK_API_KEY=你的_DeepSeek_API_Key

# MinerU API 配置（可选，用于文档转换）
# MINERU_API_TOKEN=your_mineru_api_token
```

### 配置 API 服务

项目使用以下外部服务，需要在设置页面中配置：

1. **DeepSeek AI**（AI 助手功能）
   - 访问 https://platform.deepseek.com/ 获取 API Key
   - 在网站"设置"页面配置 DeepSeek API Key
   - 支持：智能问答、出题生成、英语训练

2. **MinerU**（文档转换功能）
   - 访问 https://mineru.net/apiManage 获取 API Token
   - 在网站"设置"页面配置 MinerU API Token
   - 支持：PDF/DOCX 到 Markdown 转换

3. **注意**：不配置 API 也可以使用基本功能，但 AI 和文档转换功能将不可用

### 运行开发服务器

```bash
npm run dev
# 或
yarn dev
# 或
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)

### 构建生产版本

```bash
npm run build
npm start
```

## 📊 数据库配置

### 执行 SQL 脚本

在 [Supabase Dashboard](https://supabase.com/dashboard) 的 SQL Editor 中按顺序执行以下脚本：

1. `schema.sql` - 基础表结构
2. `notes_schema.sql` - 笔记相关表
3. `class_system.sql` - 团队系统表
4. `ultimate_fix.sql` - 完整的 RLS 策略配置（整合所有修复）

### 核心表说明

| 表名 | 说明 |
|-------|------|
| `auth.users` | 用户认证表 |
| `user_profiles` | 用户公开信息 |
| `questions` | 题库题目 |
| `notes` | 学习笔记 |
| `comments` | 评论和回复 |
| `likes` | 点赞记录 |
| `favorites` | 收藏记录 |
| `follows` | 关注关系 |
| `tags` | 标签分类 |
| `classes` | 团队信息 |
| `class_members` | 团队成员关系 |
| `class_approval_requests` | 团队审核申请 |
| `notifications` | 消息通知 |
| `kb_categories` | 知识库分类 |
| `kb_documents` | 知识库文档 |
| `user_settings` | 用户配置（API Keys、Token等） |

## 🎨 主题系统

项目内置 6 种精心设计的配色方案，可通过导航栏的调色板图标随时切换：

| ID | 名称 | 主色调 | 适用场景 |
|----|------|--------|----------|
| a | 深蓝商务 | 蓝色系 | 商务专业 |
| b | 紫罗兰 | 紫粉色系 | 温柔浪漫 |
| c | 清新薄荷 | 靛绿色系 | 清新活力 |
| d | 暖橙夕照 | 橙粉色系 | 温暖亲和 |
| e | 梦幻天空 | 蓝天色系 | 轻盈明亮 |
| f | 春日花园 | 粉黄绿色系 | 自然和谐 |

主题设置会自动保存到浏览器本地存储，刷新页面后保持选中状态。

## 👥 权限系统

### RLS 策略
项目采用 Supabase Row Level Security (RLS) 实现数据安全隔离：

- **已认证用户**：可查看公开内容
- **内容所有者**：可编辑/删除自己的内容
- **超级管理员**：拥有全部管理权限

### 超级管理员邮箱
在 `supabase/ultimate_fix.sql` 中配置：

```sql
admin_emails TEXT[] := ARRAY['3283254551@qq.com'];
```

修改此数组可添加更多管理员邮箱。

## 📝 开发说明

### 代码规范
- 使用 TypeScript 进行类型检查
- 遵循 ESLint 规则
- 组件采用函数式声明
- 遵循 RESTful API 设计原则

### 提交规范
```bash
git add .
git commit -m "类型: 简短描述"

# 类型包括：feat, fix, docs, style, refactor, test, chore
```

### 分支策略
- `master` - 主分支，生产环境
- `develop` - 开发分支

## 🔧 功能配置指南

### AI 功能配置

**DeepSeek API 配置：**
1. 访问 https://platform.deepseek.com/
2. 注册并获取 API Key
3. 在网站"设置"→"AI 大模型"中配置：
   - 提供商选择：DeepSeek
   - API Key：填入获取的 API Key
   - API URL：留空（使用默认）或填入 `https://api.deepseek.com/v1/chat/completions`
   - 模型：留空（使用默认）或填入 `deepseek-v4-flash`

**功能说明：**
- 悬浮AI助手：随时调用的智能对话
- 智能出题：基于文档自动生成题目
- 英语训练：AI 辅助英语学习和纠错

### 文档转换配置

**MinerU API 配置：**
1. 访问 https://mineru.net/apiManage
2. 注册并获取 API Token
3. 在网站"设置"→"MinerU 文档解析"中配置 Token

**使用说明：**
- 访问 `/convert` 页面
- 上传 PDF 或 DOCX 文件
- 等待转换完成（显示进度）
- 下载转换结果的 ZIP 文件
- ZIP 包含：Markdown、JSON、DOCX、HTML 等格式

### 知识库配置

**支持的文档格式：**
- Markdown (.md) - 直接解析和预览
- DOCX (.docx) - 使用 Mammoth 库解析
- TXT (.txt) - 直接读取
- PDF (.pdf) - 暂不支持，建议先转换格式

**知识库功能：**
- 创建分类管理学习资料
- 上传和管理文档
- AI 生成文档大纲
- 基于文档的智能问答

## 🐛 常见问题

### Supabase 连接失败
检查 `.env.local` 文件中的 URL 和 Key 是否正确配置。

### RLS 策略报错
确保按顺序执行所有 SQL 脚本，特别是 `ultimate_fix.sql`。

### 主题切换不生效
清除浏览器缓存后刷新页面。

### AI 功能不工作
- 检查是否在设置页面配置了 DeepSeek API Key
- 确认 API Key 是否有效且未过期
- 查看浏览器控制台是否有错误信息

### 文档转换失败
- 检查是否在设置页面配置了 MinerU API Token
- 确认文件格式是否支持（Markdown、DOCX、TXT）
- 文件大小不能超过 200MB

### 知识库上传格式问题
- **知识库暂时只支持**：Markdown (.md)、DOCX (.docx)、TXT (.txt)
- **PDF 文件暂时不支持**：正在实现更稳定的 PDF 解析方案
- 建议先将 PDF 转换为 DOCX 或 Markdown 格式后上传
- 或使用专门的文档转换页面 (`/convert`) 进行转换

### 文档预览问题
- 确保文件格式正确
- 大文件可能需要更长的加载时间
- 如果预览失败，可以尝试重新上传

## 📄 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE) 文件。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 维护者

由 Claude 协助开发和维护

---

**祝你学习愉快！** 📚✨
