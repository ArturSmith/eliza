import { describe, it, expect } from 'vitest';
import { actionQuestionRanges, actionQuestions } from '../packages/contracts/src/index';
describe('manager question comparisons', () => {
  it('has six stable question sections', () =>
    expect(actionQuestions.map((q) => q[0])).toEqual([
      'order',
      'expiry',
      'overstock',
      'costs',
      'demand',
      'assortment',
    ]));
  it('compares today with the same weekday last week', () =>
    expect(actionQuestionRanges('today', '2026-11-21')).toEqual({
      current: { from: '2026-11-21', to: '2026-11-21' },
      previous: { from: '2026-11-14', to: '2026-11-14' },
    }));
  it('excludes incomplete days and uses equal adjacent windows across a year boundary', () => {
    expect(actionQuestionRanges('week', '2027-01-03')).toEqual({
      current: { from: '2026-12-27', to: '2027-01-02' },
      previous: { from: '2026-12-20', to: '2026-12-26' },
    });
    expect(actionQuestionRanges('month', '2027-01-03')).toEqual({
      current: { from: '2026-12-06', to: '2027-01-02' },
      previous: { from: '2026-11-08', to: '2026-12-05' },
    });
  });
});
