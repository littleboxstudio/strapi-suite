import { describe, it, expect } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  buildUploadForm,
  formatBytes,
  imageErrorCode,
  isValidDimension,
  parseDimension,
} from '../../../admin/src/ecommerce/utils/imageUpload';

describe('formatBytes', () => {
  it('shows bytes under 1 KB as KB with one decimal', () => {
    expect(formatBytes(512)).toBe('0.5 KB');
  });
  it('shows KB under 1 MB', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(153_600)).toBe('150.0 KB');
  });
  it('shows MB from 1 MB on', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('dimensions', () => {
  it('accepts integers from 1 to 6000', () => {
    expect(isValidDimension(1)).toBe(true);
    expect(isValidDimension(6000)).toBe(true);
    expect(isValidDimension(0)).toBe(false);
    expect(isValidDimension(6001)).toBe(false);
    expect(isValidDimension(12.5)).toBe(false);
    expect(isValidDimension(NaN)).toBe(false);
  });
  it('parses digits only, NaN otherwise', () => {
    expect(parseDimension('1200')).toBe(1200);
    expect(parseDimension(' 800 ')).toBe(800);
    expect(parseDimension('')).toBeNaN();
    expect(parseDimension('12.5')).toBeNaN();
    expect(parseDimension('-3')).toBeNaN();
  });
});

describe('MAX_IMAGE_BYTES', () => {
  it('is 15 MB', () => {
    expect(MAX_IMAGE_BYTES).toBe(15 * 1024 * 1024);
  });
});

describe('imageErrorCode', () => {
  it('reads the code nested by ctx.badRequest details', () => {
    const err = {
      response: { data: { error: { details: { error: { code: 'INVALID_IMAGE' } } } } },
    };
    expect(imageErrorCode(err)).toBe('INVALID_IMAGE');
  });
  it('returns null for anything else', () => {
    expect(imageErrorCode({ response: { data: { error: { message: 'x' } } } })).toBeNull();
    expect(imageErrorCode(new Error('network'))).toBeNull();
    expect(imageErrorCode(undefined)).toBeNull();
  });
});

describe('buildUploadForm', () => {
  const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

  it('sends file, JSON transform and productId', () => {
    const transform = {
      mode: 'crop' as const,
      width: 1200,
      height: 1200,
      crop: { x: 500, y: 0, width: 3000, height: 3000 },
    };
    const form = buildUploadForm(file, transform, { productId: 7 });
    expect(form.get('file')).toBeInstanceOf(File);
    expect(JSON.parse(form.get('transform') as string)).toEqual(transform);
    expect(form.get('productId')).toBe('7');
    expect(form.has('variantId')).toBe(false);
  });

  it('sends variantId when the owner is a variant', () => {
    const form = buildUploadForm(file, { mode: 'resize', width: 800, height: 600 }, { variantId: 3 });
    expect(form.get('variantId')).toBe('3');
    expect(form.has('productId')).toBe(false);
  });
});
