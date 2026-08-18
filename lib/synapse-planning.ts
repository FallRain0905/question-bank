// Synapse Agent 的规划/路由/决策纯逻辑。
// 从 synapse-runtime.ts 原样迁出（不改行为），隔离 LLM + Supabase 依赖以便单测。
// 依赖方向：synapse-planning -> synapse-sanitize -> (无)，不反向依赖 runtime。

import type { AgentPlan, AgentToolCallLog } from '@/types';
import { sanitizeTextForPostgres } from '@/lib/synapse-sanitize';

export type SynapseToolDecision = {
  tool: 'researchSearch' | 'readDocument' | 'convertDocument' | 'createDocument' | 'downloadFile' | 'downloadPaper' | 'runTerminal' | 'listSandboxFiles';
  title: string;
  reason: string;
  args: Record<string, any>;
};

export type SynapseDecision = {
  intent: 'answer' | 'research' | 'read' | 'write';
  responseStyle: 'concise' | 'normal' | 'detailed';
  tools: SynapseToolDecision[];
  needsConfirmation?: boolean;
};

export type MultiStepSubGoal = {
  id: string;
  title: string;
  description: string;
  tools: SynapseToolDecision[];
  critical: boolean;
};

export type MultiStepPlan = {
  id: string;
  title: string;
  summary: string;
  subGoals: MultiStepSubGoal[];
  createdAt: string;
};

export type SynapseGraphTask = {
  currentStep: number;
  totalSteps: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'needs_confirmation';
  observation: string;
  executed: Array<{ stepId: string; toolCalls: AgentToolCallLog[]; ok: boolean }>;
  replans: number;
};

export type SynapseEval = {
  done: boolean;
  replan: boolean;
  reason: string;
};

export const MAX_ITERATIONS = 6;
export const MAX_REPLANS = 2;

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function titleFromMessage(message: string) {
  return sanitizeTextForPostgres(message).replace(/\s+/g, ' ').trim().slice(0, 42) || 'Synapse Conversation';
}

export function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function isSideEffectTool(tool: SynapseToolDecision | { tool: string }) {
  return tool.tool === 'createDocument' || tool.tool === 'convertDocument' || tool.tool === 'downloadFile' || tool.tool === 'downloadPaper' || tool.tool === 'runTerminal';
}

