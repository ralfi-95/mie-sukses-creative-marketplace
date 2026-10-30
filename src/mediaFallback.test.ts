import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MediaAvatar, avatarInitial } from './MediaAvatar.js';
import { showThumbnailFallback } from './mediaFallback.js';

describe('missing media fallbacks', () => {
  it('keeps initials for a missing avatar', () => {
    expect(avatarInitial('  Sari W.')).toBe('S');
    expect(avatarInitial('')).toBe('?');
    expect(renderToStaticMarkup(createElement(MediaAvatar, { src: null, name: 'Sari W.', className: 'nav-avatar' }))).toContain('>S</span>');
  });

  it('uses the existing demo artwork for a missing service thumbnail without retry loops', () => {
    const image = { src: '/media/missing.jpg', onerror: () => {} } as unknown as HTMLImageElement;
    showThumbnailFallback({ currentTarget: image });
    expect(image.src).toBe('/demo-design.svg');
    showThumbnailFallback({ currentTarget: image });
    expect(image.src).toBe('/demo-design.svg');
  });
});
