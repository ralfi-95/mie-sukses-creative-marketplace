type RoleNavItem = { label: string; to: string };

export function roleNavItems(role?: string): RoleNavItem[] {
  if (role === 'seller') return [
    { label: 'My Services', to: '/seller' },
    { label: 'Projects', to: '/seller/projects' },
    { label: 'Sales', to: '/seller/orders' },
  ];
  if (role === 'admin') return [
    { label: 'Administrative History', to: '/admin/transactions' },
    { label: 'Issues', to: '/admin/issues' },
    { label: 'Administration', to: '/admin' },
  ];
  return [];
}
