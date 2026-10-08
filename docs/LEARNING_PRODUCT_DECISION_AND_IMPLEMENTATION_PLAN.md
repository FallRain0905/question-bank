# 学习辅助产品决策与实施计划

> 状态：已决策，待实施
> 更新时间：2026-10-02
> 适用范围：产品定位收敛、英语学习资料导入、后端替换、题库/笔记/复习重做
> 本文是后续产品和工程实施的基准。旧的论文、研究、Agent、记忆路线图不再作为核心产品路线。

## 1. 决策摘要

### 1.1 产品定位

本项目重新定位为：

> **面向个人学习者的学习辅助工作台，通过资料整理、题目练习、笔记沉淀和间隔复习帮助用户形成完整学习闭环。**

核心闭环为：

```text
导入/创建学习资料
        ↓
整理为笔记、题目或词汇
        ↓
主动练习并记录掌握情况
        ↓
错题与薄弱点进入复习
        ↓
间隔复习和学习进度反馈
```

产品今后的判断标准不是“还能不能增加一个模块”，而是该功能能否直接改善上述学习闭环。

### 1.2 核心导航

桌面端固定为：

- 今日学习
- 题库
- 笔记
- 知识库
- 复习
- 学习进度
- 设置

移动端主导航固定为：

- 今日学习
- 题库
- 复习
- 笔记
- 我的

“英语练习”可以作为题库/复习下的专项学习入口，不再作为一个与题库、笔记并列的孤立产品方向。

### 1.3 后端技术选型

采用**可独立部署的 TypeScript 模块化单体**，而不是继续把 Supabase 作为后端平台，也不立即拆分微服务：

- Web：保留 Next.js 16、React、TypeScript，负责页面和必要的轻量 BFF。
- API：NestJS + Fastify + TypeScript，按学习领域组织模块。
- 数据库：自主管理 PostgreSQL 16。
- ORM 与迁移：Drizzle ORM，使用统一、可审查、按序执行的 migration。
- 认证：Better Auth + Argon2 + HttpOnly session cookie。
- 异步任务：Redis + BullMQ，用于资料解析、批量导入、AI 生成和统计聚合。
- 文件存储：开发使用 MinIO，生产使用 S3-compatible 存储，优先 Cloudflare R2 或 AWS S3。
- 搜索：第一阶段使用 PostgreSQL Full Text Search + `pg_trgm`。
- API：REST + OpenAPI；前端不再直接访问数据库。
- 部署：Docker Compose 开发环境，生产使用 Docker + Nginx 或现有进程管理方案。

选择模块化单体，是因为当前产品和团队规模还不需要微服务，但必须明确 Web、API、worker、数据库和文件存储之间的边界。

## 2. 产品范围收敛

### 2.1 保留并强化

#### 今日学习

首页改为学习工作台，而不是研究搜索入口。首屏回答：今天应该学什么、上次学到哪里、哪些内容需要补强。

首版包含：

- 今日到期复习和逾期复习；
- 继续学习入口；
- 最近错题；
- 最近编辑的笔记；
- 本周练习题数、正确率和复习完成率；
- 按课程或主题查看薄弱点。

#### 题库

题库从“题目列表”升级为练习工作区，支持：

- 课程/科目/主题；
- 标签、难度、来源和掌握状态；
- 收藏、错题、待复习、最近练习筛选；
- 文本、图片和附件；
- 批量导入、批量编辑和重复检查。

题目详情必须默认隐藏答案，形成完整练习流程：

```text
查看题干 → 思考或输入答案 → 查看答案/解析 → 自评 → 写入练习记录和复习状态
```

错题本由练习记录和评分筛选生成，不复制一套题目数据。

#### 笔记

笔记是学习资料的主要沉淀位置，首版方向为：

- Tiptap 富文本编辑；
- 自动保存和草稿恢复；
- 课程、文件夹和标签组织；
- 全文搜索；
- 题目与笔记双向关联；
- 在笔记中嵌入题目卡片；
- 从笔记生成题目；
- 版本历史和回收站；
- Markdown、HTML、纯文本导入/导出。

Tiptap 文档逐步以 JSON 作为编辑源，HTML 作为展示或兼容缓存：

```text
note.content_json  → 编辑、结构化处理和版本保存
note.content_html  → 展示、兼容旧数据和过渡期搜索
```

#### 复习

题目和词汇都进入统一复习体验。用户可复习：

- 新内容；
- 到期内容；
- 逾期内容；
- 错题重练；
- 指定课程或词集。

界面评分文案统一为“不会、模糊、记住了、很熟”，后台再映射到调度算法。当前简化 SM-2 可以作为迁移期实现，稳定后评估 FSRS；算法替换不应改变复习日志的可追溯性。

#### 学习进度

统计必须可以从练习记录和复习日志重算，包含：

- 学习天数和连续学习；
- 按课程/主题的学习量；
- 正确率和掌握变化；
- 复习完成率；
- 逾期量；
- 薄弱知识点。

### 2.2 隐藏而非立即删除

从普通用户导航、首页、命令面板和产品文案中隐藏：

