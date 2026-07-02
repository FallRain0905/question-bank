import type { AgentPlan, AgentPlanStep, ResearchSource } from '@/types';

type LLMConfig = {
  apiKey?: string;
  endpoint?: string;
  defaultModel?: string;
};

type DocumentDraftOptions = {
  userId: string;
  message: string;
  plan: AgentPlan;
  sources: ResearchSource[];
  llmConfig: LLMConfig | null;
};

type AgentPlannerResult =
  | { type: 'response'; message: string }
  | { type: 'plan'; message: string; plan: AgentPlan };

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeBaseUrl(raw: string | undefined) {
  const base = (raw || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

function inferSearchMode(text: string): 'academic' | 'general' | 'both' {
  const lower = text.toLowerCase();
  const academic = /论文|文献|综述|学术|期刊|citation|semantic scholar|openalex|arxiv|paper|papers|literature|survey|review/.test(lower);
  const general = /网页|联网|新闻|官网|博客|产业|产品|工具|文档|教程|项目|公司|价格|api|github|web|news|blog|industry|official|docs|tutorial|project/.test(lower);
  if (academic && general) return 'both';
  if (academic) return 'academic';
  if (general) return 'general';
  return /研究|趋势|进展|报告|方案|背景|资料|research|trend|progress|report/.test(lower) ? 'both' : 'general';
}

function inferSearchDepth(text: string): 'fast' | 'medium' | 'deep' {
  const lower = text.toLowerCase();
  if (/深度|全面|详细|系统|多轮|完整|deep|comprehensive|thorough/.test(lower)) return 'deep';
  if (/快速|简单|大概|简短|fast|quick|brief/.test(lower)) return 'fast';
  return 'medium';
}

function modeLabel(mode: string) {
  if (mode === 'academic') return '学术检索';
  if (mode === 'general') return 'Web 检索';
  return '综合检索';
}

function normalizeSearchStepArgs(args: Record<string, any>, message: string) {
  const query = String(args.query || args.topic || message || '').trim();
  const inferredMode = inferSearchMode(`${query} ${message}`);
  const mode = args.mode === 'academic' || args.mode === 'general' || args.mode === 'both'
    ? args.mode
    : inferredMode;
  const depth = args.depth === 'fast' || args.depth === 'medium' || args.depth === 'deep'
    ? args.depth
    : inferSearchDepth(`${query} ${message}`);

  return {
    ...args,
    query,
    mode,
    depth,
    routingReason: args.routingReason || `根据任务意图选择${modeLabel(mode)}。`,
  };
}

function isCapabilityQuestion(message: string) {
  const lower = message.toLowerCase();
  const asksCapabilities = /你现在可以做什么|你能做什么|当前.*技能|当前.*skill|你的.*skill|你的.*技能|工具列表|可用工具|有什么功能|有哪些功能|agent.*能力|tools|skills|capabilities/.test(lower);
  const explicitlyWantsDocument = /(创建|生成|写|导出|下载|保存).*?(文档|说明文档|markdown|docx)|create.*document|generate.*document|export.*document/.test(lower);
  return asksCapabilities && !explicitlyWantsDocument;
}

function isSkillHealthQuestion(message: string) {
  const lower = message.toLowerCase();
  return /(skill|技能|工具|功能).*(正常|可用|能用|健康|ok|okay|status)|一切.*正常/.test(lower);
}

function isModelIdentityQuestion(message: string) {
  const lower = message.toLowerCase();
  return /你是什么模型|你用的是什么模型|当前.*模型|底层.*模型|模型.*是什么|你是谁|model|llm/.test(lower);
}

function shouldUseTools(message: string) {
  if (isCapabilityQuestion(message) || isSkillHealthQuestion(message) || isModelIdentityQuestion(message)) return false;
  const lower = message.toLowerCase();
  return /检索|搜索|联网|查找|查一下|搜一下|帮我查|资料|论文|文献|综述|创建|生成|写.*文档|写.*报告|写.*简报|整理成|保存|下载|导出|markdown|docx|research|search|source|paper|literature|create|generate|write|document|report|export/.test(lower);
}

function capabilityAnswer() {
  return `我现在在这个 Agent 调试台里主要能做三件事：

1. 直接回答简单问题：比如解释当前能力、说明怎么用、判断下一步该怎么做。这类问题不会强制生成计划，也不会创建文档。
2. 调用 researchSearch 检索资料：我会根据任务选择 Web 检索、学术检索或综合检索，而不是默认只走 Semantic Scholar。适合找论文、网页、产业资料、项目文档和研究背景。
3. 调用 createDocument 创建文档：确认执行后可以把检索结果或你的要求整理成 Markdown 文档，并支持下载 Markdown / DOCX。

现在的规则是：普通对话直接回复；只有涉及检索、创建文档、生成报告、导出文件这类会改变状态或消耗工具的任务，我才会先给计划预览，等你确认后再执行。`;
}

function skillHealthAnswer() {
  return `从当前 Agent 调试台的逻辑看，基础链路是正常的：

1. 普通对话：会直接回复，不会再强制生成计划。
2. researchSearch：会按任务选择 Web 检索、学术检索或综合检索，并在计划里显示选择理由。
3. createDocument：可以基于检索结果或用户输入创建 Markdown 文档；如果没有来源，会生成无引用草稿，而不是直接说无法生成。

不过“完全正常”还要看实际环境配置：Dify API、Supabase 的 agent_documents 表、Tavily / Semantic Scholar 等 key 是否都在服务器上配置好。你可以用一句明确任务做 smoke test，比如：“联网检索 MOF 材料近三年趋势，并创建一份简短文档”。`;
}

function modelIdentityAnswer(llmConfig: LLMConfig | null) {
  const difyConfigured = Boolean(process.env.DIFY_AGENT_APP_KEY?.trim() && process.env.DIFY_API_BASE_URL?.trim());
  const fallbackModel = llmConfig?.defaultModel?.trim() || '未读取到用户模型配置';
  const difyLine = difyConfigured
    ? '当前 Agent 直答优先会经过 Dify Agent App；Dify 内部具体使用哪个模型，需要在 Dify 应用配置里查看。'
    : '当前没有启用 Dify Agent App，直答会使用 Synap 设置页里的 LLM 配置。';

  return `我是 Synap Agent 调试台，不是固定绑定某一个厂商模型的产品。

${difyLine}
Synap 侧读取到的备用 / 本地 LLM 模型配置是：${fallbackModel}。

所以我不应该自称“DeepSeek 最新版”“ChatGPT”或其他固定模型；更准确的说法是：我是 Synap 的 Agent 编排层，底层模型由你的 Dify 应用配置或 Synap 设置页决定。`;
}

async function callLLM(llmConfig: LLMConfig | null, prompt: string, maxTokens = 1600) {
  if (!llmConfig?.apiKey || !llmConfig?.endpoint || !llmConfig?.defaultModel) return '';
  const res = await fetch(llmConfig.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
    body: JSON.stringify({
      model: llmConfig.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.15,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callDifyChat(apiKey: string, userId: string, query: string, inputs: Record<string, any> = {}) {
  const baseUrl = normalizeBaseUrl(process.env.DIFY_API_BASE_URL);
  if (!baseUrl || !apiKey) return '';
  const res = await fetch(`${baseUrl}/chat-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      inputs,
      query,
      response_mode: 'blocking',
      user: userId,
    }),
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data.answer || data.data?.answer || '';
}

async function callDifyWorkflow(apiKey: string, userId: string, inputs: Record<string, any>) {
  const baseUrl = normalizeBaseUrl(process.env.DIFY_API_BASE_URL);
  if (!baseUrl || !apiKey) return { outputs: null, error: 'Dify workflow is not configured.' };
  const workflowId = process.env.DIFY_DOCUMENT_WORKFLOW_ID?.trim();
  const path = workflowId ? `/workflows/${workflowId}/run` : '/workflows/run';
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        inputs,
        response_mode: 'blocking',
        user: userId,
      }),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      return { outputs: null, error: `Dify workflow HTTP ${res.status}: ${data?.message || data?.error || text.slice(0, 240)}` };
    }
    return { outputs: data?.data?.outputs || data?.outputs || null, error: '' };
  } catch (err: any) {
    return { outputs: null, error: err.message || 'Dify workflow request failed.' };
  }
}

function fallbackPlan(message: string): AgentPlan {
  const lower = message.toLowerCase();
  const wantsDocument = /文档|报告|简报|方案|markdown|docx|写|生成|创建|整理|总结|draft|report|document/.test(lower);
  const wantsSearch = /检索|搜索|查|研究|资料|论文|web|联网|进展|趋势|search|research|paper|source/.test(lower) || wantsDocument;
  const steps: AgentPlanStep[] = [];
  const mode = inferSearchMode(message);
  const depth = inferSearchDepth(message);

  if (wantsSearch) {
    steps.push({
      id: nowId('step'),
      tool: 'researchSearch',
      title: `${modeLabel(mode)}相关资料`,
      description: `调用 Synap 统一检索管线，并根据任务意图使用${modeLabel(mode)}。`,
      args: {
        query: message,
        mode,
        depth,
        routingReason: `规则 fallback 判断本任务更适合${modeLabel(mode)}。`,
      },
    });
  }

  if (wantsDocument) {
    steps.push({
      id: nowId('step'),
      tool: 'createDocument',
      title: '创建 Markdown 文档',
      description: '基于用户需求和已检索来源生成一份可下载的 Markdown 文档。',
      args: {
        title: message.replace(/\s+/g, ' ').slice(0, 48) || 'Agent 生成文档',
        documentType: 'research_brief',
      },
    });
  }

  if (steps.length === 0) {
    steps.push({
      id: nowId('step'),
      tool: 'researchSearch',
      title: '先检索背景信息',
      description: '先获取少量来源，再决定是否创建文档。',
      args: { query: message, mode, depth: 'fast', routingReason: `任务意图不明确，先用${modeLabel(mode)}获取背景。` },
    });
  }

  return {
    id: nowId('plan'),
    title: wantsDocument ? '检索并创建文档' : '检索资料',
    summary: '我会先给出执行计划，确认后再调用工具。',
    steps,
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
  };
}

function normalizePlan(parsed: any, message: string): AgentPlan | null {
  const rows = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const steps = rows
    .map((row: any) => {
      const tool = row.tool === 'createDocument' || row.tool === 'researchSearch' ? row.tool : null;
      if (!tool) return null;
      return {
        id: String(row.id || nowId('step')),
        tool,
        title: String(row.title || (tool === 'researchSearch' ? '检索资料' : '创建文档')).slice(0, 80),
        description: String(row.description || '').slice(0, 220),
        args: tool === 'researchSearch'
          ? normalizeSearchStepArgs(typeof row.args === 'object' && row.args ? row.args : {}, message)
          : (typeof row.args === 'object' && row.args ? row.args : {}),
      } satisfies AgentPlanStep;
    })
    .filter(Boolean) as AgentPlanStep[];

  if (steps.length === 0) return null;
  return {
    id: String(parsed.id || nowId('plan')),
    title: String(parsed.title || 'Agent 执行计划').slice(0, 80),
    summary: String(parsed.summary || '确认后我会按计划调用工具。').slice(0, 360),
    steps: steps.slice(0, 5),
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
  };
}

export async function planAgentTask(message: string, userId: string, llmConfig: LLMConfig | null): Promise<AgentPlan> {
  const difyKey = process.env.DIFY_AGENT_APP_KEY?.trim();
  const planningPrompt = `你是 Synap 的 Agent Planner。请把用户请求转换为工具执行计划。

只返回 JSON：
{
  "title": "计划标题",
  "summary": "一两句话说明计划",
  "steps": [
    {"tool":"researchSearch","title":"检索资料","description":"为什么要检索","args":{"query":"具体检索 query","mode":"general|academic|both","depth":"fast|medium|deep","routingReason":"为什么选择这个检索类型"}},
    {"tool":"createDocument","title":"创建文档","description":"生成什么文档","args":{"title":"文档标题","documentType":"research_brief"}}
  ]
}

可用工具：
- researchSearch(query, mode, depth)：调用 Synap 统一检索管线。mode 可为 academic/general/both，depth 可为 fast/medium/deep。
- createDocument(title, documentType)：根据用户需求和检索结果创建 Markdown 文档。

规则：
- 如果用户只是问你能做什么、当前有哪些 skill / 工具、怎么使用 Agent，不要创建文档，也不要检索；这类问题应该直接回答，不该进入工具计划。
- 必须由你为每个 researchSearch 明确选择 mode：
  - academic：用户明确要论文、文献、综述、学术资料、Semantic Scholar、OpenAlex、arXiv。
  - general：用户要官网、网页、新闻、产品、教程、博客、产业动态、API 文档、项目资料。
  - both：用户要领域研究、趋势、研究报告、技术方案，且论文和 Web 都有价值。
- 如果用户要写报告、简报、方案、总结或文档，通常先 researchSearch，再 createDocument。
- 如果用户明确只是要创建一个不依赖外部事实的文档，可以只用 createDocument。
- 如果用户只是问“查一下/搜索一下”，只用 researchSearch。
- query 要具体，不要只复制“帮我写一份文档”。
- 如果用户没有明确说论文，不要默认 academic。
- 不要调用不存在的工具。

用户请求：${message}`;

  const difyAnswer = difyKey ? await callDifyChat(difyKey, userId, planningPrompt) : '';
  const difyPlan = difyAnswer ? normalizePlan(parseJsonObject(difyAnswer), message) : null;
  if (difyPlan) return difyPlan;

  const llmAnswer = await callLLM(llmConfig, planningPrompt, 1200);
  const llmPlan = llmAnswer ? normalizePlan(parseJsonObject(llmAnswer), message) : null;
  return llmPlan || fallbackPlan(message);
}

async function answerAgentDirectly(message: string, userId: string, llmConfig: LLMConfig | null) {
  if (isSkillHealthQuestion(message)) return skillHealthAnswer();
  if (isModelIdentityQuestion(message)) return modelIdentityAnswer(llmConfig);
  if (isCapabilityQuestion(message)) return capabilityAnswer();

  const prompt = `你是 Synap Agent 调试台的直答层。请直接回答用户的问题，不要返回 JSON，不要创建文档，不要声称已经调用工具。
身份规则：
- 你是 Synap 的 Agent 编排层，不要自称 DeepSeek、ChatGPT、Claude 或任何固定模型。
- 底层模型由 Dify 应用配置或 Synap 设置页决定；不知道具体模型时要如实说明。
- 不要输出营销式模型介绍，不要使用表情。
如果问题需要最新资料、联网搜索或文件创建，请提醒用户可以明确要求你检索或创建文档。

用户问题：${message}`;

  const difyKey = process.env.DIFY_AGENT_APP_KEY?.trim();
  const difyAnswer = difyKey ? await callDifyChat(difyKey, userId, prompt) : '';
  if (difyAnswer.trim()) return difyAnswer.trim();

  const llmAnswer = await callLLM(llmConfig, prompt, 900);
  if (llmAnswer.trim()) return llmAnswer.trim();

  return '这个问题不需要调用工具。我可以直接回答；如果你希望我联网检索、创建文档或生成报告，可以在问题里明确说出来。';
}

export async function planOrAnswerAgentTask(message: string, userId: string, llmConfig: LLMConfig | null): Promise<AgentPlannerResult> {
  if (!shouldUseTools(message)) {
    return {
      type: 'response',
      message: await answerAgentDirectly(message, userId, llmConfig),
    };
  }

  const plan = await planAgentTask(message, userId, llmConfig);
  return {
    type: 'plan',
    message: '我先拟定了一个执行计划。确认后我再调用工具。',
    plan,
  };
}

function sourcesToMarkdownContext(sources: ResearchSource[]) {
  return sources.slice(0, 18).map((source, index) => {
    const text = source.fullTextExcerpt || source.abstract || source.snippet || '';
    return `[${index + 1}] ${source.title}
Provider: ${source.sourceProvider || source.type}
Year: ${source.year || ''}
URL: ${source.url || ''}
Excerpt: ${text.slice(0, 1000)}`;
  }).join('\n\n');
}

function fallbackMarkdown(message: string, plan: AgentPlan, sources: ResearchSource[]) {
  const title = plan.steps.find(step => step.tool === 'createDocument')?.args?.title || 'Agent 生成文档';
  return `# ${title}

## 任务
${message}

## 执行计划
${plan.steps.map((step, index) => `${index + 1}. ${step.title}：${step.description}`).join('\n')}

## 初步整理
${sources.length ? '已检索到以下来源，可继续让 Agent 扩写为更完整的文档。' : '这是一份基于用户输入整理的草稿，当前未引用外部来源。'}

## 来源
${sources.slice(0, 12).map((source, index) => `- [${index + 1}] ${source.title}${source.url ? ` - ${source.url}` : ''}`).join('\n') || '- 未引用外部来源。'}
`;
}

export async function generateAgentDocument(options: DocumentDraftOptions) {
  const createStep = options.plan.steps.find(step => step.tool === 'createDocument');
  const title = String(createStep?.args?.title || 'Agent 生成文档').trim() || 'Agent 生成文档';
  const context = sourcesToMarkdownContext(options.sources);
  const difyKey = process.env.DIFY_DOCUMENT_WORKFLOW_KEY?.trim();
  const warnings: string[] = [];

  if (difyKey) {
    const workflowResult = await callDifyWorkflow(difyKey, options.userId, {
      topic: options.message,
      title,
      document_type: createStep?.args?.documentType || 'research_brief',
      context,
      style: 'concise_research_markdown',
      constraints: '请输出 Markdown；如果 context 有来源，保留来源编号且不要编造未出现的来源；如果 context 为空，请基于用户请求生成无引用草稿，不要因为没有来源而拒绝。',
    });
    const outputs = workflowResult.outputs;
    if (workflowResult.error) warnings.push(workflowResult.error);
    const markdown = outputs?.markdown || outputs?.content || outputs?.text || outputs?.answer || '';
    if (markdown) {
      return {
        title: String(outputs?.title || title).trim() || title,
        markdown: String(markdown),
        runtime: 'dify',
        warnings,
      };
    }
    warnings.push('Dify workflow did not return markdown/content/text/answer; falling back to Synap document generator.');
  }

  const prompt = `你是 Synap 的文档创建 Agent。请根据用户请求和检索来源创建一份 Markdown 文档。

要求：
- 直接输出 Markdown。
- 标题使用用户任务或计划标题。
- 保持简洁，结构清楚。
- 如果有来源，使用 [1]、[2] 这样的来源编号，且不要编造来源中没有的信息。
- 如果没有来源，可以基于用户输入生成无引用草稿，并明确说明“未引用外部来源”；不要因为来源为空而拒绝生成。

用户请求：${options.message}
计划：
${options.plan.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.description}`).join('\n')}

来源：
${context || '无'}`;

  const llmMarkdown = await callLLM(options.llmConfig, prompt, 2600);
  return {
    title,
    markdown: llmMarkdown || fallbackMarkdown(options.message, options.plan, options.sources),
    runtime: llmMarkdown ? 'local_llm' : 'fallback',
    warnings,
  };
}
