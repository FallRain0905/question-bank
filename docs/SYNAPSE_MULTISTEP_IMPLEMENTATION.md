# Synapse 多步执行框架实现方案

> 参考 Claude Code 的 **Plan → Execute → Verify → Iterate** 框架思路，把当前单轮 LangGraph 状态机升级为带「规划 / 执行 / 校验 / 重规划」闭环的多步 Agent。

## 0. 现状（已确认的代码锚点）

`lib/synapse-runtime.ts` 的当前图结构（第 2177-2192 行）：

```
START → load_context → decide_tools ──(有可执行工具)──▶ execute_tools → generate_answer → persist_turn → END
                                   └──(无可执行工具)──▶ generate_answer
```

关键事实：
- 状态定义 `SynapseGraphState`（第 1782-1815 行）：`decision`、`toolCalls`、`sources`、`readFiles`、`answer`、`pendingPlan`、`graphTrace` 等。
- `decideTools`（第 759 行）一次性产出 `decision.tools` 数组，之后没有「执行结果 → 重新决策」的回路。
- `executeSynapseGraphTools`（第 1975 行）只执行 `decision.tools` 中非 side-effect 的工具一次。
- `graphRouteAfterDecision`（第 1852 行）只按「有没有可执行工具」做一次路由，没有循环。
- 副作用工具（createDocument / convertDocument / downloadFile / downloadPaper / runTerminal）走 `confirmationPlan` 收集成 `pendingPlan`，等用户确认后再跑第二个图 `SynapseConfirmedDocumentState`。

**核心缺口**：执行结果不会回流到决策，没有「完成度判断」，也没有跨轮持久任务。这正是 Claude Code 已经具备的能力。

---

## 1. Claude Code 框架怎么映射到 Synapse

| Claude Code 环节 | Synapse 落地 |
|------------------|-------------|
| **Plan**（先拆任务，再动手） | 新增 `plan_tasks` 节点：LLM 把复杂目标拆成有序子目标（sub-goals），每个子目标对应一组工具调用 |
| **Execute**（逐步执行并观察） | 复用现有 `execute_tools`，但改成「一次执行一个子目标」，把结果写回 `observation` |
| **Verify**（校验是否完成 / 是否出错） | 新增 `evaluate_progress` 节点：LLM 判断「子目标达成？整体完成？需要换方案重试？」 |
| **Iterate**（根据校验结果继续 / 重规划） | 新增条件边：`继续执行` / `重新规划` / `结束`，带 `max_iterations` 硬上限防死循环 |

与 ReAct 的区别：不是每步都重新全量思考，而是「一次规划 + 按需重规划」，LLM 调用次数受控。

---

## 2. 状态扩展（`SynapseGraphState` 新增字段）

```typescript
// 在 SynapseGraphState（第 1782 行）中新增：
plan: Annotation<MultiStepPlan | null>,   // 多步计划，null 表示单轮/简单任务
task: Annotation<{
  currentStep: number;      // 当前子目标下标
  totalSteps: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'needs_confirmation';
  observation: string;      // 最近一步的执行结果摘要（feed-forward 给下一步）
  executed: Array<{ stepId: string; toolCalls: AgentToolCallLog[]; ok: boolean }>;
  replans: number;          // 已重规划次数（上限 2）
}>;
iteration: Annotation<number>;            // 全局循环次数（上限 6）
accumulatedSources: Annotation<ResearchSource[]>;  // 跨步累积的来源
accumulatedFiles: Annotation<any[]>;      // 跨步累积的文件
```

其中 `plan` / `task` / `iteration` 用「覆盖 reducer」（`(_left, right) => right`），`accumulatedSources` / `accumulatedFiles` 用「拼接 reducer」保留多步结果。

---

## 3. 新增节点

### 3.1 `plan_tasks`（规划）

触发条件：`decide_tools` 判定 `intent === 'research'` 或 `intent === 'write'` 且用户请求包含多子目标（如「检索 X 并生成报告」）。简单问答直接跳过，保持现状零成本。

```typescript
async function planSynapseTasks(state) {
  // 1 次 LLM 调用，产出子目标列表 + 每个子目标对应的工具
  const plan = await callSynapseLLM(llmConfig, [{
    role: 'system', content: MULTISTEP_PLANNING_PROMPT,  // 复用 decideTools 的 5 步结构化思路
    role: 'user', content: buildPlanPrompt(state.options.message, state.beforeContext),
  }], 900, agentSettings);
  // 解析 → { subGoals: [{id, title, description, tools:[SynapseToolDecision], critical:boolean}] }
  return { plan, task: { currentStep: 0, totalSteps: plan.subGoals.length, status: 'executing', observation: '', executed: [], replans: 0 } };
}
```

`MULTISTEP_PLANNING_PROMPT` 要点：产出有序 `subGoals`；每个 subGoal 给出具体工具与参数；标注哪些子目标「失败则整体失败」（critical）以便重规划判定。

### 3.2 `execute_step`（执行单步）