- 论文和 arXiv；
- 研究搜索和深度研究；
- 通用 Agent、Agent 历史和产物；
- 记忆系统；
- 知识图谱；
- Hyper-RAG 研究问答；
- Nextcloud 和沙箱能力。

第一阶段不物理删除旧代码、旧数据或旧表。通过 feature flag 或路由保护隐藏，保留只读和回滚窗口。等核心链路稳定、数据完成迁移并备份验证后，再决定归档或移除。

知识库是例外：旧的 `/kb`、`/qa` 和 Hyper-RAG 研究问答按上述规则隐藏，但“上传学习资料并基于资料提问”作为学习闭环的一部分重新实现，落在新后端和新路由 `/knowledge` 上，不复用旧页面和旧服务。

英语对话功能可以保留，但改名为“英语练习”。会话中临时提取的单词只作为候选词或学习记录，不能继续作为正式词库的唯一数据来源。

### 2.3 明确的非目标

第一阶段不做：

- 社区动态和公开题库运营；
- 复杂实时协作编辑；
- 自建知识图谱；
- 通用型 Agent；
- 研究工作流和论文自动收集；
- 实时爬取商业词汇网站；
- 向量数据库或独立搜索集群；
- 以未经审核的 OCR 文本直接发布学习内容。

## 3. 英语学习资料与词汇导入决策

### 3.1 产品目标

第一批结构化学习资料从英语词汇开始，覆盖三个备考分类：

- CET-6（英语六级）；
- IELTS（雅思）；
- TOEFL（托福）。

这里的“CET-6、IELTS、TOEFL”首版表示学习目标和词集分类，不自动表示“官方完整词表”。在取得明确授权或开放再分发许可前，产品不得宣传为官方完整词表，也不得复制商业课程或词典受版权保护的释义、例句、音频或原始排版。

### 3.2 资料来源优先级

#### 第一优先级：授权或明确开放许可的数据

管理员登记并审核以下信息后，才可以制作公共内置词集：

- 来源名称和 URL；
- 作者或发布方；
- 许可证和允许的再分发范围；
- 必须展示的署名；
- 数据版本和发布日期；
- 获取时间；
- 原始文件 checksum；
- 审核人、审核结论和备注。

可以研究使用明确开放许可的通用英语词汇、词形或词网数据作为辅助，但其许可必须单独核实。通用词频、词网或 CEFR 数据不能未经核实就标记为 CET-6、IELTS 或 TOEFL 官方词表。

#### 第二优先级：用户自有文件

MVP 的主要导入方式是用户上传自己拥有、获得授权或有权使用的资料：

- CSV；
- TSV；
- JSON。

用户需要确认自己拥有使用权，系统保留导入来源和导入时间，但不替用户判断其文件是否享有版权许可。

#### 第三优先级：管理员精选版本

管理员可以把已审核的开放数据或已授权数据整理成版本化词集，经过预览和审核后发布。管理员发布的是“学习集合”或“备考分类”，不是在无依据时宣称官方词表。

### 3.3 不采用的来源策略

第一版不做以下事情：

- 批量抓取商业词汇网站；
- 抓取需要登录、绕过反爬或违反站点条款的内容；
- 从搜索结果自动复制词典释义、例句或音频；
- 将 PDF OCR 的未经审核结果直接发布为公共词集；
- 把 AI 生成的释义伪装成来源原文。

如果将来接入公开网页，必须先通过来源登记、许可证核验、人工抽样和再分发评估；抓取器不能绕过访问控制。

### 3.4 首版文件格式

CSV/TSV 的最小字段为：

```text
word
```

推荐可选字段：

```text
lemma
phonetic
part_of_speech
meaning_zh
definition_en
example
level
tags
```

JSON 使用版本化 schema，支持一个词包含多个词性、多个释义和多个例句。例如：

```json
{
  "schema_version": "1.0",
  "source": {
    "name": "用户自有词表",
    "url": null,
    "license": "user-provided"
  },
  "entries": [
    {
      "word": "abandon",
      "lemma": "abandon",
      "parts_of_speech": [
        {
          "part_of_speech": "verb",
          "meanings_zh": ["放弃"],
          "definitions_en": ["to leave completely"],
          "examples": ["They had to abandon the plan."]
        }
      ],
      "tags": ["CET-6"]
    }
  ]
}
```

PDF/DOCX 后续可以作为原始资料保存和人工整理入口，但不作为第一版高质量词条的直接来源。结构化文件优先于版式复杂的 PDF。

### 3.5 导入流程和可靠性

固定流程：

```text
选择来源/上传文件
  → 解析
  → 字段映射
  → 校验与预览
  → 去重和冲突策略
  → 用户确认
  → 分批写入
  → 建立复习卡
  → 导入报告
```

必须支持：

- UTF-8 和常见 BOM；
- 表头映射和预览前 20–50 行；
- 必填字段、长度、非法字符和重复词检查；
- 单词规范化（trim、大小写、Unicode 空白、可选词形规则）；
- 同一词集内去重；
- 同一词进入多个词集；
- 冲突时选择跳过、覆盖或保留两个版本；
- 分批事务写入；
- 成功、跳过、失败行和原因统计；
- 错误行下载；
- 可重试和可撤销导入批次；
- 导入幂等。

