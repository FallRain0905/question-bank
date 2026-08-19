# SynapFlow 服务器部署指南

> 基于现有 PM2 配置（`ecosystem.config.js` + `PM2.md`）整理的完整部署文档。
> 目标环境：Ubuntu / Debian，Node 20，PM2 进程管理，Nginx 反向代理。

## 一、架构总览

本项目由多个进程组成，其中只有 Next.js 主应用和 Supabase 是必需的，其余均为可选组件。

| 组件 | 作用 | 端口 | 是否必需 |
|------|------|------|----------|
| `question-bank` | Next.js 主应用（页面 + API） | 3000 | ✅ 必需 |
| `synapse-run-worker` | Synapse Agent 后台 worker | — | ⚠️ 用到 Agent 功能时需要 |
| `arxiv-cron` | 论文抓取定时任务（每天 9:00） | — | ⚠️ 要论文推送时需要 |
| `crawl-service` | Python 网页正文抓取 sidecar | 8002 | ⚠️ 要研究搜索时需要 |
| `hyper-rag-service` | Python 超图 RAG 服务 | 8001 | ⚠️ 要知识库问答时需要 |
| `synapse-sandbox` | Docker 沙箱镜像（Agent 执行命令用） | — | ⚠️ 要 Agent 终端时需要 |
| Supabase | 数据库 + Auth + Storage | 云端 | ✅ 必需（托管，不自建） |

**最小部署 = Supabase（托管）+ Next.js 主应用**，其余组件按需启用。

---

## 二、环境准备

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git python3 python3-venv python3-pip

# PM2
sudo npm i -g pm2

# Docker（可选，仅 Synapse Agent 沙箱需要）
curl -fsSL https://get.docker.com | sudo sh
```

---

## 三、拉取代码与安装依赖

```bash
sudo mkdir -p /home/deploy && sudo chown $USER /home/deploy
cd /home/deploy
git clone <你的仓库地址> synap
cd synap
npm ci          # 使用 lock 文件安装，比 npm install 更可复现
```

---

## 四、配置环境变量

```bash
cd /home/deploy/synap
cp .env.local.example .env.local
vim .env.local
```

关键变量（完整清单见 `.env.local.example`）：

```env
# Supabase（必需）
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx     # 服务端角色密钥，论文抓取脚本用

# AI 模型密钥（按实际使用的服务商填一个或多个）
DEEPSEEK_API_KEY=sk-xxx
# QWEN_API_KEY=xxx
# KIMI_API_KEY=xxx

# Python sidecar（按需）
HYPERRAG_SERVICE_URL=http://localhost:8001
CRAWL_SERVICE_URL=http://localhost:8002

# 文档转换（按需）
MINERU_API_TOKEN=xxx
```

> ⚠️ 注意：
> - `NEXT_PUBLIC_*` 会在构建时打进前端包，**修改后必须重新 `npm run build`** 才生效。
> - 纯服务端变量（无 `NEXT_PUBLIC_` 前缀）修改后 `pm2 restart` 即可。

---

## 五、初始化数据库（Supabase）

1. 在 [supabase.com](https://supabase.com) 创建项目（免费档即可起步）。
2. 打开 **SQL Editor**，按顺序执行 `supabase/` 下的 SQL 脚本：
   - 先执行 `schema.sql`（基础表结构）
   - 再执行各 `migration_*.sql`（按需，含复习模块 `migration_review_schedule.sql`）
3. 复制项目的 `Project URL`、`anon key`、`service_role key` 填入 `.env.local`。

---

## 六、构建与启动

### 1. 构建主应用

```bash
cd /home/deploy/synap
npm run build
```

### 2. 安装 Python sidecar 依赖（按需）

```bash
# crawl-service
cd crawl-service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cd ..

# hyper-rag-service
cd hyper-rag-service
pip install -r requirements.txt
cd ..
```

### 3. 构建 Synapse 沙箱镜像（按需）

```bash
docker build -t synapse-sandbox:latest docker/synapse-sandbox
```

### 4. 启动进程

```bash
pm2 start ecosystem.config.js
pm2 save          # 保存进程列表
pm2 startup       # 生成开机自启命令，复制并执行它输出的命令
```

---

## 七、Nginx 反向代理与 HTTPS

Next.js 通过 `next start` 跑在 3000 端口，前面套一层 Nginx 做域名 + HTTPS。

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Nginx 配置（`/etc/nginx/sites-available/synap`）：

```nginx
server {
    listen 80;
    server_name 你的域名.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;   # 上传文档需要
    }
}
```

启用并签发证书：

```bash
sudo ln -s /etc/nginx/sites-available/synap /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 你的域名.com
```

> ⚠️ 加域名后，务必在 Supabase 控制台 **Authentication → URL Configuration → Site URL + Redirect URLs** 中加入该域名，否则登录回调会失败。

---

## 八、日常运维

```bash
pm2 status                 # 查看所有进程状态
pm2 logs question-bank     # 查看主应用日志
pm2 monit                  # 实时监控面板
pm2 show question-bank     # 查看单进程详情
```

更新代码：

```bash
cd /home/deploy/synap
git pull
npm ci
npm run build
pm2 restart question-bank
```

---

## 九、常见问题

| 症状 | 原因与解决 |
|------|-----------|
| 改完 `.env.local` 不生效 | `NEXT_PUBLIC_*` 必须重新 `npm run build`；纯服务端变量重启进程即可 |
| 登录 / 上传报错 | Supabase 的 Site URL / Redirect URLs 未配域名，或 Storage bucket 的 RLS 策略未建 |
| 内存不足反复重启 | `ecosystem.config.js` 已配 `max_memory_restart`；2GB 小机器保持 `crawl-service` 的 `CRAWL_ENABLE_BROWSER=0`（默认已关） |
| Agent 终端报沙箱错误 | 未构建 `synapse-sandbox:latest` 镜像，或将部署用户加入 `docker` 组 |
| 论文未推送 | `arxiv-cron` 是 PM2 定时任务（每天 9:00），确认 `pm2 status` 中在运行，且 `SUPABASE_SERVICE_ROLE_KEY` 配对了 |