把现有 `executeSynapseGraphTools` 重构为「执行当前 `plan.subGoals[task.currentStep].tools`」，结果写入 `task.observation` + `task.executed`，来源/文件追加进 `accumulatedSources` / `accumulatedFiles`。副作用工具照旧进 `confirmationPlan`，一旦出现就把 `task.status` 设为 `needs_confirmation` 并打断循环。

### 3.3 `evaluate_progress`（校验）

```typescript
async function evaluateSynapseProgress(state) {
  // 1 次轻量 LLM 调用，输入：当前子目标、执行结果摘要、整体目标
  // 输出：{ done: boolean, replan: boolean, reason: string, nextHint?: string }
  // 规则兜底：
  //   - 全部子目标执行完 → done = true
  //   - 某 critical 子目标失败且 replans < 2 → replan = true
  //   - 无工具可执行 / 结果为空 → 按 heuristic 判断是否提前结束
}
```

### 3.4 条件路由 `routeAfterEvaluate`

```typescript
function routeAfterEvaluate(state) {
  if (state.task.status === 'needs_confirmation') return 'generate_answer';  // 停下来等确认
  if (state.iteration >= MAX_ITERATIONS) return 'generate_answer';          // 防死循环兜底
  if (state.eval?.replan && state.task.replans < MAX_REPLANS) return 'plan_tasks';
  if (!state.eval?.done && state.task.currentStep < state.task.totalSteps) return 'execute_step';
  return 'generate_answer';
}
```

---

## 4. 图接线（第 2177 行改造后）

```
START → load_context → decide_tools ─(复杂任务)─▶ plan_tasks → execute_step → evaluate_progress ─(继续)─┐
                            │                                                                        │
                            └──(简单/无工具)────────────────▶ generate_answer ◀──(结束/需确认)───────┘
                                                                        │
                                                              persist_turn → END
```

`evaluate_progress` 的三条出边：`execute_step`（继续）、`plan_tasks`（重规划）、`generate_answer`（结束）。`generate_answer` 的输入改为 `accumulatedSources` / `accumulatedFiles` / `task.executed`，让最终回答能引用多步产物。

---

## 5. 硬约束（防失控）

| 约束 | 值 | 作用 |
|------|-----|------|
| `MAX_ITERATIONS` | 6 | 全局循环上限，防止无限 loop |
| `MAX_REPLANS` | 2 | 重规划上限，避免反复推翻计划 |
| 单步工具数 | ≤ 4 | 复用现有 `.slice(0, 4)` |
| 总 LLM 决策调用 | 计划 1 + 校验 ≤ 5 | 成本可控，接近 Claude Code「按需调用」而非 ReAct 每步全量 |

---

## 6. 持久任务（Phase 3，先设计好 schema）

新增表 `agent_multi_step_tasks`，本轮即可把 `plan` + `task.executed` + `task.observation` 序列化落库：

```sql
CREATE TABLE agent_multi_step_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  status TEXT NOT NULL,          -- planning | executing | needs_confirmation | completed | failed
  plan JSONB NOT NULL,           -- { subGoals, totalSteps, currentStep }
  execution_history JSONB,       -- 每步 toolCalls + 结果摘要
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

这样后续「关闭对话后恢复任务」只需在 `load_context` 时查该表，把 `plan` / `execution_history` 回填进状态即可，无需重写执行逻辑。

---

## 7. 分步落地顺序

1. **状态 + 类型**：新增 `MultiStepPlan` 类型、扩展 `SynapseGraphState`（第 1782 行）。—— 低风险，纯加字段。
2. **`plan_tasks` + `evaluate_progress` 两个节点**：先做成「简单任务走原路径、复杂任务才进闭环」，保证回归安全。
3. **接线 + 路由**：改第 2177 行图定义，加 `routeAfterEvaluate`。
4. **`generate_answer` 多步感知**：用 `accumulatedSources` / `task.executed` 生成带完成度摘要的回答（已在本轮提示词优化中埋下「任务完成度评估」的钩子）。
5. **持久化**：`persist_turn` 时把 `plan` + `execution_history` 写入 `agent_multi_step_tasks`。
6. **前端进度**：复用 `emitSynapseEvent` 的 `node_start`/`node_done` 事件流，把 `task.currentStep/totalSteps` 透出为进度条。

---

## 8. 与已完成的提示词优化的衔接

本轮已完成 `decideTools`（第 776 行 5 步结构化推理）与 `generateAnswer`（第 1611-1612 行任务完成度 + 执行摘要）的提示词改造。这两处改造是 Phase 2 的**前置条件**：

- `decideTools` 的第 2 步「目标分解」直接复用到 `plan_tasks` 的规划提示词。
- `generateAnswer` 的「完成度评估」直接复用到 `evaluate_progress` 的校验提示词。

即：提示词层面已经把「拆目标 / 判完成」的语义能力建好了，多步框架只是把这套语义从「单轮 JSON」升级成「跨节点的循环控制」。
