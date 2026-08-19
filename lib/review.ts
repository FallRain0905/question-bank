// 间隔重复调度 —— SM-2 简化版纯函数（可被 vitest 覆盖）
// 参考 SuperMemo SM-2，但按项目需求简化为「答对间隔 × 增长因子、答错回退」模型。

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface CardState {
  /** 记忆难度因子（ease factor），越大间隔增长越快，范围 [MIN_EASE, MAX_EASE] */
  ease: number;
  /** 当前间隔（天） */
  intervalDays: number;
  /** 连续答对次数（repetition count），决定前两次的固定间隔 */
  reps: number;
}

export const MIN_EASE = 1.3;
export const MAX_EASE = 2.5;
export const DEFAULT_EASE = 2.5;

export const DEFAULT_STATE: CardState = { ease: DEFAULT_EASE, intervalDays: 0, reps: 0 };

/** 三键 UI → SM-2 质量分（0-5）。≤3（again/hard）视为「回退」，good/easy 才增长间隔。 */
const GRADE_QUALITY: Record<Grade, number> = { again: 0, hard: 3, good: 4, easy: 5 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 根据本次评分计算下一次排期状态。
 * - 答错（again）：间隔归零、难度因子 -0.2，立即进入重做队列。
 * - 重来（hard）：难度因子略降、间隔回退为 1 天，明天再出现。
 * - 答对（good/easy）：重复次数 +1；前两次固定为 1 天 / 6 天，之后间隔 × 难度因子；因子 +0.1。
 */
export function nextSchedule(grade: Grade, prev: CardState = DEFAULT_STATE): CardState {
  const quality = GRADE_QUALITY[grade];
  if (quality <= 3) {
    const ease = clamp(prev.ease - 0.2, MIN_EASE, MAX_EASE);
    return {
      ease,
      intervalDays: grade === 'again' ? 0 : 1,
      reps: 0,
    };
  }

  const reps = prev.reps + 1;
  let intervalDays: number;
  if (reps === 1) {
    intervalDays = 1;
  } else if (reps === 2) {
    intervalDays = 6;
  } else {
    intervalDays = Math.max(1, Math.round(prev.intervalDays * prev.ease));
  }

  const ease = clamp(prev.ease + 0.1, MIN_EASE, MAX_EASE);
  return { ease, intervalDays, reps };
}

/**
 * 由间隔天数计算到期时间。intervalDays 为 0 表示「现在到期」（重做队列）。
 */
export function dueAtFor(intervalDays: number, now: Date): Date {
  const due = new Date(now.getTime());
  due.setDate(due.getDate() + intervalDays);
  return due;
}

/** 判断是否到期（due_at <= now）。 */
export function isDue(dueAt: string | Date, now: Date): boolean {
  return new Date(dueAt).getTime() <= now.getTime();
}

/** 本地日期键（YYYY-MM-DD），用于连续打卡统计。 */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 连续打卡天数：从今天（或昨天，若今天尚未复习）起向前连续有复习记录的天数。
 * @param reviewedAts 历史复习时间戳列表
 */
export function computeStreak(reviewedAts: (string | Date)[], now: Date): number {
  const days = new Set(reviewedAts.map(ts => dayKey(new Date(ts))));
  let streak = 0;
  const cursor = new Date(now.getTime());
  if (!days.has(dayKey(cursor))) {
    // 今天还没复习，允许从昨天开始连续
    cursor.setDate(cursor.getDate() - 1);
  }
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
