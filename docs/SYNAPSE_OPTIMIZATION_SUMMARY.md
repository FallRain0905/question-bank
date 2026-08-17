# Synapse Agent 优化方案总结

## 📋 当前架构评估

### ✅ 当前优势

| 特性 | 实现 | 评价 |
|------|------|------|
| **单轮对话优化** | LangGraph 状态机 | ⭐⭐⭐⭐⭐ 响应快，成本低 |
| **副作用确认** | `needsConfirmation` 机制 | ⭐⭐⭐⭐⭐ 安全可控 |
| **两层记忆** | 会话压缩 + 结构化检索 | ⭐⭐⭐⭐ 跨会话上下文保持 |
| **工具决策** | 启发式 + LLM 双层 | ⭐⭐⭐ 有兜底，但不够智能 |

### ❌ 当前不足

| 问题 | 影响 | 优先级 |
|------|------|--------|
| **无多步规划** | 无法处理 "检索 → 分析 → 生成报告" 类任务 | 🔴 高 |
| **无错误恢复** | 检索失败 → 直接终止，无重试 | 🔴 高 |
| **无目标追踪** | 缺少 "任务完成度" 显式判断 | 🟡 中 |
| **无持久任务** | 关闭对话 → 任务丢失，无法恢复 | 🟡 中 |
| **工具决策简单** | 无动态调整，无条件分支 | 🟡 中 |

---

## 🎯 与传统 Agent 对比

### Synapse（当前）vs ReAct vs Claude Code