默认幂等键为：

```text
source_id + source_version + vocab_set_id + normalized_word
```

重复导入相同来源和版本不得重复生成词条或复习卡。

### 3.6 词汇实体边界

词汇不是 `questions` 的特殊文本，也不是英语页面的 `localStorage` 字符串。它有独立的词集、词条、来源和导入批次实体，并接入统一复习系统。

词条至少支持：

- 规范词形和展示词形；
- 音标（可空）；
- 词性；
- 中文释义和英文释义；
- 多个释义、例句和标签；
- 难度/CEFR（仅在来源提供时保存）；
- 来源和内容版本；
- 原始内容与生成内容的来源标记。

AI 生成的释义、例句、助记和难度建议必须标记为 `generated`，允许用户修改和删除，不得覆盖原始来源数据。核心导入、查看和复习流程不能依赖 AI 可用。

## 4. 目标信息架构与核心数据模型

### 4.1 目标导航和模块

```text
今日学习
├── 今日任务
├── 继续学习
├── 最近错题
└── 本周进度

题库
├── 全部题目
├── 我的题目
├── 错题
├── 收藏
├── 待复习
└── 课程/主题

笔记
├── 全部笔记
├── 文件夹/课程
├── 最近编辑
└── 回收站

复习
├── 今日复习
├── 逾期
├── 新内容
└── 复习历史

学习进度
└── 课程、知识点、连续学习、薄弱点
```

### 4.2 目标表

核心领域表：

- `users`
- `courses`、`course_members`（多人协作后续启用）
- `questions`、`question_options`、`question_tags`、`tags`、`question_attachments`
- `notes`、`note_folders`、`note_tags`、`note_question_links`、`note_versions`
- `study_sessions`、`study_answers`
- `review_cards`、`review_logs`
- `files`、`learning_materials`、`import_jobs`、`import_job_errors`
- `vocab_sets`、`vocab_entries`、`vocab_set_entries`
- `ai_generation_jobs`

关键约束：

- 词集、词条、来源和导入批次分离；同一词条可以进入多个词集。
- 资料来源保存 URL、许可证、归属、版本、获取时间和 checksum。
- 统一附件表支持多个附件、对象 key、MIME、大小、hash 和处理状态。
- `note_question_links` 支持题目与笔记双向跳转。
- `review_cards` 使用可扩展的 `target_type + target_id` 或等价的受约束关联，兼容题目和词汇；同一用户和同一目标只能有一张活动复习卡。
- 保留旧题目 UUID、笔记 UUID、用户归属和复习历史，迁移时不重建业务身份。
- 练习记录保存题目、用户答案、自评、是否正确、耗时和发生时间。

### 4.3 现有代码的迁移注意事项

当前仓库的 SQL、手写 `database.types.ts` 和页面查询存在漂移，不能只凭仓库文件推断线上 schema。迁移前必须盘点实际环境中的：

- 表、列、外键和唯一约束；
- RLS 策略和触发器；
- Storage bucket 与对象；
- 已执行 migration；
- 旧数据的附件 URL 和可访问性。

`notes`、`note_tags`、班级状态、题目可见性和复习排期尤其需要先核对。旧的 `kb_documents` 可以作为资料来源候选，但不强行转换成词条。

## 5. 后端目标架构

```text
浏览器
  ↓ REST / OpenAPI
Next.js Web
  ↓
NestJS + Fastify API
  ├── Auth / Users
  ├── Courses / Tags
  ├── Questions / Practice
  ├── Notes / Links
  ├── Review / Progress
  ├── Materials / Imports
  ├── Vocabulary
  └── AI assistance
       ├── PostgreSQL
       ├── Redis + BullMQ worker
       ├── S3-compatible storage
       └── LLM provider（可选增强）
```

领域模块建议为：

```text
auth
users
courses
questions
practice
notes
review
progress
materials
imports
vocabulary
files
search
ai
```

前端不再直接调用数据库 SDK。所有写操作经过 API 的身份、权限、输入校验和事务边界。AI 只作为增强能力，不成为题目、词汇导入和复习的必需依赖。

## 6. Supabase 替换策略

### 6.1 不采用一次性重写

不直接删除 Supabase，不在第一步同时迁移所有旧模块。采用“新后端先行、核心业务分阶段切换、旧系统只读保留”的路线。

### 6.2 迁移步骤

1. 盘点线上 Supabase schema、RLS、Storage 和 migration 执行状态。
2. 新建 API、worker 和数据库迁移目录，创建本地 PostgreSQL、Redis、MinIO 环境。
3. 实现 Better Auth、基础用户模块、Drizzle schema 和健康检查。
4. 编写一次性导出/导入工具，迁移用户、标签、题目、笔记、附件、复习排期和复习日志，保留 UUID 与时间戳。
5. 将旧固定附件列映射为统一 `files`/附件记录；原始 `kb_documents` 暂作为资料来源候选。
6. 进行双读或只读影子验证，对比记录数、用户归属、抽样 hash、附件访问和复习排期。
7. 先切换题库、笔记、复习和英语资料模块的写入，再切换读取。
8. 保留旧 Supabase 只读备份和回滚入口，确认新系统运行稳定后再移除旧 SDK/API。

