# Synapse Agent 架构分析与优化方案

## 目录

1. [当前架构分析](#当前架构分析)
2. [与传统 Agent 对比](#与传统-agent-对比)
3. [核心问题与优化方向](#核心问题与优化方向)
4. [提示词优化方案](#提示词优化方案)
5. [LLM 决策优化](#llm-决策优化)
6. [持续多步流程实现](#持续多步流程实现)
7. [持久任务规划与执行](#持久任务规划与执行)
8. [实施路线图](#实施路线图)

---

## 当前架构分析

### 1.1 核心组件

```typescript
// 当前架构：LangGraph 状态机驱动的单轮对话 Agent
┌─────────────────────────────────────────────────┐
│          Synapse Agent (LangGraph)              │
├─────────────────────────────────────────────────┤
│  START                                          │
│    ↓                                            │
│  load_context     ← 加载会话历史 + 文件 + 记忆  │
│    ↓                                            │
│  decide_tools     ← LLM 决策工具调用            │
│    ↓                                            │
│  execute_tools    ← 并发执行（researchSearch）  │
│    ↓                                            │
│  generate_answer  ← 生成最终回答                │
│    ↓                                            │
│  persist_turn     ← 保存消息 + 提取记忆         │
│    ↓                                            │
│  END                                            │
└─────────────────────────────────────────────────┘
```

**关键特征**：
- ✅ **单轮对话优化**：每次用户输入 → 一次工具调用 → 一次回答
- ✅ **副作用确认机制**：`createDocument`/`downloadFile`/`runTerminal` 需要用户确认
- ✅ **两层记忆系统**：会话压缩（短期）+ 结构化检索（长期）
- ⚠️ **无多步规划**：没有 "分析任务 → 拆分子任务 → 逐步执行 → 迭代优化" 的能力
- ⚠️ **工具决策简单**：启发式正则 + LLM 一次性决策，无动态调整

### 1.2 工具决策流程

```typescript
// 当前双层决策机制
async function decideTools(message, context, llmConfig) {
  // 第 1 层：启发式快速匹配（正则表达式）
  const heuristic = heuristicDecision(message, context.files);
  
  // 第 2 层：LLM 决策（单次调用）
  const llm = await callSynapseLLM(llmConfig, [
    { role: 'system', content: DECISION_SYSTEM_PROMPT },
    { role: 'user', content: buildDecisionPrompt(message, context) }
  ]);
  
  // 回退到启发式
  if (!isValidJSON(llm.content)) return heuristic;
  
  return parseDecision(llm.content);
}
```

**问题**：
1. **无反馈循环**：工具执行结果不会影响后续决策
2. **无错误恢复**：工具失败后无法重新规划
3. **无目标追踪**：缺少 "当前任务完成度" 的显式判断

---

## 与传统 Agent 对比

### 2.1 ReAct Agent（传统范式）

```
┌─────────────────────────────────────────┐
│  ReAct Loop (Reason + Act)              │
├─────────────────────────────────────────┤
│  while not done:                        │
│    1. Thought: 分析当前状态和下一步      │
│    2. Action: 选择工具并执行             │
│    3. Observation: 观察工具输出          │
│    4. 判断是否完成目标                    │
│       - 是 → 返回 Final Answer         │
│       - 否 → 继续循环                   │
└─────────────────────────────────────────┘
```

**核心特征**：
- ✅ **多步推理**：每次循环都重新思考下一步
- ✅ **错误恢复**：工具失败后可以换方案
- ✅ **目标导向**：显式判断 "任务是否完成"
- ❌ **效率低**：每步都调用 LLM，成本高
- ❌ **容易陷入循环**：需要显式的 max_iterations 限制

### 2.2 Plan-and-Execute Agent

```
┌─────────────────────────────────────────┐
│  Plan-and-Execute                       │
├─────────────────────────────────────────┤
│  1. Plan: 分解任务为子步骤              │
│     └─> [Step1, Step2, Step3, ...]     │
│  2. Execute: 逐步执行                   │
│     ├─> Step1 → 观察结果                │
│     ├─> Step2 → 观察结果                │
│     └─> Step3 → 观察结果                │
│  3. Replan: 根据执行结果调整计划         │
│  4. Final Answer                        │
└─────────────────────────────────────────┘
```

**核心特征**：
- ✅ **计划先行**：减少 LLM 调用次数
- ✅ **可回溯**：执行失败时可以重新规划
- ✅ **结构化**：适合复杂多步任务
- ❌ **初始计划可能不准确**：需要动态调整能力

### 2.3 Synapse Agent（当前）

```
┌─────────────────────────────────────────┐
│  Synapse (单轮对话 + 确认机制)          │
├─────────────────────────────────────────┤
│  1. 用户输入                            │
│  2. 决策工具（一次性）                   │
│  3. 执行工具（并发）                     │
│  4. 生成回答                            │
│  5. END                                 │
└─────────────────────────────────────────┘
```

**对比总结**：

| 维度 | ReAct | Plan-and-Execute | Synapse（当前） | Claude Code |
|------|-------|------------------|----------------|-------------|
| **多步推理** | ✅ 每步重新思考 | ✅ 初始计划 + 动态调整 | ❌ 单轮决策 | ✅ 持续任务规划 |
| **错误恢复** | ✅ 自动重试 | ✅ Replan | ❌ 无 | ✅ 诊断后重试 |
| **效率** | ❌ 低（频繁调用 LLM） | ✅ 中（分阶段调用） | ✅ 高（单次调用） | ✅ 高（按需调用） |
| **任务复杂度** | 中等 | ✅ 高 | ❌ 低（简单问答） | ✅ 极高 |
| **目标追踪** | ✅ 显式判断 | ✅ 步骤完成度 | ❌ 无 | ✅ 任务完成验证 |
| **持久化** | ❌ 会话内 | ❌ 会话内 | ✅ 跨会话记忆 | ✅ 项目级持久化 |

**结论**：
- **Synapse 当前定位**：快速单轮对话 Agent，适合简单检索 + 文档生成
- **缺失能力**：多步规划、错误恢复、持续任务执行（类似 Claude Code）

---

## 核心问题与优化方向

### 3.1 当前存在的问题

#### **问题 1：无法处理复杂多步任务**

**场景**：
```
用户："分析 RAG 技术栈的演进，包括：
1. 检索 2020-2024 年的核心论文
2. 按时间线整理技术发展
3. 对比主流方案（Naive RAG vs Advanced RAG）
4. 生成一份详细报告"
```

**当前表现**：
- ✅ 能调用 `researchSearch` 检索论文
- ✅ 能调用 `createDocument` 生成报告
- ❌ **无法分步执行**：无法先检索 → 分析 → 对比 → 再生成
- ❌ **无法验证中间结果**：检索是否完整？分析是否准确？

#### **问题 2：工具决策过于简单**

**当前决策逻辑**：
```typescript
// 启发式：正则匹配关键词
const wantsSearch = /检索|搜索|联网/.test(message);
const wantsRead = /文件|文档/.test(message) && files.length > 0;

// LLM 决策：单次调用返回工具列表
const decision = await decideTools(message, context);
// → { intent, tools: [{tool, args}], needsConfirmation }
```

**问题**：
- ❌ **无动态调整**：工具执行后无法根据结果选择下一步工具
- ❌ **无条件分支**：无法实现 "如果检索结果少于 5 篇 → 换查询词重试"
- ❌ **无目标判断**：无法显式检查 "任务是否完成"

#### **问题 3：提示词缺少结构化推理引导**

**当前 System Prompt**（`decideTools` 函数）：
```typescript
const system = `You are Synapse, the main agent controller for Synap.
Your job is to decide whether the next assistant reply should answer directly or call tools first.
Return strict JSON only. Do not write prose outside JSON.

Available tools:
- researchSearch: ...
- readDocument: ...
- createDocument: ...

Routing rules:
- Normal questions should use no tools.
- Use researchSearch only when...
- Use createDocument only when...
```

**问题