import { describe, expect, it } from 'vitest';
import { orderTimeline } from './orderTimelineModel';
import { statusTone } from './format';

describe('order history timeline', () => {
  it('uses the current order state and payment state', () => {
    expect(orderTimeline('pending', 'awaiting_payment')[0]).toMatchObject({ label: 'Awaiting Payment', state: 'current' });
    expect(orderTimeline('paid')[0].state).toBe('complete');
    expect(orderTimeline('paid')[1].state).toBe('current');
    expect(orderTimeline('paid').at(-1)?.state).toBe('future');
  });

  it('shows terminal outcomes without later normal progress steps', () => {
    for (const status of ['completed', 'cancelled', 'refunded', 'rejected', 'resolved', 'under_dispute']) {
      const steps = orderTimeline(status);
      expect(steps.at(-1)).toMatchObject({ status, state: 'current' });
      if (status !== 'completed') expect(steps.some(step => step.state === 'future')).toBe(false);
    }
    expect(orderTimeline('completed').at(-1)?.state).toBe('current');
    expect(orderTimeline('cancelled', 'simulated').map(step => step.status)).toEqual(['pending', 'paid', 'cancelled']);
    expect(orderTimeline('future_state')).toHaveLength(1);
  });

  it('keeps cancelled and refunded timeline badges in the danger tone', () => {
    expect(statusTone(orderTimeline('cancelled').at(-1)!.status)).toBe('danger');
    expect(statusTone(orderTimeline('refunded').at(-1)!.status)).toBe('danger');
    expect(statusTone(orderTimeline('completed').at(-1)!.status)).toBe('success');
  });

  it('maps order states to their semantic badge tones', () => {
    expect(Object.fromEntries(['pending', 'awaiting_payment', 'accepted', 'in_progress', 'work_submitted', 'completed', 'cancelled', 'refunded', 'rejected', 'under_dispute'].map(status => [status, statusTone(status)]))).toEqual({
      pending: 'neutral', awaiting_payment: 'neutral', accepted: 'info', in_progress: 'warning', work_submitted: 'purple',
      completed: 'success', cancelled: 'danger', refunded: 'danger', rejected: 'danger', under_dispute: 'orange',
    });
  });
});