所有迁移必须可重复执行，带有计数、checksum、失败报告和回滚说明。导入与生成类 API 使用事务或可恢复状态机，避免半成功状态。

## 7. 分阶段实施计划

### Phase 0：产品收敛和旧功能保护

**产出**：隐藏非核心入口、今日学习信息架构、feature flag、产品文档和旧功能保留清单。

**验收**：核心导航只呈现学习辅助主线；旧数据未删除；旧路由可按开关访问。

### Phase 1：后端基础设施

**产出**：NestJS/Fastify API、PostgreSQL、Drizzle、Better Auth、Redis/BullMQ、MinIO、OpenAPI、统一错误/日志/权限中间件、Docker Compose。

**验收**：注册登录、健康检查、数据库 migration、文件上传和 API 基础测试通过。

### Phase 2：核心数据与迁移

**产出**：目标 schema、导出/导入脚本、迁移校验报告、题目/笔记/标签/附件/复习历史兼容层。

**验收**：核心 UUID 保留；记录数和抽样内容一致；失败可重试和回滚。

### Phase 3：题库和练习体验

**产出**：课程/主题、筛选、答案隐藏、作答输入、练习记录、错题本、收藏、批量编辑和题目附件。

**验收**：一次练习可以形成记录并影响错题与复习队列；桌面和移动端均可用。

### Phase 4：笔记体验

**产出**：自动保存、草稿恢复、文件夹/课程、全文搜索、题目嵌入与双向链接、版本/回收站、导入导出。

**验收**：刷新或短暂断网后草稿不丢；笔记和题目可以互相跳转。

### Phase 5：英语词汇资料与复习

**产出**：来源登记、词集管理、CSV/TSV/JSON 导入、字段映射、预览、校验、去重、错误报告、CET-6/IELTS/TOEFL 学习分类、词条详情和统一复习卡。

**验收**：同一来源重复导入幂等；失败行可定位和下载；词汇可以进入复习；来源、许可和版本信息完整保留。

### Phase 6：今日学习与学习进度

**产出**：每日任务、到期/逾期汇总、课程进度、薄弱知识点、连续学习和复习统计。

**验收**：统计可以由练习/复习日志重算；空数据、跨日和跨时区场景正确。

### Phase 7：学习 AI 增强

**产出**：从笔记生成题目、答案解释、词汇助记/例句、难度建议。

**验收**：所有生成内容可编辑、可删除并标记来源；AI 不可用时核心导入、练习和复习仍然可用；生成失败可重试。

## 8. 测试、发布与验收

### 8.1 自动化测试

- API：认证、权限、题目/笔记 CRUD、导入幂等、错误行、事务回滚和文件权限。
- 数据：迁移计数、抽样 hash、旧 UUID 保留、复习日志重算。
- 算法：复习调度纯函数、题目和词汇共用目标、时区边界。
- 导入：CSV/TSV/JSON 字段校验、编码、重复、冲突、超大文件和部分失败。
- UI：今日学习、题目作答、答案显示、错题、自动保存、词汇导入预览和移动端流程。

每个阶段继续运行现有测试，并新增 TypeScript、构建和 API/导入测试。当前仓库的测试和类型覆盖有限，不能把“构建通过”当作产品验收的全部依据。

### 8.2 发布顺序

1. 文档和 feature flag 发布，不改变旧数据。
2. 新后端在本地和测试环境运行，导入一份脱敏数据。
3. 只读影子验证和迁移报告通过。
4. 小范围切换核心模块写入。
5. 观察错误率、导入失败、复习排期和文件访问。
6. 扩大到全部用户。
7. 完成备份和回滚验证后，逐步移除 Supabase 依赖。

## 9. 风险与决策边界

- **版权与许可风险**：没有明确许可就不内置、不再分发；优先用户自有文件和已审核开放数据。
- **来源质量风险**：考试分类不等于官方词表；每个词集必须显示来源、版本和审核状态。
- **数据漂移风险**：当前 SQL、手写类型和实际数据库可能不一致；迁移前以线上盘点为准。
- **重写风险**：一次性迁移范围过大；严格按后端基础、核心迁移、题库/笔记/复习、英语词汇的顺序实施。
- **AI 依赖风险**：AI 只能增强学习，不能成为导入、查看和复习的单点故障。
- **时区风险**：学习日、连续学习和到期计算必须明确用户时区，日志保存 UTC 时间。
- **隐私风险**：题目、笔记、文件和练习记录默认私有；公开或团队共享必须是显式动作。

## 10. 后续实施文件顺序

