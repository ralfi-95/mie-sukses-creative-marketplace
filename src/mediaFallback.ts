export function showThumbnailFallback(event: { currentTarget: HTMLImageElement }) {
  if (!event.currentTarget.src.endsWith('/demo-design.svg')) event.currentTarget.src = '/demo-design.svg';
}
