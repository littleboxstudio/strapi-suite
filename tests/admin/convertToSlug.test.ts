import { describe, it, expect } from 'vitest';
import { convertToSlug } from '../../admin/src/core/utils/convertToSlug';

describe('convertToSlug', () => {
  it('cleans a finished slug', () => {
    expect(convertToSlug('About Us')).toBe('about-us');
    expect(convertToSlug('  --Coração & Alma!--  ')).toBe('coracao-alma');
    expect(convertToSlug('about-')).toBe('about');
  });

  it('keeps the trailing hyphen while the slug is typed, so the next word can follow', () => {
    const typed = 'About Us'
      .split('')
      .reduce((value, char) => convertToSlug(value + char, undefined, { keepTrailingHyphen: true }), '');
    expect(typed).toBe('about-us');
    expect(convertToSlug('about ', undefined, { keepTrailingHyphen: true })).toBe('about-');
    expect(convertToSlug('about--', undefined, { keepTrailingHyphen: true })).toBe('about-');
  });

  it('still drops leading hyphens while typing', () => {
    expect(convertToSlug('-about', undefined, { keepTrailingHyphen: true })).toBe('about');
  });

  it('typing then finishing gives the same slug as converting at once', () => {
    const typed = 'Summer Sale 2026 '
      .split('')
      .reduce((value, char) => convertToSlug(value + char, undefined, { keepTrailingHyphen: true }), '');
    expect(convertToSlug(typed)).toBe(convertToSlug('Summer Sale 2026 '));
  });
});