1. 产品 feature flag、核心导航和首页收敛（隐藏，不删除旧模块）。
2. 新建后端 workspace、Docker Compose、Drizzle schema/migrations 和认证基础。
3. 实现 Supabase 导出/新数据库导入与校验工具。
4. 按 Phase 3–6 重做前端体验和 API；英语词汇导入在 Phase 5 开始。
5. 每阶段更新本计划的状态、验收结果、迁移说明和回滚记录。
6. 完成核心切换与备份验证后，再清理旧 Supabase、研究和 Agent 依赖。

## 11. 相关现有文件

- `app/questions/`：当前题库页面和详情。
- `app/notes/`、`components/NoteEditor.tsx`：当前笔记流程和编辑器。
- `app/review/`、`lib/review.ts`：当前复习 UI 和间隔排期算法。
- `app/english/`：当前英语对话和临时词汇记录。
- `supabase/`：现有 schema、功能迁移和修复脚本，仅作为迁移输入，不作为新的后端架构。
- `docs/UI_UX_ROADMAP.md`：旧 UI 路线图；与本文冲突时，以本文的学习辅助定位为准。
- `docs/DEPLOY.md`：旧 Supabase/PM2 部署说明，待新后端阶段重新编写。

## 12. 开发状态记录

### Phase 0：产品收敛和旧功能保护

**状态：已完成首轮实现，待验收。**

已完成：

- 新增 `lib/product-flags.ts`，集中定义旧研究工作区开关和受保护的旧路由前缀。
- 新增 `middleware.ts`：当 `NEXT_PUBLIC_ENABLE_LEGACY_WORKSPACE` 不是 `true` 时，将普通访问 `/agent`、`/research`、`/search`、`/kb`、`/qa`、`/reader`、`/papers`、`/graph` 的请求重定向到今日学习；旧代码、旧页面和旧数据均未删除。
- 桌面端导航收敛为今日学习、题库、笔记、复习、学习进度；设置继续保留在底部账户区。
- 移动端主导航收敛为今日学习、题库、复习、笔记、我的；旧研究入口从更多菜单移除。
- 命令面板默认只展示学习主线、英语练习和账户入口；开启旧工作区开关后才展示旧研究入口。
- 根首页从研究搜索页改为“今日学习”工作台，展示待复习、本日复习、本周新增题目、最近题目和最近笔记。
- 新增 `/progress` 学习进度页，提供基于现有题目、笔记和复习日志的基础统计，并明确后续课程/主题统计尚未接入。

未完成：

- 旧模块仍可由环境开关恢复，尚未建立管理员专用的旧工作区入口。
- 今日学习目前直接读取 Supabase，尚未切换到新 API；统计仍是基础计数，未覆盖课程、主题、薄弱点、正确率和时区设置。
- `NEXT_PUBLIC_ENABLE_LEGACY_WORKSPACE` 是构建期前端开关；生产切换前必须重新构建并验证旧路由重定向，不能把它当作运行时权限系统。
- 旧导航之外的文案、README、旧页面内部链接和 API 仍包含研究/Agent 能力，暂未删除，避免迁移前破坏兼容性。

下一阶段注意事项：

- Phase 1 先建立 NestJS/Fastify、PostgreSQL、Drizzle、Better Auth、Redis/BullMQ、MinIO 和统一 API 边界；不要在新后端未具备健康检查和迁移回滚前切换现有页面写入。
- 新 API 需要优先覆盖今日学习所依赖的复习汇总、题目列表和笔记列表，并明确用户时区后再重算学习日与连续学习。
- 迁移前必须盘点线上 Supabase 的实际 schema、RLS、Storage 对象和 `review_schedule`/`review_logs` 数据，再决定兼容层字段映射。
- 保持旧开关和旧路由可回滚，Phase 1–2 期间不删除研究、Agent、知识库和论文数据。

验收记录：

- 已完成静态入口审计和文档更新。
- `npx tsc --noEmit`：通过。
- `npm test`：通过，2 个测试文件、50 个测试用例全部通过。
- `git diff --check`：通过。
- `npm run build`：使用非敏感占位 Supabase 配置后通过，新增 `/progress` 路由和 Proxy（由 `middleware.ts` 生成）均成功编译。未配置环境变量时，构建会在旧的 `/api/reset-password` 模块收集阶段因 Supabase 配置缺失而失败；这属于当前项目既有环境依赖，部署前必须提供真实配置。
- 浏览器验证：在实际开发端口 `3001` 上确认今日学习首页、核心导航和空数据态；直接访问 `/research` 默认重定向到 `/`。端口 `3000` 已有其他应用，不能作为本项目验收地址。
- 已知警告：Next.js 16 提示 `middleware.ts` 命名约定将迁移为 `proxy.ts`；本阶段保留兼容写法，Phase 1 统一升级时处理。
- 未执行：`NEXT_PUBLIC_ENABLE_LEGACY_WORKSPACE=true` 的恢复路径尚未在独立构建进程中做浏览器回归；该开关属于发布/回滚验证项。

### Phase 0 发布记录：2026-10-02

**状态：已部署到生产环境，线上健康检查通过。**

