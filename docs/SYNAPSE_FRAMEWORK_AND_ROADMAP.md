# Synapse Agent — 当前框架架构与优化路线图

> 本文档总结当前 Synapse Agent 的运行时框架，并列出针对「多步测试」与「持久任务」的可添加/可优化项。
> 核心代码在 `lib/synapse-runtime.ts`（约 2800 行，LangGraph 状态机）与 `scripts/synapse-run-worker.ts`（持久任务 worker）。

---

## 一、当前框架架构

### 1. 请求入口层

- `app/api/agent/chat/route.ts` — 统一 HTTP/SSE 入口。
  - 认证（Bearer token → `getAuthedClient`）。
  - 加载 LLM 配置与检索工具配置（`getUserLLMConfig` / `getUserResearchToolConfig`）。
  - 创建 `agent_runs` 记录（`createAgentRun`）。
  - 三分流：
    1. `background: true` → 状态 `queued`，立即返回 `{ type: 'queued', runId }`，交给 worker。
    2. `confirmedPlan` 存在 → `runConfirmedDocumentLangGraphTurn`（确认副作用操作）。
    3. 常规 → `runSynapseLangGraphTurn`。
  - SSE 路径用 `sseResponse` 封装，每 15s 心跳 `ping`，并把每个运行时事件流式转发给前端。
- `app/api/agent/runs/*` — 运行恢复 API：`GET /api/agent/runs`、`/runs/[id]`、`/runs/[id]/events?after=seq`，用于断线后回放。

### 2. 决策层（decide_tools）

`decideSynapseGraphTools` 用**单次 LLM 调用**把用户消息转成结构化决策 `SynapseDecision`：

```ts
{ intent: 'answer|research|read|write',
  responseStyle: 'concise|normal|detailed',
  needsConfirmation: boolean,
  tools: SynapseToolDecision[] }   // 最多 4 个，有序
```

- 8 种工具，分为两类：
  - **非副作用**（在循环内直接执行）：`researchSearch`、`readDocument`、`listSandboxFiles`。
  - **副作用**（需用户确认，走 `confirmationPlan`）：`convertDocument`、`createDocument`、`downloadFile`、`downloadPaper`、`runTerminal`。
- LLM 返回 JSON 解析失败时回退到 `heuristicDecision`（基于关键词/文件上下文）。

### 3. 规划/路由层（Plan-Execute-Replan）

- `shouldPlanMultiStep(decision)` 判定是否进入多步规划：
  - `intent ∈ {research, write}` 且 `tools.length ≥ 2` 且「第一个副作用工具之前存在非副作用工具」。
- `graphRouteAfterDecision(state)`：
  - `shouldPlanMultiStep` → `plan_tasks`；
  - 否则若有非副作用工具 → `execute_tools`；
  - 否则 → `generate_answer`。
- `planSynapseGraphTasks` — **确定性分解，不再额外调 LLM**：每个非副作用工具变成一个子目标 `MultiStepSubGoal`。
- 副作用工具统一走 `confirmationPlan` → `pendingPlan`，作为 `AgentPlan` 返回给前端，等用户确认后再走 `runConfirmedDocumentLangGraphTurn`。

### 4. 执行层（LangGraph 状态机）

`SynapseGraphState = Annotation.Root({...})`，节点链：

```
START → load_context → decide_tools ─┬→ plan_tasks → execute_step → evaluate_progress
                                     │                       └──────────┘ (循环，最多 MAX_ITERATIONS)
                                     ├→ execute_tools → generate_answer
                                     └→ generate_answer
generate_answer → persist_turn → END
```

- 硬安全上限：`MAX_ITERATIONS = 6`、`MAX_REPLANS = 2`。
- `executeSynapseGraphStep` 执行单个子目标；`evaluateSynapseGraphProgress` 评估进度并决定继续/结束。
- `broadenPlanStep` 失败重试：`researchSearch` 失败时改写为 `{ mode: 'both', depth: 'fast' }`。
- `persistSynapseGraphTurn` 写入 assistant 消息元数据（`multiStep.plan/task`、`graphTrace`、`decision`、`toolCalls`）。

