import { describe, it, expect } from 'vitest';
import { buildLogoForm, logoFileError } from '../../../admin/src/ecommerce/utils/storeLogo';

describe('logoFileError', () => {
  it('accepts up to 400 KB and rejects anything larger', () => {
    expect(logoFileError({ size: 400 * 1024, type: 'image/png' })).toBeNull();
    expect(logoFileError({ size: 400 * 1024 + 1, type: 'image/png' })).toBe('too_large');
  });
  it('rejects non-image types', () => {
    expect(logoFileError({ size: 10, type: 'application/pdf' })).toBe('invalid_type');
  });
  it('accepts SVG and the other image types', () => {
    expect(logoFileError({ size: 10, type: 'image/svg+xml' })).toBeNull();
    expect(logoFileError({ size: 10, type: 'image/webp' })).toBeNull();
  });
});

describe('buildLogoForm', () => {
  it('puts the file in the "file" field', () => {
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    expect(buildLogoForm(file).get('file')).toBe(file);
  });
});