- 发布分支：`deploy/phase-0-learning-product`。
- Git 提交：`2ffa410 feat: converge app on learning workflow`。
- 服务器目录：`/home/deploy/synap`。
- 服务器已切换到上述分支，生产构建成功，PM2 `question-bank` 已重启并保持 `online`。
- 服务器依赖安装曾因 npm registry `ECONNRESET` 中断；使用串行连接和重试参数重新执行 `npm ci` 后成功，最终安装 525 个依赖包。
- 生产构建 `npm run build` 成功，`/progress` 路由和由 `middleware.ts` 生成的 Proxy 均编译通过。
- 本机健康检查：首页 `200`；`/research` 最终重定向到 `/`；`/progress` 返回 `200`。
- 公网健康检查：`https://synap.fallrain0905.top/` 返回 `200`，页面包含“今天学点什么”和“今日学习”；公网 `/research` 最终重定向到首页。
- 当前服务器保留原有的 `crawl-service` 和 `synapse-run-worker`；`arxiv-cron` 维持部署前的停止状态。服务器工作区未跟踪的 `crawl-service/.venv/` 为原有 Python 虚拟环境，不属于本次发布内容。

本次发布未完成或未改变：

- Supabase 仍是当前线上数据后端；NestJS/Fastify、PostgreSQL、Drizzle、Better Auth、Redis/BullMQ 和 MinIO 尚未实施。
- 旧研究、Agent、论文和知识库代码仍保留，只通过默认 feature flag 和路由保护隐藏。
- `middleware.ts` 仍会触发 Next.js 16 的弃用提示，后续应迁移为 `proxy.ts` 并重新回归旧路由保护。
- 尚未在独立生产构建中验证 `NEXT_PUBLIC_ENABLE_LEGACY_WORKSPACE=true` 的恢复路径。

下一步：进入 Phase 1，先建立新后端基础设施、数据库迁移和健康检查；在新 API 具备迁移回滚能力前，不切换题目、笔记和复习的线上写入。

### Phase 1 首轮：后端基础骨架与本地依赖编排

**状态：已完成首轮基础设施，业务接入未开始。**

已完成：

- 新增独立 `api/` workspace，使用 NestJS 11 + Fastify 5，与现有 Next.js 应用并行运行。
- 新增 `/api/health` 存活检查、`/api/health/ready` 就绪检查和 `/api/docs` Swagger UI/OpenAPI 入口。
- 启用全局输入校验管道、基础 CORS、session cookie 的 OpenAPI 认证声明；当前尚未接入真实认证。
- 新增 `tsconfig.api.json`、`api:dev`、`api:build`、`api:start` 脚本，API 默认监听 `127.0.0.1:4000`。
- 新增 `docker-compose.phase1.yml`，提供 PostgreSQL 16、Redis 7 和 MinIO 的本地开发容器、数据卷和健康检查。
- 新增 `api/.env.example` 与 `api/README.md`，明确服务端配置命名、启动方式和与现网 Supabase/Next.js 的并行边界。
- 将 API 健康检查纯响应逻辑纳入 Vitest，避免测试直接加载 Nest 装饰器。

未完成：

- Drizzle 连接层和首个 `api_metadata` migration 已接入，但 Better Auth + Argon2、Redis/BullMQ worker 和 MinIO 文件上传尚未接入。
- `/api/health/ready` 已检查 PostgreSQL 配置/连通状态；Redis 和对象存储尚未接入检查。
- 新 API 尚未接入题目、笔记、复习或用户业务，也未改变现有 Next.js `/api/*` 路由和 Supabase 数据。
- 当前开发机没有 Docker CLI，`docker compose config` 和容器启动验收未执行；需要在安装 Docker 的开发机或 CI 中验证 Compose。
- `api_metadata` 只属于新 API，不代表旧 Supabase 业务 schema 已迁移。
- 生产环境仍使用 Next.js + PM2 + Supabase；本轮没有修改服务器部署和 Nginx 流量入口。

验收记录：

- `npm run api:build`：通过。
- `npm test`：通过，3 个测试文件、53 个测试用例全部通过。
- 独立 API 接入 Drizzle 后仍可启动；未设置 `DATABASE_URL` 时 readiness 明确返回 `degraded/not_configured`，不会伪装成数据库已就绪。
- 独立 API 冒烟：`GET /api/health`、`GET /api/health/ready`、`GET /api/docs` 均返回 `200`。
- `git diff --check`：通过。
- Docker Compose：未执行，原因是当前开发机没有 Docker CLI；不能将其标记为容器运行验收通过。

下一阶段注意事项：

- 继续扩展 Drizzle migration，但使用独立 PostgreSQL，不直接把现有 Supabase SQL 当作新 schema；接入 Better Auth 前先确定用户 ID、session 和旧 Supabase Bearer token 的隔离边界。
- Better Auth 必须使用仅服务端的 secret 和 cookie；不要复用 `NEXT_PUBLIC_*` 密钥，也不要让新 cookie 被旧 Supabase Bearer API 误认。
- readiness 已开始区分进程存活和 PostgreSQL 依赖就绪；后续接入 Redis、MinIO 后继续扩展检查，并对依赖失败返回可诊断但不泄露凭据的信息。
- 新 API 继续使用独立端口和路径，等认证、迁移和回滚测试通过后再考虑 Nginx 路由或前端页面切换。