### 5. 事件与持久化层

- `emitSynapseEvent` 是唯一事件出口：既回调 `onEvent`（SSE 用），又在 `runId` 存在时写 `agent_run_events`（worker/恢复用）。
- `lib/agent-run-service.ts`：`createAgentRun` / `updateAgentRun` / `appendAgentRunEvent`，带 `sanitizeJson`（截断超长、剔除非法 Unicode/代理对、深度上限 8）。
- `scripts/synapse-run-worker.ts`（`npm run synapse:worker`）：
  - 轮询 `agent_runs.status='queued'`（`ORDER BY created_at asc LIMIT BATCH_SIZE`，`BATCH_SIZE` 默认 1，clamp 1–5）。
  - `claimRun` 原子抢占：`update({status:'running', started_at}).eq('id').eq('status','queued')`，避免并发重复消费。
  - 加载用户级 LLM/工具配置，按 `input.confirmedPlan` 走确认路径或常规路径，传 `runId`。
  - 结束更新 `status='completed'`/`'failed'` 与 `output`。

### 6. 记忆/上下文层

- 对话摘要记忆（`memorySummary`）+ 结构化长期记忆（`memoryContext.contextText`）+ 用户工作区文件上下文，注入决策 prompt。

---

## 二、可添加 / 可优化项

### A. 多步测试（当前是最大空白：**没有任何测试基础设施**）

现状：项目没有 vitest/jest/mocha，`package.json` 无 test 脚本，仓库内 0 个测试文件。`synapse-runtime.ts` 中规划/路由/重试等**纯逻辑函数**全部内嵌在依赖 LLM + Supabase 的巨型文件里，无法隔离测试。

> ✅ **P0 已落地（commit `8cb7736`）**：引入 vitest v4 + 抽取纯函数到 `lib/synapse-planning.ts`（打破 planning↔runtime 循环依赖）+ `lib/synapse-sanitize.ts`（叶子模块，解除 sanitize 循环引用）+ 路由/规划不变量测试 `lib/synapse-planning.test.ts`（35 个用例）。`npx vitest run` 全绿，`npx tsc --noEmit` 通过。

1. ✅ **引入 vitest**（与 TS + LangGraph 生态最契合），加 `"test": "vitest run"`。
2. ✅ **抽取纯函数为可测模块**（不改行为，只搬家）：
   - `isSideEffectTool`、`shouldPlanMultiStep`、`graphRouteAfterDecision`、`planSynapseGraphTasks`（核心 `buildMultiStepPlan`）、`confirmationPlan`、`broadenPlanStep`、`routeAfterEvaluate`、`parseJsonObject`、`heuristicDecision`。
   - 抽到 `lib/synapse-planning.ts`，原文件 re-export，保持行为不变。
3. ✅ **路由/规划不变量测试**（无需网络）：
   - tools 数量 ≤ 4；
   - 非副作用工具必在副作用工具之前；
   - 仅含副作用工具 → `confirmationPlan != null` 且 `shouldPlanMultiStep == false`；
   - `intent=research + ≥2 工具 + 副作用前有非副作用` → `shouldPlanMultiStep == true`。
4. ✅ **重试不变量测试**：`broadenPlanStep` 只作用于 `researchSearch`，且不会超过 `MAX_REPLANS`；`routeAfterEvaluate` 在 `iteration ≥ MAX_ITERATIONS` 时强制返回 `generate_answer`。
5. ⬜ **决策器单元测试**：mock `callSynapseLLM`，对一批「中文指令 → 期望决策」用例断言（例如「检索 X 然后写报告」→ intent=research + 有序 tools，researchSearch 在 createDocument 前；「下载这篇论文」→ downloadPaper 且 needsConfirmation）。
6. ⬜ **prompt 金样（golden）测试**：对系统 prompt 模板做快照，防止改动悄悄破坏工具路由规则。
7. ⬜ **图级冒烟测试**：用 LangGraph 的 stub 节点 / mock model 跑一遍 `START→END`，断言状态机不抛异常、`MAX_ITERATIONS` 兜底生效。

