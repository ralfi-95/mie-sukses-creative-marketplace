import { useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { roleLabel } from './format';
import { ThemeToggle } from './FinalFeatures';
import { roleNavItems } from './navigation';

type User = { id: string; display_name: string; role: string; avatar_path?: string | null };
type NavIndicator = { left: number; top: number; width: number; visible: boolean; animated: boolean };

export function SiteNav({ user, cartCount }: { user: User | null; cartCount: number }) {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement | null>(null), indicatorPositioned = useRef(false);
  const [indicator, setIndicator] = useState<NavIndicator | null>(null);
  const active = ({ isActive }: { isActive: boolean }) => isActive ? 'active' : undefined;
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let frame: number | undefined;
    const measure = () => {
      const link = nav.querySelector<HTMLElement>('a.active:not(.wallet-link):not(.cartlink):not(.button):not(.account-link):not([href="/login"]):not([href="/register"])');
      if (!link) {
        setIndicator(current => current ? { ...current, visible: false } : null);
        return;
      }
      const navBounds = nav.getBoundingClientRect(), linkBounds = link.getBoundingClientRect();
      setIndicator({
        left: linkBounds.left - navBounds.left + nav.scrollLeft,
        top: linkBounds.bottom - navBounds.top + nav.scrollTop - 3,
        width: linkBounds.width,
        visible: true,
        animated: indicatorPositioned.current,
      });
      indicatorPositioned.current = true;
    };
    const scheduleMeasure = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = undefined; measure(); });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(nav);
    Array.from(nav.children).filter(child => !child.classList.contains('nav-active-indicator')).forEach(child => observer?.observe(child));
    window.addEventListener('resize', scheduleMeasure);
    nav.addEventListener('scroll', scheduleMeasure, { passive: true });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      nav.removeEventListener('scroll', scheduleMeasure);
    };
  }, [pathname, user?.role]);
  return <nav ref={navRef} aria-label="Main navigation">
    <NavLink to="/" end className={active}>Explore</NavLink>
    {roleNavItems(user?.role).map(item => <NavLink key={item.to} to={item.to} end className={active}>{item.label}</NavLink>)}
    <NavLink to="/orders" className={active}>Orders</NavLink>
    <NavLink to="/wallet" className={`wallet-link ${pathname === '/wallet' ? 'active' : ''}`}><span>Me Wallet</span></NavLink>
    <NavLink to="/cart" className={`cartlink ${pathname === '/cart' ? 'active' : ''}`} aria-label={`Cart, ${cartCount} items`}>
      <svg className="cart-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 8H6M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <b aria-hidden="true">{cartCount}</b>
    </NavLink>
    <ThemeToggle />
    {user ? <span className="nav-account"><Link className={`account-link ${pathname === '/profile' ? 'active' : ''}`} to="/profile" aria-label={`${user.display_name} profile`}>
      {user.avatar_path ? <img className="nav-avatar" src={user.avatar_path} alt="" /> : <span className="avatar-fallback">{user.display_name.slice(0, 1).toUpperCase()}</span>}
      <span className="account-name">{user.display_name}<small className={`role-badge ${user.role}`}>{roleLabel(user.role)}</small></span>
    </Link></span> : <span className="auth-nav"><NavLink to="/login" className={active}>Login</NavLink><NavLink to="/register" className="button small">Register</NavLink></span>}
    <span className={`nav-active-indicator${indicator?.animated ? ' is-animated' : ''}`} aria-hidden="true" style={{ width: indicator?.width ?? 0, opacity: indicator?.visible ? 1 : 0, transform: `translate3d(${indicator?.left ?? 0}px,${indicator?.top ?? 0}px,0)` }} />
  </nav>;
}
