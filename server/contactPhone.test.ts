import { describe, expect, it } from 'vitest';
import { isValidPhone, normalizePhone } from './contactPhone.js';

describe('contact phone normalization', () => {
  it.each([
    ['0812 3456 7890', '+6281234567890'],
    ['812-3456-7890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['+62 812-3456-7890', '+6281234567890'],
    ['+62 0812-3456-7890', '+6281234567890'],
    ['+62 62 812-3456-7890', '+6281234567890'],
    ['0062 81234567890', '+6281234567890'],
    ['81234567890', '+6281234567890'],
  ])('normalizes %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));
  it('enforces Indonesian format and 13 total digits', () => {
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone('+62')).toBe(false);
    expect(isValidPhone('08123')).toBe(false);
    expect(isValidPhone('call me')).toBe(false);
    expect(isValidPhone('+1 202 555 0100')).toBe(false);
    expect(isValidPhone('812345678901')).toBe(false);
    expect(normalizePhone('81234567890').replace(/\D/g, '')).toHaveLength(13);
  });
});
