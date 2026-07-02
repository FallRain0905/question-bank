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
  if (!baseUrl || !apiKey) return null;
  const workflowId = process.env.DIFY_DOCUMENT_WORKFLOW_ID?.trim();
  const path = workflowId ? `/workflows/${workflowId}/run` : '/workflows/run';
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      inputs,
      response_mode: 'blocking',
      user: userId,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.outputs || data.outputs || null;
}

function fallbackPlan(message: string): AgentPlan {
  const lower = message.toLowerCase();
  const wantsDocument = /文档|报告|简报|方案|markdown|docx|写|生成|创建|整理|总结|draft|report|document/.test(lower);
  const wantsSearch = /检索|搜索|查|研究|资料|论文|web|联网|进展|趋势|search|research|paper|source/.test(lower) || wantsDocument;
  const steps: AgentPlanStep[] = [];

  if (wantsSearch) {
    steps.push({
      id: nowId('step'),
      tool: 'researchSearch',
      title: '检索相关资料',
      description: '调用 Synap 统一检索管线，获取论文、Web 和摘要级来源。',
      args: {
        query: message,
        mode: 'both',
        depth: 'medium',
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
      args: { query: message, mode: 'both', depth: 'fast' },
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
        args: typeof row.args === 'object' && row.args ? row.args : {},
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
    {"tool":"researchSearch","title":"检索资料","description":"为什么要检索","args":{"query":"具体检索 query","mode":"both","depth":"medium"}},
    {"tool":"createDocument","title":"创建文档","description":"生成什么文档","args":{"title":"文档标题","documentType":"research_brief"}}
  ]
}

可用工具：
- researchSearch(query, mode, depth)：调用 Synap 统一检索管线。mode 可为 academic/general/both，depth 可为 fast/medium/deep。
- createDocument(title, documentType)：根据用户需求和检索结果创建 Markdown 文档。

规则：
- 如果用户要写报告、简报、方案、总结或文档，通常先 researchSearch，再 createDocument。
- 如果用户只是问“查一下/搜索一下”，只用 researchSearch。
- query 要具体，不要只复制“帮我写一份文档”。
- 不要调用不存在的工具。

用户请求：${message}`;

  const difyAnswer = difyKey ? await callDifyChat(difyKey, userId, planningPrompt) : '';
  const difyPlan = difyAnswer ? normalizePlan(parseJsonObject(difyAnswer), message) : null;
  if (difyPlan) return difyPlan;

  const llmAnswer = await callLLM(llmConfig, planningPrompt, 1200);
  const llmPlan = llmAnswer ? normalizePlan(parseJsonObject(llmAnswer), message) : null;
  return llmPlan || fallbackPlan(message);
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
${sources.length ? '已检索到以下来源，可继续让 Agent 扩写为更完整的文档。' : '当前没有可用检索来源。'}

## 来源
${sources.slice(0, 12).map((source, index) => `- [${index + 1}] ${source.title}${source.url ? ` - ${source.url}` : ''}`).join('\n') || '- 暂无来源。'}
`;
}

export async function generateAgentDocument(options: DocumentDraftOptions) {
  const createStep = options.plan.steps.find(step => step.tool === 'createDocument');
  const title = String(createStep?.args?.title || 'Agent 生成文档').trim() || 'Agent 生成文档';
  const context = sourcesToMarkdownContext(options.sources);
  const difyKey = process.env.DIFY_DOCUMENT_WORKFLOW_KEY?.trim();

  if (difyKey) {
    const outputs = await callDifyWorkflow(difyKey, options.userId, {
      topic: options.message,
      title,
      document_type: createStep?.args?.documentType || 'research_brief',
      context,
      style: 'concise_research_markdown',
      constraints: '请输出 Markdown；保留来源编号；不要编造未出现的来源。',
    });
    const markdown = outputs?.markdown || outputs?.content || outputs?.text || outputs?.answer || '';
    if (markdown) {
      return {
        title: String(outputs?.title || title).trim() || title,
        markdown: String(markdown),
        runtime: 'dify',
      };
    }
  }

  const prompt = `你是 Synap 的文档创建 Agent。请根据用户请求和检索来源创建一份 Markdown 文档。

要求：
- 直接输出 Markdown。
- 标题使用用户任务或计划标题。
- 保持简洁，结构清楚。
- 使用 [1]、[2] 这样的来源编号。
- 不要编造来源中没有的信息。

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
  };
}
