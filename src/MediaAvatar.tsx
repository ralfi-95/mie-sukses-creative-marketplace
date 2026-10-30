import { useState } from 'react';

export function avatarInitial(name: string) { return name.trim().slice(0, 1).toUpperCase() || '?'; }

export function MediaAvatar({ src, name, className, fallbackClassName = 'avatar-fallback', alt = '' }: {
  src?: string | null; name: string; className: string; fallbackClassName?: string; alt?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && failedSrc !== src
    ? <img className={className} src={src} alt={alt} onError={() => setFailedSrc(src)} />
    : <span className={fallbackClassName} aria-hidden="true">{avatarInitial(name)}</span>;
}
