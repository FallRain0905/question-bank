import { describe, it, expect } from 'vitest';
import {
  MAX_ITERATIONS,
  MAX_REPLANS,
  buildMultiStepPlan,
  broadenPlanStep,
  confirmationPlan,
  graphRouteAfterDecision,
  heuristicDecision,
  isSideEffectTool,
  parseJsonObject,
  routeAfterEvaluate,
  shouldPlanMultiStep,
  titleFromMessage,
  type SynapseDecision,
  type SynapseToolDecision,
} from './synapse-planning';

function tool(tool: SynapseToolDecision['tool'], args: Record<string, any> = {}): SynapseToolDecision {
  return { tool, title: tool, reason: 'test', args };
}

function decision(
  intent: SynapseDecision['intent'],
  tools: SynapseToolDecision[],
  extra?: Partial<SynapseDecision>,
): SynapseDecision {
  return { intent, responseStyle: 'normal', tools, needsConfirmation: tools.some(isSideEffectTool), ...extra };
}

describe('isSideEffectTool', () => {
  const sideEffect = ['createDocument', 'convertDocument', 'downloadFile', 'downloadPaper', 'runTerminal'] as const;
  const safe = ['researchSearch', 'readDocument', 'listSandboxFiles'] as const;

  it('classifies all 5 side-effect tools', () => {
    for (const t of sideEffect) expect(isSideEffectTool(tool(t))).toBe(true);
  });

  it('classifies non side-effect tools', () => {
    for (const t of safe) expect(isSideEffectTool(tool(t))).toBe(false);
  });

  it('accepts a plain { tool } object', () => {
    expect(isSideEffectTool({ tool: 'downloadPaper' })).toBe(true);
  });
});

describe('shouldPlanMultiStep', () => {
  it('is true for research intent with non side-effect before side-effect', () => {
    expect(shouldPlanMultiStep(decision('research', [tool('researchSearch'), tool('createDocument')]))).toBe(true);
  });

  it('is true for write intent with non side-effect before side-effect', () => {
    expect(shouldPlanMultiStep(decision('write', [tool('readDocument'), tool('downloadPaper')]))).toBe(true);
  });

  it('is false when fewer than 2 tools', () => {
    expect(shouldPlanMultiStep(decision('research', [tool('researchSearch')]))).toBe(false);
  });

  it('is false for answer/read intents', () => {
    expect(shouldPlanMultiStep(decision('answer', [tool('researchSearch'), tool('createDocument')]))).toBe(false);
    expect(shouldPlanMultiStep(decision('read', [tool('readDocument'), tool('createDocument')]))).toBe(false);
  });

  it('is false when the side-effect tool comes first', () => {
    expect(shouldPlanMultiStep(decision('research', [tool('createDocument'), tool('researchSearch')]))).toBe(false);
  });

  it('is false when there are only side-effect tools', () => {
    expect(shouldPlanMultiStep(decision('write', [tool('createDocument'), tool('downloadFile')]))).toBe(false);
  });
});

describe('graphRouteAfterDecision', () => {
  it('routes to plan_tasks for a multi-step decision', () => {
    const d = decision('research', [tool('researchSearch'), tool('createDocument')]);
    expect(graphRouteAfterDecision({ decision: d })).toBe('plan_tasks');
  });

  it('routes to execute_tools when only non side-effect tools exist', () => {
    const d = decision('research', [tool('researchSearch'), tool('readDocument')]);
    expect(graphRouteAfterDecision({ decision: d })).toBe('execute_tools');
  });

  it('routes to generate_answer for side-effect-only decisions', () => {
    const d = decision('write', [tool('createDocument')]);
    expect(graphRouteAfterDecision({ decision: d })).toBe('generate_answer');
  });

  it('routes to generate_answer when there are no tools', () => {
    expect(graphRouteAfterDecision({ decision: decision('answer', []) })).toBe('generate_answer');
  });
});

describe('routeAfterEvaluate', () => {
  const base = { decision: decision('research', [tool('researchSearch')]) };

  it('forces generate_answer at MAX_ITERATIONS', () => {
    expect(routeAfterEvaluate({ ...base, iteration: MAX_ITERATIONS })).toBe('generate_answer');
    expect(routeAfterEvaluate({ ...base, iteration: MAX_ITERATIONS + 3 })).toBe('generate_answer');
  });

  it('continues to execute_step while steps remain', () => {
    expect(
      routeAfterEvaluate({
        ...base,
        iteration: 0,
        eval: { done: false, replan: false, reason: 'continue' },
        task: { currentStep: 0, totalSteps: 3, status: 'executing', observation: '', executed: [], replans: 0 },
      }),
    ).toBe('execute_step');
  });

  it('goes to generate_answer when eval is done', () => {
    expect(
      routeAfterEvaluate({
        ...base,
        iteration: 1,
        eval: { done: true, replan: false, reason: 'done' },
        task: { currentStep: 0, totalSteps: 3, status: 'completed', observation: '', executed: [], replans: 0 },
      }),
    ).toBe('generate_answer');
  });
});

