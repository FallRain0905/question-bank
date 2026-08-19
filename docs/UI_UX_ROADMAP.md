# SynapFlow — Web UI/UX 落地顺序与对标借鉴

> 本文档给出前端体验优化的**落地顺序**（第一部分）与**同类产品借鉴映射**（第二部分）。
> 每条落地项都标明目标、涉及文件、关键改动、验收标准与预估工作量，方便按序执行。

---

## 第一部分：落地顺序

按「风险从低到高、见效从快到慢、价值从高到低」排序，建议严格按序推进。前两项是纯清理/补死角，风险最低；后续逐步引入新能力。

---

### 1. 修主题不一致（bug）+ 深色模式漏色

**目标**：让「主题系统」回到自洽状态——代码、样式、文档三者一致，并让深色模式不露白。

**现状问题（已核实）**：
- [lib/theme.ts](lib/theme.ts) 的 `themes` 现在只有 `light` 和 `dark` 两套，但 [lib/theme.ts:132](lib/theme.ts#L132) 的 `applyTheme` 仍在移除 `theme-professional / theme-fresh / theme-tech` 三个已不存在的类名；`getThemeList()` 返回的结果与实际只有两套不一致。
- README「功能概览」仍写着「6 种配色方案」。
- 侧边栏等组件大量硬编码 `bg-white / border-gray-100 / text-gray-600`（见 [components/Sidebar.tsx](components/Sidebar.tsx)），与 `--theme-*` CSS 变量是两套体系，深色模式下会漏色。

**涉及文件**：
- [lib/theme.ts](lib/theme.ts) — 清理残留类名 / 补回主题或删掉死代码
- [components/Sidebar.tsx](components/Sidebar.tsx)、[components/EmptyState.tsx](components/EmptyState.tsx)、[components/LoadingState.tsx](components/LoadingState.tsx) 等全局组件 — 硬编码色改走 `--theme-card-bg / --theme-card-border / --theme-text-primary / --theme-text-secondary` 变量
- README.md — 主题数量描述与实现对齐

**关键改动**：
1. 决策「6 套主题」是否恢复：若恢复，补回 `professional / fresh / tech` 三套配色（改动较大）；若不恢复，删除 `applyTheme` 里的三个残留 `classList.remove` 项，README 改为「2 套 + 深色模式」。
2. 全局组件统一使用语义化 CSS 变量替代硬编码 Tailwind 色值，保证深色模式不漏色。

**验收标准**：
- `npx tsc --noEmit` 通过。
- 深色模式下，侧边栏、卡片、空状态无白色硬编码残留（肉眼扫一遍 + 检查 `bg-white` / `border-gray-*` / `text-gray-*` 硬编码是否仅出现在明确该白的地方）。
- `getThemeList()` 返回值与 `themes` 实际键一致。

**预估工作量**：小（0.5 天）。

---

### 2. 论文详情页 `/papers/[id]`

**目标**：补最明显的导航死角——现在只有列表页 [app/papers/page.tsx](app/papers/page.tsx)，点论文卡片无处可去。

**现状问题**：
- `app/papers/` 下只有 `page.tsx`，没有 `[id]` 动态路由。
- 已有论文相关 API（`/api/papers`、`/api/papers/favorite`、`/api/papers/import`）与 [components/PaperCard.tsx](components/PaperCard.tsx) 组件，但缺单篇详情承载页。

**涉及文件（新增）**：
- `app/papers/[id]/page.tsx` — 详情页主体
- （可选）`app/papers/[id]/loading.tsx` — 骨架屏

**关键改动**：
1. 详情页承载：中文摘要全文、原始 PDF 链接、引用信息（arXiv 元数据）。
2. 三个动作按钮放显眼位：**导入知识库**、**收藏**、**相关论文图谱**。
3. 底部「相关论文推荐」列表，复用 `PaperCard`。
4. 卡片点击 → 跳转 `/papers/[id]`（改 `PaperCard` 外层包 `Link` 或加 onClick）。

**验收标准**：
- 从论文列表点击任意卡片进入详情页，信息完整、动作按钮可用。
- 「导入知识库」「收藏」与后端现有 API 打通。
- 深色模式正常。

**预估工作量**：小（0.5–1 天）。

---

### 3. Agent 运行历史页 `/agent/history`

**目标**：把已建好的后端能力变现——断线恢复、运行事件回放都已具备，但缺少用户可见的历史浏览界面。

**现状（后端已完备，前端缺页面）**：
- `GET /api/agent/runs`、`GET /api/agent/runs/[id]`、`GET /api/agent/runs/[id]/events?after=<seq>` 均已实现。
- [app/agent/page.tsx:753](app/agent/page.tsx#L753) 的 `replayRunEvents` 已能断线回放，但只服务于当前会话，没有独立历史页。

**涉及文件（新增）**：
- `app/agent/history/page.tsx` — 运行历史列表 + 详情
- （可选）`components/agent/RunTimeline.tsx` — 运行轨迹时间线组件

**关键改动**：
1. 会话列表：按 `conversation_id` 聚合，展示最近一次 run 状态（`queued / running / completed / failed`）与耗时。
2. 点开某个 run：展示工具调用轨迹（复用 `/events?after=` 回放，映射为「检索中 → 读文档 → 写报告」步骤条）、失败 error 信息。
3. 从历史页点击「继续对话」跳回 `/agent` 并加载该会话（复用 `loadConversation`）。

**验收标准**：
- 能列出历史 run，状态、耗时、错误信息正确。
- 能回放某个 run 的工具调用事件轨迹。
- 「继续对话」能正确恢复会话上下文。

**预估工作量**：中（1–1.5 天）。

---

### 4. Cmd+K 命令面板 + 骨架屏

**目标**：全局体验提升——键盘效率 + 首屏感知速度。

**现状问题**：
- 没有任何键盘快捷键，13 个模块全靠侧边栏点。
- 列表页（论文/题库/笔记）首屏加载目前是 [LoadingState.tsx](components/LoadingState.tsx) 转圈，无骨架屏。

**涉及文件（新增 + 修改）**：
- `components/CommandPalette.tsx` — Cmd+K 命令面板（新增）
- `components/Skeleton.tsx` — 骨架屏基础组件（新增）
- `app/layout.tsx` — 挂载命令面板 + 监听 Cmd+K（修改）
- 各列表页（papers / questions / notes）— 用骨架屏替换转圈（修改）

**关键改动**：
1. **Cmd+K 面板**：模块跳转（13 个入口）+ 全局搜索（复用 `/search` 全文搜索接口），上下键选择、回车跳转、Esc 关闭。
2. **骨架屏**：抽象 `Skeleton`（卡片/列表/文本三态），列表页首屏按真实布局渲染占位。
3. 补充一个 `/help` 或「快捷键提示」浮层，汇总 `Cmd+K / ? / 深色切换` 等快捷键。

**验收标准**：
- 任意页面按 `Cmd+K`（Windows `Ctrl+K`）弹出面板，可键盘导航并跳转。
- 论文/题库/笔记列表首屏显示骨架屏而非转圈。
- 移动端不受影响（面板仅桌面端触发）。

**预估工作量**：中（1–2 天）。

---

### 5. 复习卡片页 `/review`（间隔重复）

**目标**：留存价值最高——题库 + 英语词汇量追踪之间最自然的空白，Anki 式间隔重复 + 错题重做。

**现状**：
- 已有 [components/QuestionCard.tsx](components/QuestionCard.tsx) 可复用；英语模块已追踪词汇量；题库支持错题概念（题目有标签/搜索，但无「错题本」持久化与排期）。

**涉及文件（新增 + 修改）**：
- `app/review/page.tsx` — 复习主页（新增）
- `components/review/Flashcard.tsx` — 翻卡组件（新增）
- `supabase/` — 新增 `review_schedule` 表（到期时间、间隔、熟练度）迁移脚本（新增）
- `lib/review.ts` — 间隔重复算法（SM-2 简化版）纯函数（新增，可配 vitest）

**关键改动**：
1. 数据模型：`review_schedule(user_id, question_id/word_id, ease, interval_days, due_at, last_reviewed_at)`。
2. 算法：SM-2 简化版——答对间隔 ×增长因子，答错回退并进入「重做队列」。
3. UI：卡片翻转（正面题干/词 → 背面答案/释义）、答对/答错/重来三键、今日进度条、连续打卡统计。
4. 入口：侧边栏「复习」入口 + 今日待复习数量角标。

**验收标准**：
- 能按到期队列出卡，翻卡判分后更新 `due_at` 与 `interval_days`。
- 答错的题立即进入重做队列。
- 连续打卡/今日进度正确展示。
- `lib/review.ts` 有 vitest 单测覆盖排期不变量。

**预估工作量**：大（2–3 天，含新增表与算法）。

---

## 第二部分：同类产品借鉴映射

> 每个模块对标一个标杆产品，重点是借鉴**具体交互**而非视觉。列「可借鉴点」与「落地优先级」。

| 你的模块 | 对标产品 | 最值得借鉴的点 | 落地优先级 |
|---|---|---|---|
| **Agent / 研究** | Perplexity、Claude Canvas、Manus | ① 回答下方「相关来源」卡片 + 引用角标跳转；② **执行过程可视化**（工具调用步骤条，像 Manus 那样显示「检索中 → 读文档 → 写报告」实时轨迹）；③ Canvas 式「对话在左、产物文档在右」分栏 | 高（步骤条 = 落地顺序 3 的回放；分栏 = 后续） |
| **AI 阅读** | Readwise Reader、Papers.app | ① 划词即出侧栏 AI 面板（已有 [TextSelectionPopup](components/reader/TextSelectionPopup.tsx)，可强化为**常驻右侧栏**而非浮窗）；② 高亮可一键导出为笔记/卡片；③ 阅读进度 + 目录树双栏（已有 [DocumentOutline](components/DocumentOutline.tsx)） | 中 |
| **论文库** | Semantic Scholar、Connected Papers、Zotero | ① 论文卡片显示「引用量 / 被引关系」；② 「相关论文」图谱入口（已有 [KnowledgeGraph](components/KnowledgeGraph.tsx)，可直接接论文实体）；③ 一键「收藏/导入知识库」按钮放卡片显眼位 | 高（部分并入落地顺序 2） |
| **知识库 + 超图** | Obsidian graph、Logseq、Tana | ① Obsidian 的**图视角是默认第一屏**，你的 `/graph` 目前是二级入口；② 节点展开时侧栏显示实体详情 + 关联文档列表 | 中 |
| **题库** | Quizlet、Anki、猿题库 | ① 学习模式：卡片翻转、答题即判分、错题自动进「重做队列」；② 答题统计热力图（连续打卡） | 高（= 落地顺序 5） |
| **英语训练** | 多邻国、Speak | ① 学习路径/关卡化（streak 连续打卡 + XP）；② 口语评分视觉反馈（波形/分数条）——目前只追踪词汇量，可加「每日打卡」卡片 | 中 |
| **笔记** | Notion、Obsidian | ① **双向链接 `[[]]` 与反链面板**（笔记间互链是 Obsidian 的灵魂）；② 块级拖拽排序 | 中 |
| **全局体验** | Linear、Notion、Raycast | ① Cmd+K 命令面板；② 键盘快捷键提示；③ 骨架屏 | 高（= 落地顺序 4） |

---

## 附：总览

```
1. 主题不一致 + 深色漏色      ── 纯清理，风险最低      （0.5 天）
2. 论文详情页 /papers/[id]    ── 补导航死角           （0.5–1 天）
3. Agent 运行历史 /agent/history ── 变现后端能力      （1–1.5 天）
4. Cmd+K + 骨架屏             ── 全局体验提升          （1–2 天）
5. 复习卡片 /review            ── 留存价值最高，含算法  （2–3 天）
```

> 建议先落地 1→2（快、稳、直观），跑通「补死角 + 清理」后，再进入 3→4（体验层），最后做 5（需要新增表 + 间隔重复算法，风险与工作量最大）。
