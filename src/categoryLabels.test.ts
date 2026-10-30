import { describe, expect, it } from 'vitest'
import { categoryDisplayName, parseCategoryResponse } from './categoryLabels'

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

describe('parseCategoryResponse', () => {
  it('accepts the API category envelope', () => {
    expect(parseCategoryResponse({ categories: [{ id: 'category-1', slug: 'design', name: 'Desain Grafis' }] }))
      .toEqual([{ id: 'category-1', slug: 'design', name: 'Desain Grafis' }])
  })

  it('preserves a genuinely empty category list', () => {
    expect(parseCategoryResponse({ categories: [] })).toEqual([])
  })

  it.each([undefined, null, {}, { categories: null }, { categories: [{}] }])(
    'rejects a missing or malformed categories response (%s)', (response) => {
      expect(() => parseCategoryResponse(response)).toThrow(/categories service returned/)
    },
  )
})