describe('confirmationPlan', () => {
  it('returns null when there are no side-effect tools', () => {
    expect(confirmationPlan('msg', decision('research', [tool('researchSearch')]))).toBeNull();
  });

  it('returns a confirmation plan for side-effect tools', () => {
    const plan = confirmationPlan('下载论文', decision('write', [tool('downloadPaper', { rank: 1 })]));
    expect(plan).not.toBeNull();
    expect(plan!.requiresConfirmation).toBe(true);
    expect(plan!.steps.map(s => s.tool)).toEqual(['downloadPaper']);
  });

  it('collects only side-effect tools and keeps their order', () => {
    const plan = confirmationPlan(
      '检索并生成文档',
      decision('write', [tool('researchSearch'), tool('createDocument'), tool('downloadFile')]),
    );
    expect(plan).not.toBeNull();
    expect(plan!.steps.map(s => s.tool)).toEqual(['createDocument', 'downloadFile']);
  });
});

describe('broadenPlanStep', () => {
  const makePlan = () => ({
    id: 'p1',
    title: 't',
    summary: 's',
    createdAt: 'x',
    subGoals: [
      { id: 'g1', title: 'a', description: 'd', tools: [tool('researchSearch', { mode: 'academic', depth: 'medium' })], critical: true },
      { id: 'g2', title: 'b', description: 'd', tools: [tool('researchSearch', { mode: 'academic', depth: 'medium' })], critical: true },
    ],
  });

  it('broadens only the researchSearch tool at the given step', () => {
    const broadened = broadenPlanStep(makePlan(), 0);
    expect(broadened.subGoals[0].tools[0].args).toEqual({ mode: 'both', depth: 'fast' });
    expect(broadened.subGoals[1].tools[0].args).toEqual({ mode: 'academic', depth: 'medium' });
  });

  it('leaves non-researchSearch tools untouched at the target step', () => {
    const plan = makePlan();
    plan.subGoals[0].tools = [tool('readDocument', { query: 'q' })];
    const broadened = broadenPlanStep(plan, 0);
    expect(broadened.subGoals[0].tools[0].args).toEqual({ query: 'q' });
  });
});

describe('buildMultiStepPlan', () => {
  it('excludes side-effect tools from the loop', () => {
    const { plan, task } = buildMultiStepPlan(
      decision('write', [tool('researchSearch'), tool('readDocument'), tool('createDocument')]),
    );
    expect(plan.subGoals.map(g => g.tools[0].tool)).toEqual(['researchSearch', 'readDocument']);
    expect(task.totalSteps).toBe(2);
    expect(task.status).toBe('executing');
  });

  it('produces an empty completed task when only side-effect tools exist', () => {
    const { plan, task } = buildMultiStepPlan(decision('write', [tool('createDocument')]));
    expect(plan.subGoals).toHaveLength(0);
    expect(task.totalSteps).toBe(0);
    expect(task.status).toBe('completed');
  });

  it('marks researchSearch/readDocument sub-goals as critical', () => {
    const { plan } = buildMultiStepPlan(
      decision('research', [tool('researchSearch'), tool('listSandboxFiles'), tool('readDocument')]),
    );
    expect(plan.subGoals.map(g => g.critical)).toEqual([true, false, true]);
  });
});

describe('parseJsonObject', () => {
  it('parses a clean JSON object', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts a JSON object embedded in prose', () => {
    expect(parseJsonObject('结果如下：{"a":1}，谢谢')).toEqual({ a: 1 });
  });

  it('returns null when there are no braces', () => {
    expect(parseJsonObject('no json here')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseJsonObject('{"a": }')).toBeNull();
  });
});

describe('heuristicDecision', () => {
  it('orders researchSearch before createDocument for "检索并写报告"', () => {
    const d = heuristicDecision('检索一下最近的论文然后写个报告', []);
    expect(d.tools[0]?.tool).toBe('researchSearch');
    expect(d.tools[1]?.tool).toBe('createDocument');
    expect(d.needsConfirmation).toBe(true);
  });

  it('requests downloadPaper for "下载这篇论文"', () => {
    const d = heuristicDecision('下载这篇论文', []);
    expect(d.tools.some(t => t.tool === 'downloadPaper')).toBe(true);
    expect(d.needsConfirmation).toBe(true);
  });

  it('reads a document when files are attached', () => {
    const d = heuristicDecision('总结这份文档', [{ name: 'x.pdf' }]);
    expect(d.tools.some(t => t.tool === 'readDocument')).toBe(true);
    expect(d.intent).toBe('read');
  });

  it('answers directly for a plain greeting', () => {
    const d = heuristicDecision('你好', []);
    expect(d.tools).toHaveLength(0);
    expect(d.intent).toBe('answer');
  });
});

describe('titleFromMessage', () => {
  it('trims and limits to 42 characters', () => {
    expect(titleFromMessage('  short title  ')).toBe('short title');
    expect(titleFromMessage('a'.repeat(100))).toHaveLength(42);
  });

  it('falls back to a default when empty', () => {
    expect(titleFromMessage('')).toBe('Synapse Conversation');
  });
});

describe('limits', () => {
  it('exposes the documented safety limits', () => {
    expect(MAX_ITERATIONS).toBe(6);
    expect(MAX_REPLANS).toBe(2);
  });
});
