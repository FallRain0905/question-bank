# Synapse Agent Runs and Sandbox Worker

## Persistent Runs

Apply the migration before deploying the updated agent runtime:

```sql
-- Supabase SQL editor
\i supabase/migration_agent_runs.sql
```

The runtime writes every streamed node/tool/token event into:

- `agent_runs`
- `agent_run_events`

Useful APIs:

- `GET /api/agent/runs?conversation_id=...`
- `GET /api/agent/runs/[id]`
- `GET /api/agent/runs/[id]/events?after=0`

This lets the UI recover a run after a broken HTTP/SSE connection.

`POST /api/agent/chat` also accepts:

```json
{
  "message": "task",
  "background": true
}
```

When `background` is true, the API creates an `agent_runs` row with `status='queued'` and returns immediately. A worker can then claim and execute it.

## Optional Run Worker

The first worker entry point is:

```bash
npm run synapse:worker
```

It polls:

```sql
agent_runs.status = 'queued'
```

and executes the run with the same LangGraph runtime used by `/api/agent/chat`.
The worker uses `run.user_id` to load the user's LLM and research-tool settings through the service role client, so queued jobs do not fall back to system defaults unless the user has no override.

This is now enabled by default in `ecosystem.config.js` as the `synapse-run-worker` PM2 app. The current UI still runs chat requests through HTTP/SSE, while the worker provides the execution boundary needed for the next step:

```text
UI creates queued run -> worker claims run -> worker writes agent_run_events -> UI subscribes/polls events
```

The agent page can replay persisted events from:

```bash
GET /api/agent/runs/:id/events?after=<sequence>
```

and then reload the conversation when the run is completed. This is the recovery path for broken SSE connections.

The worker is registered in `ecosystem.config.js` as:

```js
{
  name: 'synapse-run-worker',
  script: './node_modules/.bin/tsx',
  args: 'scripts/synapse-run-worker.ts',
  cwd: rootDir,
  env: {
    NODE_ENV: 'production',
    SYNAPSE_RUN_WORKER_POLL_MS: '3000',
    SYNAPSE_RUN_WORKER_BATCH_SIZE: '1',
    SYNAPSE_RUN_WORKER_REAP_INTERVAL_MS: '60000',
    SYNAPSE_RUN_WORKER_REAP_AFTER_MS: '1800000'
  },
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: '700M'
}
```

### Stuck-run reaper

The worker periodically reclaims `running` runs that outlived their threshold. If a worker (or the Next.js process handling a synchronous run) crashes mid-execution, the run is left `status='running'` forever; the reaper sweeps for `status='running'` rows whose `started_at` is older than `SYNAPSE_RUN_WORKER_REAP_AFTER_MS` (default 30 min) and marks them `failed` with a clear error.

- `SYNAPSE_RUN_WORKER_REAP_INTERVAL_MS` — how often to sweep (default 60s).
- `SYNAPSE_RUN_WORKER_REAP_AFTER_MS` — a `running` run is failed once it is older than this (default 30 min).

Heartbeats (updating `updated_at` mid-run) are a later improvement; until then `started_at` is the "last known alive" signal, so very long-running-but-alive tasks should keep the default threshold in mind.

## Docker Permission Fix

If sandbox commands fail with:

```text
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

the PM2 user cannot access the host Docker daemon. Fix it on the server:

```bash
sudo usermod -aG docker deploy
exit
```

Reconnect over SSH, then verify and restart PM2 from the new login session:

```bash
docker ps
cd /home/deploy/synap
pm2 kill
pm2 resurrect
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

If `docker ps` works in SSH but Synapse still fails, the old PM2 daemon still has the old Linux groups. `pm2 kill` is the important step.

## Sandbox Worker Boundary

By default Synapse still runs the Docker sandbox from the Next.js process. To move command execution into a separate worker service, set:

```bash
SYNAPSE_SANDBOX_WORKER_URL=http://127.0.0.1:8010
SYNAPSE_SANDBOX_WORKER_TOKEN=change-me
```

When `SYNAPSE_SANDBOX_WORKER_URL` is set, Next.js sends:

```http
POST /run
Authorization: Bearer <SYNAPSE_SANDBOX_WORKER_TOKEN>
Content-Type: application/json
```

Payload:

```json
{
  "userId": "uuid",
  "command": "ls -la",
  "cwd": ".",
  "timeoutMs": 20000,
  "workspaceRoot": "/srv/synap-agent/workspaces/u_<user-hash>"
}
```

Expected response:

```json
{
  "command": "ls -la",
  "cwd": ".",
  "runtime": "docker",
  "containerName": "synapse-sandbox-...",
  "exitCode": 0,
  "timedOut": false,
  "stdout": "...",
  "stderr": "",
  "durationMs": 1234
}
```

Next step: implement the worker as a small Node/Fastify or Python/FastAPI service that consumes the same command policy and writes artifacts/stdout/stderr into the user workspace.
