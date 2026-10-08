# Learning API

Phase 1 的独立 NestJS + Fastify API 骨架。它与现有 Next.js/Supabase 应用并行运行，暂不接管旧 `/api/*` 路由或线上数据写入。

## 本地运行

```bash
npm run api:dev
```

默认监听 `127.0.0.1:4000`，可访问：

- `GET /api/health`：进程存活检查
- `GET /api/health/ready`：检查 API 进程和 PostgreSQL 配置/连通状态
- `GET /api/docs`：OpenAPI/Swagger 文档

## 知识库与 RAG 问答

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/knowledge/collections` | 知识库列表（含资料数、就绪数、分块数） |
| `POST` | `/api/knowledge/collections` | 新建知识库 `{ name, description? }` |
| `PATCH` | `/api/knowledge/collections/:id` | 重命名或修改描述 |
| `DELETE` | `/api/knowledge/collections/:id` | 删除知识库；`?force=true` 时连同资料一起删除 |
| `POST` | `/api/knowledge/documents` | 上传 PDF/Markdown/文本（multipart 字段 `file`），可用 `?collectionId=` 指定知识库 |
| `GET` | `/api/knowledge/documents` | 资料列表与索引状态，可用 `?collectionId=` 过滤 |
| `GET` | `/api/knowledge/documents/:id` | 单篇资料（含转换后的 Markdown） |
| `GET` | `/api/knowledge/documents/:id/logs` | 索引过程日志（步骤、向量化进度、错误原文） |
| `DELETE` | `/api/knowledge/documents/:id` | 删除资料及其分块 |
| `POST` | `/api/knowledge/documents/:id/reindex` | 重新分块和向量化；传 `{ "fromSource": true }` 时用保存的原始文件重新解析 |
| `POST` | `/api/knowledge/ask` | 向量检索 + LLM 回答，返回引用来源；传 `collectionId` 只检索指定知识库 |

处理流程：

```text
上传 → 保存原始文件 → MinerU 解析为 Markdown → 分块（含标题与页码上下文）
→ 向量嵌入 → 写入 pgvector → 提问时向量检索 → LLM 基于片段作答并标注引用
```

### PDF 解析（MinerU）

PDF 默认交给 MinerU（<https://mineru.net/apiManage> 获取 Token）：

- 配置 `MINERU_API_TOKEN` 时使用官方 v4 精确解析：`POST /api/v4/file-urls/batch` 获取签名上传链接 →
  `PUT` 上传文件 → 轮询 `GET /api/v4/extract-results/batch/{batch_id}` → 下载 `full_zip_url`
  并取出其中的 Markdown。
- 未配置 Token 时使用免鉴权的 agent 快速解析：`POST /api/v1/agent/parse/file` → 上传 →
  轮询 `GET /api/v1/agent/parse/{task_id}` → 直接下载 `markdown_url`。
- 两者都失败时，若 `KB_PDF_FALLBACK_LOCAL` 不为 `false`，回退到本地文本层解析；
  文档上会记录实际使用的转换方式（`mineru-v4` / `mineru-agent` / `local-pdf-parse`）。
- `MINERU_PARSE_MODE` 可以强制指定链路，`MINERU_TIMEOUT_MS` 控制整体等待时间，
  `MINERU_IS_OCR=true` 打开扫描件 OCR。MinerU 返回结果里的图片不会被本产品保存，
  Markdown 中的图片语法会替换成 `[图片]` 占位。

### 原始文件存储与重试

- 上传的原始文件保存在 `KB_STORAGE_DIR`（默认 `<仓库>/.data/knowledge`），
  这样解析失败或服务重启后可以用「重新解析」重跑 MinerU，而不必重新上传。
- 服务启动时会把被中断的索引任务重新排队；原始文件缺失时才标记为失败。
- 索引任务在进程内串行执行；BullMQ worker 接入后会替换这一实现。

环境变量：

- `EMBEDDING_API_KEY`（或 `SILICONFLOW_API_KEY`）配置真实嵌入模型；未配置时退化为
  本地 `local-hash` 向量，只适合联调，检索质量有限。
- `EMBEDDING_DIMENSIONS` 默认 2560，必须与 `api/src/database/schema.ts` 中
  `VECTOR_DIMENSIONS` 一致，否则写入会报维度不匹配。
- `LLM_API_KEY` / `DEEPSEEK_API_KEY` / `SILICONFLOW_API_KEY` 配置问答模型；未配置时
  只返回检索片段，不生成回答。
- `API_ACCESS_TOKEN` 可选，设置后所有知识库接口都要求 `Authorization: Bearer <token>`。
- `KB_MAX_UPLOAD_MB` 默认 30。

已知边界：

- 扫描版 PDF 需要 MinerU（`MINERU_IS_OCR=true`）；既没有文本层又关闭 MinerU 时会明确报错，而不是伪造内容。
- 本地回退解析是启发式转换（标题识别、页眉页脚去重、连字符合并），不是版面还原；
  复杂表格和双栏排版可能丢失结构，这类文档建议走 MinerU。
- 索引任务在 API 进程内串行执行；重启会重新排队，但仍不适合大量并发导入，
  BullMQ worker 接入后会替换这一实现。
- MinerU 结果中的图片和表格截图不会保存，Markdown 里的图片语法会变成 `[图片]` 占位。

## 基础设施

```bash
npm run api:compose:up
```

这会启动 PostgreSQL 16、Redis 7 和 MinIO。默认开发端口分别为 `5432`、`6379`、`9000`，数据保存于 Docker named volumes。

停止基础设施：

```bash
npm run api:compose:down
```

## 数据库迁移

设置 `DATABASE_URL` 后，可以生成或执行 Drizzle migration：

```bash
npm run db:generate
npm run db:migrate
```

当前 migration 只创建 API 自身的 `api_metadata`、`kb_documents`、`kb_chunks`（含 pgvector 扩展与 HNSW 索引），
不读取或修改现有 Supabase schema。

## 当前边界

- 数据库和 Redis 目前只提供本地开发基础设施；数据库连接和 readiness 检查已接入。
- 原始文件保存在本地磁盘（`KB_STORAGE_DIR`）；MinIO/S3 驱动会在后续 Phase 1 子阶段接入。
- Better Auth + Argon2 和 BullMQ worker 尚未接入。
- 生产环境仍由 Next.js + PM2 + Supabase 提供服务；不要直接把本地 Compose 配置用于生产。