export function cleanHeuristicDecision(message: string, files: any[]): SynapseDecision {
  const lower = message.toLowerCase();
  const wantsConvert = /转换|转成|转为|解析.*pdf|pdf.*解析|pdf.*markdown|mineru|convert|parse pdf|pdf to markdown/i.test(message);
  const wantsSearch = /检索|搜索|联网|查找|查一下|搜一下|资料|论文|文献|综述|最新|趋势|进展|research|search|paper|literature|source|web/.test(lower);
  const wantsRead = /文件|文档|附件|上传|pdf|docx|阅读|总结这份|分析这份|file|document|attachment|read|summarize/.test(lower) && files.length > 0;
  const wantsWrite = /创建|生成|写.*文档|写.*报告|写.*简报|整理成.*文档|保存.*文档|导出|markdown|docx|create|generate|write|document|report|export/.test(lower);
  const wantsDownload = /(下载|抓取|保存).*(https?:\/\/\S+)|download\s+https?:\/\/\S+/i.test(message);
  const wantsPaperDownload = /(下载|保存|获取|抓取).*(论文|文献|paper|pdf)|(paper|pdf).*(download|save)/i.test(message);
  const wantsTerminal = /运行命令|执行命令|终端|命令行|shell|terminal|run command|execute command/.test(lower);
  const wantsListSandbox = /沙箱.*文件|工作区.*文件|列出.*文件|list.*files|ls workspace/.test(lower);
  const tools: SynapseToolDecision[] = [];

  if (wantsRead) {
    tools.push({
      tool: 'readDocument',
      title: '读取会话文档',
      reason: '用户提到了已上传文件或文档，需要先读取文档内容。',
      args: { query: message },
    });
  }

  if (wantsSearch || wantsPaperDownload) {
    const mode = /论文|文献|综述|学术|paper|literature|semantic scholar|openalex|arxiv/.test(lower)
      ? 'academic'
      : /网页|官网|新闻|博客|产业|项目|github|web|news|blog|official|docs/.test(lower)
        ? 'general'
        : 'both';
    tools.push({
      tool: 'researchSearch',
      title: mode === 'academic' ? '学术检索' : mode === 'general' ? 'Web 检索' : '综合检索',
      reason: '用户需要外部资料支撑回答。',
      args: { query: message, mode, depth: /深度|全面|详细|deep/.test(lower) ? 'deep' : 'medium' },
    });
  }

  if (wantsWrite) {
    tools.push({
      tool: 'createDocument',
      title: '创建文档',
      reason: '创建或导出文档属于副作用动作，需要用户确认。',
      args: { title: titleFromMessage(message), documentType: 'synapse_document' },
    });
  }

  if (wantsListSandbox) {
    tools.push({
      tool: 'listSandboxFiles',
      title: '列出沙箱文件',
      reason: '用户想查看服务器沙箱/工作区内的文件。',
      args: { maxFiles: 80 },
    });
  }

  if (wantsDownload) {
    const url = message.match(/https?:\/\/[^\s"'<>]+/)?.[0] || '';
    tools.push({
      tool: 'downloadFile',
      title: '下载文件到沙箱',
      reason: '从外部链接下载文件会改变服务器工作区，需要用户确认。',
      args: { url },
    });
  }

  if (wantsPaperDownload) {
    tools.push({
      tool: 'downloadPaper',
      title: '下载论文 PDF',
      reason: '用户希望下载检索到的论文 PDF，需要先解析可访问 PDF 链接并在确认后保存到工作区。',
      args: { title: message, rank: 1 },
    });
  }

  if (wantsTerminal) {
    tools.push({
      tool: 'runTerminal',
      title: '运行沙箱终端命令',
      reason: '终端命令会在服务器 Docker 沙箱中执行，需要用户确认。',
      args: { command: message.replace(/^(运行命令|执行命令|终端|命令行)[:：]?\s*/i, '').trim() },
    });
  }

  if (wantsConvert) {
    const remainingTools = tools.filter(tool => tool.tool !== 'readDocument' && tool.tool !== 'createDocument' && tool.tool !== 'convertDocument');
    tools.length = 0;
    tools.push({
      tool: 'convertDocument',
      title: '转换 PDF 为 Markdown',
      reason: '用户要求解析或转换 PDF，应该使用 MinerU 转换工具，而不是直接读取未转换 PDF。',
      args: { query: message },
    }, ...remainingTools);
  }

  return {
    intent: (wantsWrite || wantsConvert || wantsDownload || wantsPaperDownload || wantsTerminal) ? 'write' : wantsSearch ? 'research' : wantsRead ? 'read' : 'answer',
    responseStyle: /简短|简洁|brief|short/.test(lower) ? 'concise' : /详细|全面|deep|detailed/.test(lower) ? 'detailed' : 'normal',
    tools,
    needsConfirmation: wantsWrite || wantsConvert || wantsDownload || wantsPaperDownload || wantsTerminal,
  };
}

export function heuristicDecision(message: string, files: any[]): SynapseDecision {
  return cleanHeuristicDecision(message, files);
}

export function confirmationPlan(message: string, decision: SynapseDecision): AgentPlan | null {
  const sideEffectTools = decision.tools.filter(isSideEffectTool);
  if (!sideEffectTools.length) return null;
  return {
    id: id('plan'),
    title: sideEffectTools.length === 1 ? sideEffectTools[0].title : '确认沙箱操作',
    summary: '这些操作会修改服务器沙箱、运行命令或创建文档，需要你确认后再执行。',
    steps: sideEffectTools.map(tool => ({
      id: id('step'),
      tool: tool.tool,
      title: tool.title || (
        tool.tool === 'createDocument' ? '创建 Markdown 文档' :
        tool.tool === 'convertDocument' ? '转换 PDF 为 Markdown' :
        tool.tool === 'downloadFile' ? '下载文件到沙箱' :
        tool.tool === 'downloadPaper' ? '下载论文 PDF' :
        '运行沙箱终端命令'
      ),
      description: tool.reason || '该操作会改变服务器工作区状态。',
      args: tool.tool === 'createDocument'
        ? {
            title: tool.args.title || titleFromMessage(message),
            documentType: tool.args.documentType || 'synapse_document',
          }
        : tool.args,
    })),
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
  };
}

export function shouldPlanMultiStep(decision: SynapseDecision) {
  if (decision.intent !== 'research' && decision.intent !== 'write') return false;
  const tools = decision.tools;
  if (tools.length < 2) return false;
  const firstSideEffect = tools.findIndex(isSideEffectTool);
  if (firstSideEffect <= 0) return false;
  return tools.slice(0, firstSideEffect).some(tool => !isSideEffectTool(tool));
}

export function broadenPlanStep(plan: MultiStepPlan, stepIndex: number): MultiStepPlan {
  const subGoals = plan.subGoals.map((goal, index) => {
    if (index !== stepIndex) return goal;
    return {
      ...goal,
      tools: goal.tools.map(tool => tool.tool === 'researchSearch'
        ? { ...tool, title: `${tool.title}（放宽重试）`, args: { ...tool.args, mode: 'both', depth: 'fast' } }
        : tool),
    };
  });
  return { ...plan, subGoals };
}

// 路由节点只读取这些字段；用最小结构接口解耦 LangGraph 的完整状态类型。
export interface GraphRouteState {
  decision: SynapseDecision;
  iteration?: number;
  eval?: SynapseEval | null;
  task?: SynapseGraphTask | null;
}

export function graphRouteAfterDecision(state: GraphRouteState) {
  if (shouldPlanMultiStep(state.decision)) return 'plan_tasks';
  return state.decision.tools.some(tool => !isSideEffectTool(tool))
    ? 'execute_tools'
    : 'generate_answer';
}

export function routeAfterEvaluate(state: GraphRouteState) {
  if ((state.iteration || 0) >= MAX_ITERATIONS) return 'generate_answer';
  if (!state.eval?.done && (state.task?.currentStep ?? 0) < (state.task?.totalSteps ?? 0)) return 'execute_step';
  return 'generate_answer';
}

// planSynapseGraphTasks 的纯核心：把已生成的 decision.tools 确定性拆解为子目标。
// 副作用工具被排除在多步循环之外（由 confirmationPlan 收集）。
export function buildMultiStepPlan(decision: SynapseDecision): { plan: MultiStepPlan; task: SynapseGraphTask } {
  const executableTools = decision.tools.filter(tool => !isSideEffectTool(tool));
  const subGoals: MultiStepSubGoal[] = executableTools.map(tool => ({
    id: id('goal'),
    title: tool.title || (
      tool.tool === 'researchSearch' ? '检索资料' :
      tool.tool === 'readDocument' ? '读取文档' :
      '检查沙箱文件'
    ),
    description: tool.reason || '',
    tools: [tool],
    critical: tool.tool === 'researchSearch' || tool.tool === 'readDocument',
  }));

  const plan: MultiStepPlan = {
    id: id('plan'),
    title: decision.intent === 'write' ? '检索并创建文档' : '多步检索任务',
    summary: subGoals.map((goal, index) => `${index + 1}. ${goal.title}`).join('；'),
    subGoals,
    createdAt: new Date().toISOString(),
  };

  const task: SynapseGraphTask = {
    currentStep: 0,
    totalSteps: subGoals.length,
    status: subGoals.length ? 'executing' : 'completed',
    observation: '',
    executed: [],
    replans: 0,
  };

  return { plan, task };
}
