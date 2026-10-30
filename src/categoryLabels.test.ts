import { describe, expect, it } from 'vitest'
import { categoryDisplayName } from './categoryLabels'

describe('categoryDisplayName', () => {
  it.each([
    ['Desain Grafis', 'Graphic Design'],
    ['Fotografi', 'Photography'],
    ['Video & Foto Editing', 'Video & Photo Editing'],
    ['UI/UX Design', 'UI/UX Design'],
  ])('displays %s as %s', (source, display) => {
    expect(categoryDisplayName(source)).toBe(display)
  })

  it('preserves unknown category labels', () => {
    expect(categoryDisplayName('New Category')).toBe('New Category')
  })
})
