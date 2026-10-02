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