```
┌─────────────────────────────────────────────────────────────┐
│  架构对比                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Synapse (当前)                                             │
│  ┌────────────────────────────────────────┐                │
│  │ 用户输入 → 决策（1次） → 执行 → 回答 │                │
│  └────────────────────────────────────────┘                │
│  特点：快速、低成本、单轮优化                                │
│  缺点：无多步推理、无错误恢复                                │
│                                                             │
│  ReAct Agent                                                │
│  ┌────────────────────────────────────────┐                │
│  │ while not done:                        │                │
│  │   Thought → Action → Observation       │                │
│  │   判断完成？→ 是：返回 / 否：继续     │                │
│  └────────────────────────────────────────┘                │
│  特点：多步推理、自动重试                                    │
│  缺点：LLM 调用频繁、成本高                                  │
│                                                             │
│  Claude Code (参照标准)                                     │
│  ┌────────────────────────────────────────┐                │
│  │ Plan → Execute → Verify → Iterate     │                │
│  │ + 持久任务上下文 + 跨会话恢复          │                │
│  └────────────────────────────────────────┘                │
│  特点：计划先行、可验证、可恢复                              │
│  缺点：实现复杂度高                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**结论**：Synapse 当前定位是 **快速单轮对话 Agent**，适合简单检索 + 文档生成。要支持复杂多步任务，需要引入 **Plan-Execute-Replan** 架构。

---

## 🔧 优化方案（分阶段）

### Phase 1：提示词优化（1-2 周，零代码改动）

**目标**：通过优化 Prompt，提升决策质量和回答结构

#### 1.1 决策层提示词重构

**当前问题**：
```typescript
// 当前 Prompt：平铺直叙，无结构化推理
const system = `You are Synapse. Decide tools or answer directly.
Return JSON: {intent, tools: [...]}`;
```

**优化方案**：
```typescript
// 新 Prompt：5 步结构化推理
const DECISION_PROMPT_V2 = `
# Decision Process (Think Step by Step)

## Step 1: Task Analysis
- Intent: question / research / document / multi-step?
- Complexity: simple / medium / complex?
- Resources: files? memory? recent sources?

## Step 2: Goal Decomposition (for complex tasks)
- Break into sub-goals
- Example: "analyze X + create report"
  → Goal 1: Research X
  → Goal 2: Create document

## Step 3: Tool Selection
- researchSearch: mode (academic/general/both), depth (fast/medium/deep)
- readDocument: when files uploaded
- createDocument: when generating structured output

## Step 4: Execution Order
- Sequential: [Search] → [Download] → [Create report]
- Parallel: [Search academic] + [Search web]
- Conditional: if results < 5 → retry with broader query

## Step 5: Output JSON
{
  "reasoning": {
    "intent": "...",
    "subGoals": ["..."],
    "toolStrategy": "..."
  },
  "decision": {
    "intent": "research",
    "tools": [...]
  }
}
`;
```

**预期效果**：
- ✅ 复杂任务自动分解为子目标
- ✅ 工具选择更精准（mode/depth 更合理）
- ✅ 显式推理过程，便于调试

#### 1.2 回答生成层提示词重构

**当前问题**：
```typescript
// 无任务完成度判断，缺失信息不提示
const answer = await generateAnswer(message, results);
// → 直接生成回答，不评估完成度
```

**优化方案**：
```typescript
// 新 Prompt：任务完成度评估
const ANSWER_PROMPT_V2 = `
# Answer Generation with Completion Check

## Step 1: Evaluate Task Completion
- ✅ Complete: All goals achieved, sufficient sources
- ⚠️ Partial: Some goals met, but gaps exist
- ❌ Failed: No useful results

## Step 2: Answer Structure
- Complete → Direct answer + citations
- Partial → What worked + What's missing + Suggestions
- Failed → Root cause + Fallback + Action plan

## Step 3: Meta-Information
Append at end:
---
**执行摘要**：
- 调用工具：researchSearch (学术检索，深度)
- 来源数量：12 篇论文
- 完成度：✅ 完全达成 / ⚠️ 部分达成 / ❌ 未达成
- 建议：[if partial/failed, next steps]
`;
```

**预期效果**：
- ✅ 用户清楚知道任务完成情况
- ✅ 缺失信息显式说明（"仅找到 3 篇论文，建议扩大检索范围"）
- ✅ 失败时给出明确的修复建议

**实施步骤**：
1. 修改 `lib/synapse-runtime.ts` 中的 `decideTools` 函数的 `system` prompt
2. 修改 `generateAnswer` 函数的 prompt
3. A/B 测试对比效果

**成本**：0 代码改动，仅 Prompt 调整

---

### Phase 2：多步执行框架（2-3 周）

**目标**：支持 "检索 → 分析 → 生成报告" 类多步任务

#### 2.1 架构设计

```typescript
// 新增：Multi-Step Execution State
type MultiStepState = {
  currentStep: number;
  totalSteps: number;
  subGoals: StepDefinition[];
  executedSteps: StepResult[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
};

// 核心函数
async function runMultiStepTask(options: {
  message: string;
  userId: string;
  conversationId: string;
  llmConfig: LLMConfig;
  toolConfig: ToolConfig;
}) {
  // Step 1: Planning
  const plan = await planTask(options.message);
  // → { subGoals: [Step1, Step2, Step3], totalSteps: 3 }
  
  // Step 2: Execute Loop
  for (const step of plan.subGoals) {
    const result = await executeStep(step, options);
    
    // Step 3: Evaluate & Replan
    if (result.status === 'failed' && step.critical) {
      const newPlan = await replanTask(plan, executedSteps);
      plan.subGoals = newPlan.subGoals;
    }
  }
  
  // Step 4: Final Answer
  return await generateFinalAnswer(plan, executedSteps);
}
```

#### 2.2 数据库扩展

```sql
-- 新增：多步任务状态表
CREATE TABLE agent_multi_step_tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  status TEXT NOT NULL, -- 'planning' | 'executing' | 'completed' | 'failed'
  plan JSONB NOT NULL, -- { subGoals, totalSteps, currentStep }
  execution_history JSONB[], -- 每步的执行记录
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2.3 用户交互示例

```
用户："分析 RAG 技术栈演进并生成报告"

Synapse:
检测到多步任务，已生成执行计划：

**任务分解**：
1. ✅ 学术检索：检索 2020-2024 RAG 论文
2. ⏳ 分析演进：提取技术演进时间线
3. ⏳ 对比方案：Naive vs Advanced RAG
4. ⏳ 生成报告：整合为结构化文档

预计耗时：5-8 分钟
是否开始执行？[确认] [修改计划]

---

[用户确认后]

Synapse:
[1/4] 正在执行学术检索...
✓ 找到 67 篇论文（2020-2024）

[2/4] 正在分析演进...
✓ 已生成技术时间线

[3/4] 正在对比方案...
✓ 已提取三种范式差异

[4/4] 正在生成报告...
✓ 报告已生成

**完成摘要**：
- 状态：✅ 全部完成（4/4 步）
- 输出：1 份报告（8,200 字），67 篇引用
- 下载：[Markdown] [DOCX]
```

**实施步骤**：
1. 实现 `planTask` 函数（调用 LLM 生成计划）
2. 实现 `executeStep` 函数（执行单步，复用现有工具）
3. 实现 `replanTask` 函数（失败时重新规划）
4. 添加数据库表 `agent_multi_step_tasks`
5. 前端支持进度显示

**成本**：约 500 行新代码 + 数据库迁移

---

### Phase 3：持久任务支持（3-4 周）

**目标**：像 Claude Code 一样，支持跨会话的持久任务

#### 3.1 核心特性

| 特性 | 说明 | 实现方式 |
|------|------|---------|
| **任务恢复** | 关闭对话后，下次可继续执行 | 持久化任务状态到 DB |
| **进度追踪** | 显示 "已完成 3/5 步" | 在 `agent_persistent_tasks` 表记录 |
| **阻塞提醒** | "第 3 步需要你上传文件 X" | 记录 `blockers` 字段 |
| **任务摘要** | "你有 2 个进行中的任务" | 列表页展示所有任务 |

#### 3.2 数据库设计

```sql
CREATE TABLE agent_persistent_tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  task_title TEXT NOT NULL,
  task_description TEXT,
  status TEXT NOT NULL, -- 'active' | 'paused' | 'completed' | 'archived'
  
  -- 任务上下文
  context JSONB NOT NULL, -- { goal, resources, constraints }
  
  -- 执行状态
  execution_state JSONB NOT NULL, -- { currentPhase, completedSteps, pendingSteps, blockers }
  
  -- 关联会话
  conversation_ids UUID[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

#### 3.3 用户交互示例

```
// 第一天
用户："深度分析 RAG 技术栈并生成报告"

Synapse:
已创建持久任务 #T-001
计划：检索 → 分析 → 生成报告
预计 5-8 分钟，是否开始？[确认]

[用户确认，执行到第 2 步后关闭对话]

---

// 第二天（新会话）
用户："昨天的任务进度如何？"

Synapse:
检测到进行中的任务 #T-001

**任务：RAG 技术栈深度分析**
- 状态：⏸️ 暂停（已完成 2/4 步）
- 已完成：
  ✓ 学术检索：找到 67 篇论文
  ✓ 分析演进：已生成时间线
- 待执行：
  ⏳ 对比方案
  ⏳ 生成报告

是否继续执行？[继续] [放弃] [修改计划]

---

用户：[继续]

Synapse:
[3/4] 正在对比方案...
✓ 已完成

[4/4] 正在生成报告...
✓ 报告已生成

**任务 #T-001 完成**
输出：RAG 技术栈演进分析报告.md
```

**实施步骤**：
1. 实现 `PersistentTaskManager` 类
2. 添加数据库表和迁移
3. 实现任务恢复逻辑
4. 前端添加 "我的任务" 列表页
5. 支持任务暂停/恢复/放弃

**成本**：约 800 行新代码 + 前端开发

---

## 🚀 推荐实施路线

### 最小可行方案（MVP）

**目标**：1 个月内快速提升 Agent 能力

```
Week 1-2: Phase 1（提示词优化）
  ├─ 重构决策层 Prompt（结构化推理）
  ├─ 重构回答层 Prompt（完成度判断）
  └─ A/B 测试验证效果

Week 3-4: Phase 2（多步执行框架）
  ├─ 实现 planTask / executeStep / replanTask
  ├─ 添加数据库表
  └─ 前端支持进度显示

Week 5-8: Phase 3（持久任务，可选）
  ├─ 实现 PersistentTaskManager
  └─ 前端添加任务列表页
```

### 快速验证方案（2 周）

**目标**：先验证提示词优化效果，再决定是否投入 Phase 2/3

```
Week 1: 提示词优化 + 小规模测试
  ├─ 修改 decideTools 和 generateAnswer 的 Prompt
  ├─ 测试 10 个复杂任务（检索 + 报告生成）
  └─ 对比优化前后的决策质量

Week 2: 评估 + 决策
  ├─ 如果提示词优化效果显著（>30% 提升）
  │   → 继续 Phase 2
  └─ 如果效果一般
      → 重新评估架构方向
```

---

## 📊 预期效果对比

### 优化前 vs 优化后

| 场景 | 优化前 | Phase 1 后 | Phase 2 后 | Phase 3 后 |
|------|--------|-----------|-----------|-----------|
| **简单问答** | ✅ 快速回答 | ✅ 同 | ✅ 同 | ✅ 同 |
| **单次检索** | ✅ 检索 + 回答 | ✅ 更精准模式选择 | ✅ 同 | ✅ 同 |
| **检索 + 报告** | ⚠️ 需 2 轮对话 | ⚠️ 同 | ✅ 自动多步执行 | ✅ 可恢复 |
| **复杂分析** | ❌ 无法处理 | ⚠️ 提示分解，但需手动 | ✅ 自动拆分执行 | ✅ 可暂停恢复 |
| **检索失败** | ❌ 直接终止 | ⚠️ 提示重试，但需手动 | ✅ 自动重试 | ✅ 同 |
| **跨会话任务** | ❌ 任务丢失 | ❌ 同 | ❌ 同 | ✅ 可恢复 |

### 成本对比

| 阶段 | 开发成本 | LLM 成本变化 | 用户体验提升 |
|------|---------|------------|------------|
| **Phase 1** | 1-2 天（仅改 Prompt） | +5%（更长 Prompt） | +30%（更智能决策） |
| **Phase 2** | 2-3 周（500 行代码） | +20%（多次 LLM 调用） | +80%（支持复杂任务） |
| **Phase 3** | 3-4 周（800 行代码） | +5%（任务状态管理） | +50%（可恢复任务） |

---

## 💡 关键设计决策

### 1. 为什么不直接用 ReAct？

**ReAct 优点**：
- ✅ 多步推理，自动重试
- ✅ 实现简单（LangChain 内置）

**ReAct 缺点**：
- ❌ LLM 调用频繁（5 步任务 = 15-20 次调用）
- ❌ 延迟高（串行执行）
- ❌ 容易陷入循环（需要 max_iterations 硬限制）

**Synapse 的选择**：**Plan-Execute-Replan**
- ✅ 计划阶段 1 次 LLM，执行阶段按需调用
- ✅ 可并发执行无依赖的步骤
- ✅ Replan 最多 2 次，可控性强

### 2. 为什么不完全模仿 Claude Code？

**Claude Code 特性**：
- 项目级上下文（理解整个代码库）
- 持久任务（关闭终端后可恢复）
- 多步骤验证（修改 → 测试 → 修复 → 再测试）

**Synapse 的差异**：
- **场景不同**：Synapse 聚焦研究 + 文档生成，Claude Code 聚焦编程
- **复杂度平衡**：完全模仿需要 6-12 个月开发，当前 MVP 方案 1-2 个月
- **渐进式升级**：Phase 1-2-3 逐步接近 Claude Code 能力

### 3. 为什么要持久任务？

**适用场景**：
- ✅ 长时任务（5-10 分钟以上）
- ✅ 需要用户中途介入（上传文件、确认中间结果）
- ✅ 跨多天的调研任务

**不适用场景**：
- ❌ 简单问答（1 分钟内完成）
- ❌ 单次检索（无需恢复）

**实施建议**：Phase 3 可作为 **可选功能**，针对高级用户开放。

---

## 📝 总结

### 核心结论

1. **Synapse 当前定位**：快速单轮对话 Agent，适合简单检索 + 文档生成
2. **主要不足**：无多步规划、无错误恢复、无持久任务
3. **优化方向**：Plan-Execute-Replan 架构 + 持久任务支持
4. **推荐路线**：
   - **Week 1-2**：提示词优化（零代码，快速验证）
   - **Week 3-4**：多步执行框架（核心能力提升）
   - **Week 5-8**：持久任务支持（可选，针对高级场景）

### 立即可行动的优化（本周内）

1. **修改 `decideTools` Prompt**（`lib/synapse-runtime.ts:765`）
   - 添加 5 步结构化推理
   - 添加任务分解示例
   
2. **修改 `generateAnswer` Prompt**（`lib/synapse-runtime.ts:1000+`）
   - 添加任务完成度评估
   - 添加执行摘要模板
   
3. **测试验证**
   - 准备 10 个复杂任务测试用例
   - 对比优化前后的决策质量和回答结构

### 下一步

选择实施路线后，可以：
1. 创建 GitHub Issue 跟踪每个 Phase
2. 编写详细的技术规格文档
3. 开始 Phase 1 实施

---

**文档版本**：v1.0  
**创建日期**：2026-08-16  
**作者**：Kiro (Claude Opus 5)
