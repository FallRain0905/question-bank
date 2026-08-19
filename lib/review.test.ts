import { describe, it, expect } from 'vitest';
import {
  nextSchedule,
  dueAtFor,
  isDue,
  dayKey,
  computeStreak,
  DEFAULT_STATE,
  MIN_EASE,
  MAX_EASE,
  type CardState,
} from './review';

describe('nextSchedule 排期不变量', () => {
  it('答对（good）后间隔应增长', () => {
    const prev: CardState = { ease: 2.5, intervalDays: 6, reps: 2 };
    const next = nextSchedule('good', prev);
    // 第 3 次开始：6 * 2.5 = 15 天
    expect(next.intervalDays).toBe(15);
    expect(next.reps).toBe(3);
  });

  it('首次答对间隔为 1 天，第二次为 6 天', () => {
    expect(nextSchedule('good', DEFAULT_STATE).intervalDays).toBe(1);
    expect(nextSchedule('good', nextSchedule('good', DEFAULT_STATE)).intervalDays).toBe(6);
  });

  it('答错（again）间隔归零并降低难度因子，进入重做队列', () => {
    const prev: CardState = { ease: 2.5, intervalDays: 15, reps: 3 };
    const next = nextSchedule('again', prev);
    expect(next.intervalDays).toBe(0);
    expect(next.reps).toBe(0);
    expect(next.ease).toBeCloseTo(2.3, 5);
  });

  it('重来（hard）间隔回退为 1 天', () => {
    const prev: CardState = { ease: 2.5, intervalDays: 15, reps: 3 };
    const next = nextSchedule('hard', prev);
    expect(next.intervalDays).toBe(1);
    expect(next.reps).toBe(0);
  });

  it('难度因子始终被夹在 [MIN_EASE, MAX_EASE] 区间', () => {
    let state: CardState = { ease: MIN_EASE, intervalDays: 30, reps: 5 };
    for (let i = 0; i < 20; i++) state = nextSchedule('again', state);
    expect(state.ease).toBe(MIN_EASE);

    state = { ease: MAX_EASE, intervalDays: 30, reps: 5 };
    for (let i = 0; i < 20; i++) state = nextSchedule('easy', state);
    expect(state.ease).toBe(MAX_EASE);
  });

  it('连续答对会持续增大间隔（不会停滞）', () => {
    let state = DEFAULT_STATE;
    let prevInterval = 0;
    for (let i = 0; i < 5; i++) {
      state = nextSchedule('good', state);
      if (state.reps >= 3) {
        expect(state.intervalDays).toBeGreaterThan(prevInterval);
      }
      prevInterval = state.intervalDays;
    }
    expect(state.reps).toBe(5);
  });
});

describe('dueAtFor / isDue', () => {
  const now = new Date('2026-08-17T10:00:00Z');

  it('间隔为 0 时到期时间为现在', () => {
    expect(dueAtFor(0, now).getTime()).toBe(now.getTime());
  });

  it('间隔为 N 天时到期时间推迟 N 天', () => {
    const due = dueAtFor(3, now);
    expect(due.getTime() - now.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('isDue 判断到期边界', () => {
    const due = dueAtFor(1, now);
    expect(isDue(due, new Date(due.getTime() + 1000))).toBe(true);
    expect(isDue(due, new Date(due.getTime() - 1000))).toBe(false);
  });
});

describe('computeStreak 连续打卡', () => {
  const today = new Date('2026-08-17T10:00:00Z');

  it('空历史返回 0', () => {
    expect(computeStreak([], today)).toBe(0);
  });

  it('连续三天（含今天）返回 3', () => {
    const reviewed = [
      '2026-08-17T09:00:00Z',
      '2026-08-16T09:00:00Z',
      '2026-08-15T09:00:00Z',
    ];
    expect(computeStreak(reviewed, today)).toBe(3);
  });

  it('今天还没复习时从昨天起算', () => {
    const reviewed = ['2026-08-16T09:00:00Z', '2026-08-15T09:00:00Z'];
    expect(computeStreak(reviewed, today)).toBe(2);
  });

  it('中断后重新计数', () => {
    const reviewed = ['2026-08-17T09:00:00Z', '2026-08-15T09:00:00Z'];
    expect(computeStreak(reviewed, today)).toBe(1);
  });

  it('同一天多次复习只算一天', () => {
    const reviewed = ['2026-08-17T09:00:00Z', '2026-08-17T12:00:00Z'];
    expect(computeStreak(reviewed, today)).toBe(1);
  });
});

describe('dayKey', () => {
  it('本地日期格式化为 YYYY-MM-DD', () => {
    // 使用本地时区构造，避免 toISOString 的 UTC 偏移干扰
    const d = new Date(2026, 7, 17); // 2026-08-17 本地
    expect(dayKey(d)).toBe('2026-08-17');
  });
});
