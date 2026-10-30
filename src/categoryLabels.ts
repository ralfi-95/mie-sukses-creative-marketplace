const categoryLabels: Record<string, string> = {
  'Desain Grafis': 'Graphic Design',
  Fotografi: 'Photography',
  'Video & Foto Editing': 'Video & Photo Editing',
  'UI/UX Design': 'UI/UX Design',
}

export type Category = { id: string; slug: string; name: string }

export function parseCategoryResponse(value: unknown): Category[] {
  if (typeof value !== 'object' || value === null || !('categories' in value) || !Array.isArray(value.categories)) {
    throw new Error('The categories service returned an invalid response.')
  }

  return value.categories.map((category: unknown) => {
    if (typeof category !== 'object' || category === null || !('id' in category) || !('slug' in category) || !('name' in category)
      || typeof category.id !== 'string' || typeof category.slug !== 'string' || typeof category.name !== 'string') {
      throw new Error('The categories service returned an invalid category.')
    }
    return { id: category.id, slug: category.slug, name: category.name }
  })
}

export function categoryDisplayName(name: string | null | undefined): string {
  return name ? categoryLabels[name] ?? name : ''
}
