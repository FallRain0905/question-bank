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
| `POST` | `/api/knowledge/documents` | 上传 PDF/Markdown/文本（multipart 字段 `file`），后台解析、分块、向量化 |
| `GET` | `/api/knowledge/documents` | 资料列表与索引状态 |
| `GET` | `/api/knowledge/documents/:id` | 单篇资料（含转换后的 Markdown） |
| `DELETE` | `/api/knowledge/documents/:id` | 删除资料及其分块 |
| `POST` | `/api/knowledge/documents/:id/reindex` | 基于已保存 Markdown 重新分块和向量化 |
| `POST` | `/api/knowledge/ask` | 向量检索 + LLM 回答，返回引用来源 |

处理流程：

```text
上传 → PDF/文本解析为 Markdown（保留页码标记）→ 分块（含标题与页码上下文）
→ 向量嵌入 → 写入 pgvector → 提问时向量检索 → LLM 基于片段作答并标注引用
```

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

- 扫描版 PDF 没有文本层，当前不做 OCR，会明确报错而不是伪造内容。
- 解析为本地启发式转换（标题识别、页眉页脚去重、连字符合并），不是版面还原；
  复杂表格和双栏排版可能丢失结构。
- 索引任务在 API 进程内执行，服务重启会中断并标记失败，需要手动“重新索引”；
  BullMQ worker 接入后会替换这一实现。

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

当前首个 migration 只创建 API 自身的 `api_metadata` 表，不读取或修改现有 Supabase schema。

## 当前边界

- 数据库、Redis 和对象存储目前只提供本地开发基础设施；数据库连接和 readiness 检查已接入，业务模块尚未接入。
- Better Auth、Argon2、BullMQ worker 和文件上传将在后续 Phase 1 子阶段接入。
- 生产环境仍由 Next.js + PM2 + Supabase 提供服务；不要直接把本地 Compose 配置用于生产。