### Phase 1 追加：知识库与 RAG 问答模块

**状态：已完成本地实现与离线验证，尚未在真实 PostgreSQL/pgvector 上执行迁移。**

产品决策更新：

- 知识库重新作为学习资料产品的一部分（“上传资料 → 提问 → 标注出处”），不再是旧研究工作区能力。
- 旧 `/kb`、`/qa` 页面和 Hyper-RAG 服务仍保持隐藏，继续由 `NEXT_PUBLIC_ENABLE_LEGACY_WORKSPACE` 控制；新功能使用独立路由 `/knowledge`，避免与受保护的旧路由冲突。
- 资料和向量只写入自建 PostgreSQL + pgvector，不再依赖 Supabase Storage 或 Hyper-RAG Python 服务。

已完成：

- 后端新增 `api/src/knowledge/` 模块：PDF/文本解析、Markdown 分块、向量嵌入、pgvector 检索、RAG 问答。
- PDF → Markdown 使用本地 `pdf-parse` 文本层提取，保留 `<!-- page: N -->` 页码标记，识别编号标题为 Markdown 标题，去掉页码行和重复页眉页脚，合并被连字符拆分的英文单词。
- 分块保留标题和页码上下文，超长段落按句子边界切分并带重叠。
- 新增数据表 `kb_documents`、`kb_chunks`（`vector(2560)` 列 + HNSW 余弦索引），迁移文件 `api/drizzle/0001_*.sql` 手动补上 `CREATE EXTENSION IF NOT EXISTS vector;`。
- Docker Compose 的 PostgreSQL 镜像改为 `pgvector/pgvector:pg16`。
- 嵌入与 LLM 配置沿用现有项目约定：`EMBEDDING_API_KEY`/`SILICONFLOW_API_KEY`、`EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`(默认 2560)、`LLM_API_KEY`/`DEEPSEEK_API_KEY`/`SILICONFLOW_API_KEY`；未配置嵌入 Key 时退化为 `local-hash` 开发向量，并在日志和文档中明确标注质量有限。
- 新增接口：上传资料、资料列表、资料详情、删除、重新索引、提问（返回答案与引用）。
- 新增可选 `API_ACCESS_TOKEN` bearer 门禁，覆盖知识库接口，作为 Better Auth 落地前的临时边界。
- 新增前端 `/knowledge` 页面（上传、提问、引用展示、索引状态轮询、重新索引/删除），并加入桌面导航、移动端更多菜单和命令面板。

未完成：

- 迁移和向量检索尚未在真实 PostgreSQL 上执行；开发机没有 Docker/PostgreSQL，`npm run db:migrate` 与 `<=>` 检索仅通过代码审查和离线管线验证，必须在有 Docker 的环境补验收。
- 索引任务在 API 进程内执行，重启会中断并要求手动重新索引；BullMQ worker 尚未接入。
- 嵌入维度默认 2560（对应 `Qwen/Qwen3-Embedding-4B`），更换模型需要同步修改 `VECTOR_DIMENSIONS` 并新增迁移。
- 扫描版 PDF 无文本层时不支持 OCR，接口会明确报错而不是伪造内容；复杂表格和双栏排版的版面结构可能丢失。
- 知识库尚未与题库、笔记或复习打通，也未接入用户体系（当前是单用户工作区，不做数据隔离）。
- 生产环境未部署新 API，公网暂时无法使用 `/knowledge`。

验收记录：

- `npm test`：通过，8 个测试文件、79 个测试用例全部通过（新增分块、PDF 转 Markdown、hash 嵌入、AI 配置解析、访问令牌共 26 个用例）。
- `npm run api:build`、`npx tsc --noEmit`：通过。
- `npm run build`：通过，路由列表包含 `/knowledge`。
- 接口冒烟：`/api/health` 200；`/api/knowledge/*` 在未配置数据库时返回 503 和明确的中文提示；空问题、越界 `topK` 返回 400；OpenAPI 文档包含 6 条知识库路径。
- 页面渲染：开发服务器 `/knowledge` 返回 200，包含“知识库 / 上传资料 / 基于资料提问 / 资料列表 / 扫描版 PDF”标记。
- 离线管线验证：本地生成的 PDF 经 `pdfBufferToMarkdown → chunkMarkdown → hashEmbedding → 余弦检索` 得到正确分块（页码、标题、检索命中均符合预期）。
- 未执行：真实数据库迁移、pgvector 检索、真实嵌入模型和真实 LLM 调用。

下一阶段注意事项：

- 在有 Docker 的环境先执行 `npm run api:compose:up` → `npm run db:migrate`，再验证上传、检索与引用；确认 HNSW 索引和 `<=>` 排序结果正确后再考虑部署。
- 若要在生产开放知识库，需要先补用户认证（Better Auth）和数据归属隔离，并给学习 API 规划 Nginx 路由与 PM2 进程，不要直接暴露 4000 端口。
- 大文件与批量导入后续应迁移到 BullMQ 队列，并补充重试、进度上报和失败续跑。

