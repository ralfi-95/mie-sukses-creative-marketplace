const categoryLabels: Record<string, string> = {
  'Desain Grafis': 'Graphic Design',
  Fotografi: 'Photography',
  'Video & Foto Editing': 'Video & Photo Editing',
  'UI/UX Design': 'UI/UX Design',
}

export function categoryDisplayName(name: string | null | undefined): string {
  return name ? categoryLabels[name] ?? name : ''
}