### B. 持久任务（worker 正确性已在，缺生产化）

现状：worker 的事件链路已正确（`emitSynapseEvent` 在有 `runId` 时写 `agent_run_events`，worker 传了 `runId`），原子抢占也正确。主要缺口：

> ✅ **P0 已落地（本会话，未提交）**：`ecosystem.config.js` 已注册 `synapse-run-worker` PM2 app（默认启用），worker 已加卡死 run 回收器（`reclaimStuckRuns`）。

1. ✅ **生产启用 worker**：`ecosystem.config.js` 已注册 `synapse-run-worker`（`instances:1`，`autorestart`），`SYNAPSE_RUN_WORKER_POLL_MS/BATCH_SIZE` 环境变量可配。
2. ✅ **卡死 run 回收器（reaper）**：`lib/agent-run-service.ts` 新增 `reclaimStuckRuns`，worker 周期性清扫 `started_at` 超时（`SYNAPSE_RUN_WORKER_REAP_AFTER_MS`，默认 30min）的 `running` 记录并置 `failed`。
3. ⬜ **租约/心跳**：为长任务定期更新 `updated_at` 或写心跳事件，便于 UI 判断「还在跑」vs「已死」。
4. ⬜ **取消机制**：类型里已有 `cancelled`，但没有取消 API。加 `POST /api/agent/runs/[id]/cancel`，worker 在每步前后检查取消标志。
5. ⬜ **轮询退避**：空闲时固定 3000ms 轮询，可加指数退避 + 抖动，空队列时降到 10–30s。
6. ⬜ **并发上限与跨进程协调**：`BATCH_SIZE` 已 clamp 1–5，但单进程串行；原子 claim 已保证多 worker 安全，可直接多开实例扩容。
7. ⬜ **失败重试策略**：`failed` 后目前无重试；可加 `max_retries` + 退避，或至少把「瞬时错误 vs 业务错误」分开（瞬时错误自动重新入队）。

### C. 多步执行本身的优化（架构层）

1. **把 `planSynapseGraphTasks` 的确定性分解升级为可选 LLM 精修**：当前纯规则拆解不消耗 token，但对「A 的结果决定 B 的入参」这种依赖无法表达；可加一个仅在「工具间存在数据依赖」时触发的轻量精修调用。
2. **子目标间数据流显式化**：目前 `accumulatedSources`/`accumulatedFiles` 用 concat reducer 隐式传递，下游子目标取数靠全局 state；可给 `MultiStepSubGoal` 加显式 `dependsOn`/`consumes`，便于评估节点判断「前置是否满足」。
3. **评估节点强化**：`evaluateSynapseGraphProgress` 目前以迭代计数为主；可引入「子目标完成度」信号（检索结果非空、文档已生成等）作为重试/继续的判据，而非只靠次数。
4. **trace 可观测性**：`graphTrace` 已记录，但未结构化导出；可落成 `agent_run_events` 的 `graph_*` 事件，供 UI 画执行时序图。

### D. 其它

1. `database.types.ts` 已修复 `GenericSchema`/`GenericTable` 结构（本次 bug 修复），但仍是手写占位；建议接入 `supabase gen types` 自动生成，避免 schema 漂移再引发 `never[]` 类错误。
2. `class_members.status/message` 的幂等迁移 `supabase/fix_class_members_status.sql` 应纳入正式迁移脚本列表，而非散落。
3. 决策 prompt 里 `shouldPlanMultiStep` 的阈值（`intent∈{research,write} && ≥2 工具`）是魔法数字，建议提为常量并注释业务含义。

---

## 三、落地优先级建议

1. ✅ **P0（已完成）**：引入 vitest + 抽取纯函数 + 路由/规划不变量测试 —— 直接补上「多步测试」空白，且不改任何行为。
2. ✅ **P0（已完成）**：持久任务生产化 —— worker 已注册进 `ecosystem.config.js`，并加卡死 run 回收器。
3. **P1**：取消机制 + 心跳/租约 + 轮询退避。
4. **P2**：子目标依赖显式化、评估节点强化、LLM 可选精修。
