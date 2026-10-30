import { describe, expect, it } from 'vitest';
import { roleNavItems } from './navigation';

describe('role-specific navigation', () => {
  it('keeps seller tools after shared navigation in the requested order', () => {
    expect(roleNavItems('seller').map(item => item.label)).toEqual(['My Services', 'Projects', 'Sales']);
  });
  it('routes Administration directly to its own page', () => {
    const items = roleNavItems('admin');
    expect(items.slice(0, 2).map(item => item.label)).toEqual(['Administrative History', 'Issues']);
    expect(items[2]).toEqual({ label: 'Administration', to: '/admin' });
    expect(roleNavItems('buyer')).toEqual([]);
  });
});