### Phase 1 追加其二：MinerU 解析与可重试的索引流程

**状态：已完成实现与单元/接口验证，仍需在有 Docker 和 MinerU Token 的环境做真机验收。**

已完成：

- PDF 转换改为优先调用 MinerU API（<https://mineru.net/apiManage>），保留本地文本层解析作为回退：
  - 配置 `MINERU_API_TOKEN` 时走官方 v4 精确解析：`POST /api/v4/file-urls/batch` 取签名上传链接 → `PUT` 上传 → 轮询 `GET /api/v4/extract-results/batch/{batch_id}` → 下载 `full_zip_url` 解压取 Markdown。
  - 未配置 Token 时走免鉴权的 agent 快速解析：`POST /api/v1/agent/parse/file` → `PUT` 上传 → 轮询 `GET /api/v1/agent/parse/{task_id}` → 下载 `markdown_url`。
  - `MINERU_PARSE_MODE` 可强制链路；`KB_PDF_FALLBACK_LOCAL=false` 可关闭回退；`MINERU_ENABLED=false` 可完全停用 MinerU。
  - 转换方式写入 `kb_documents.converter`（`mineru-v4` / `mineru-agent` / `local-pdf-parse` / `text`），便于排查来源质量。
- MinerU 返回结果中的图片不落盘，Markdown 里的图片语法统一替换为 `[图片]` 占位，避免留下失效链接。
- 新增本地文件存储 `api/src/storage/`：原始上传文件按 `文档 ID/文件名` 保存到 `KB_STORAGE_DIR`（默认 `.data/knowledge`，已加入 `.gitignore`），文件名做了路径穿越防护；接口保持不变，后续可换 MinIO/S3 驱动。
- 索引流程改为可重试：
  - 服务启动时把中断的索引任务重新排队，并从原始文件重新解析（此前一律标记失败）。
  - `POST /api/knowledge/documents/:id/reindex` 支持 `{ "fromSource": true }`，用原始文件重跑 MinerU；不带参数则只重新分块和向量化已保存的 Markdown。
  - 删除文档时同步删除保存的原始文件。
  - 进程内索引任务改为串行队列，避免 MinerU 和嵌入接口被并发打爆。
- 新增 `kb_documents.converter`、`kb_documents.source_storage_key` 两列（迁移 `api/drizzle/0002_*.sql`）。
- 前端 `/knowledge` 页面显示转换方式，并对失败文档提供「重新解析」（用原始文件）和「重新索引」两个操作。

未完成：

- 未使用真实 MinerU Token 调用过线上接口：鉴权、真实解析质量、页数与配额限制都未验证。
  v4 批量链路已用本地假 MinerU 服务（真实 HTTP + 真实 zip）验证；agent 链路目前只有桩测试。
- zip 解压只取 Markdown 文本，MinerU 结果里的图片、版式 JSON 未保存，也未解析表格结构。
- MinIO/S3 驱动、BullMQ worker、并发与进度上报仍未接入；索引队列仍是进程内串行。
- 迁移与向量检索仍未在真实 PostgreSQL 上执行（开发机没有 Docker/PostgreSQL）。

验收记录：

- `npm test`：通过，13 个测试文件、108 个测试用例全部通过（新增 MinerU 配置 5、MinerU 响应解析 11、MinerU 双链路桩测试 5、zip 解压 3、文件存储 5）。
- `npm run api:build`、`npx tsc --noEmit`：通过。
- MinerU 桩测试覆盖：agent 链路上传/轮询/下载、v4 链路签名上传与 Bearer 鉴权、错误信封（`code != 0`）、任务失败状态、超时。
- 文件存储测试覆盖：读写存在删除、CJK 文件名、路径穿越拒绝、前导点与非法字符清理。
- MinerU v4 真实链路验证：用本地假 MinerU 服务跑通「申请签名链接 → 无 Content-Type 的 PUT 上传（13 字节）→ 轮询两次得到 done → 下载真实 zip → 解压 full.md → 图片转 `[图片]`」，鉴权头、请求体、转换方式（`mineru-v4`）均符合预期。
- 该验证发现并修复了一个真实缺陷：yauzl 3 的 `fromBufferPromise` 强制 `lazyEntries`，原先只调用一次 `readEntry()` 会导致解压永久挂起；现已在 `entry` 回调中继续读取，并补了 zip 单测锁定行为。
- 未执行：真实 MinerU 调用、真实数据库迁移与向量检索。

下一阶段注意事项：

- 在有 Token 的环境先用一份真实 PDF 跑通 `MINERU_PARSE_MODE=v4-batch` 和 `agent` 两条链路，确认签名上传不需要 `Content-Type`、zip 内 Markdown 命名（代码优先取 `full.md`）和轮询状态取值与文档一致。
- `KB_STORAGE_DIR` 在生产必须指向持久化卷，否则重启后无法自动重试解析。
- 大文件（MinerU 单文件上限 200MB、200 页）和批量导入在接入 BullMQ 前不要并发提交，避免占用进程内队列和外部额度。
