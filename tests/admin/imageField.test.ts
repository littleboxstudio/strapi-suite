import { describe, it, expect } from 'vitest';
import {
  absoluteUrl,
  addImage,
  buildFieldUploadForm,
  canAdd,
  fieldConfig,
  isImageAsset,
  moveImage,
  removeImage,
  replaceImage,
  sameOrder,
  thumbnailUrl,
  toGallery,
  toSingle,
  uploadErrorKey,
  type MediaValue,
} from '../../admin/src/components/imageField/imageFieldValue';

const media = (id: number, extra: Partial<MediaValue> = {}): MediaValue => ({
  id,
  documentId: `doc${id}`,
  name: `image-${id}.webp`,
  alternativeText: null,
  caption: null,
  width: 800,
  height: 600,
  formats: null,
  hash: `h${id}`,
  ext: '.webp',
  mime: 'image/webp',
  size: 12.5,
  url: `/uploads/image_${id}.webp`,
  previewUrl: null,
  provider: 'local',
  provider_metadata: null,
  createdAt: null,
  updatedAt: null,
  ...extra,
});

const ids = (list: MediaValue[]) => list.map((i) => i.id);

describe('fieldConfig', () => {
  it('defaults to a free single image', () => {
    expect(fieldConfig(undefined)).toEqual({
      mode: 'single',
      width: undefined,
      height: undefined,
      sizeLocked: false,
      maxImages: null,
    });
  });

  it('locks the size only when both sides are set', () => {
    expect(fieldConfig({ width: 800, height: 600, lockSize: true }).sizeLocked).toBe(true);
    expect(fieldConfig({ width: 800, lockSize: true }).sizeLocked).toBe(false);
    expect(fieldConfig({ width: 800, height: 600, lockSize: false }).sizeLocked).toBe(false);
  });

  it('ignores invalid sizes and reads numeric strings', () => {
    expect(fieldConfig({ width: '1200', height: 0 })).toMatchObject({
      width: 1200,
      height: undefined,
    });
    expect(fieldConfig({ width: 6001, height: 1.5 })).toMatchObject({
      width: undefined,
      height: undefined,
    });
  });

  it('reads maxImages in gallery mode only', () => {
    expect(fieldConfig({ mode: 'gallery', maxImages: 3 }).maxImages).toBe(3);
    expect(fieldConfig({ mode: 'gallery', maxImages: '' }).maxImages).toBeNull();
    expect(fieldConfig({ mode: 'gallery', maxImages: 0 }).maxImages).toBeNull();
    expect(fieldConfig({ mode: 'single', maxImages: 3 }).maxImages).toBeNull();
  });
});

describe('toSingle / toGallery', () => {
  it('reads objects, arrays, JSON text and empty values', () => {
    expect(toSingle(null)).toBeNull();
    expect(toSingle(media(1))?.id).toBe(1);
    expect(toSingle(JSON.stringify(media(2)))?.id).toBe(2);
    expect(toSingle([media(3), media(4)])?.id).toBe(3);
    expect(toSingle({ id: 'x' })).toBeNull();
    expect(toSingle('not json')).toBeNull();

    expect(toGallery(null)).toEqual([]);
    expect(ids(toGallery([media(1), { foo: 1 }, media(2)]))).toEqual([1, 2]);
    expect(ids(toGallery(media(5)))).toEqual([5]);
    expect(ids(toGallery(JSON.stringify([media(7)])))).toEqual([7]);
  });
});

describe('gallery editing', () => {
  const list = [media(1), media(2), media(3)];

  it('adds at the end unless full or already present', () => {
    expect(ids(addImage(list, media(4), null))).toEqual([1, 2, 3, 4]);
    expect(ids(addImage(list, media(4), 3))).toEqual([1, 2, 3]);
    expect(ids(addImage(list, media(2), null))).toEqual([1, 2, 3]);
  });

  it('knows when the maximum is reached', () => {
    expect(canAdd(list, null)).toBe(true);
    expect(canAdd(list, 4)).toBe(true);
    expect(canAdd(list, 3)).toBe(false);
  });

  it('removes and replaces in place', () => {
    expect(ids(removeImage(list, 2))).toEqual([1, 3]);
    const replaced = replaceImage(list, 2, media(9));
    expect(ids(replaced)).toEqual([1, 9, 3]);
    const alt = replaceImage(list, 2, media(2, { alternativeText: 'A cat' }));
    expect(alt[1].alternativeText).toBe('A cat');
  });

  it('moves an image keeping the others in order', () => {
    expect(ids(moveImage(list, 1, 2))).toEqual([2, 3, 1]);
    expect(ids(moveImage(list, 3, 0))).toEqual([3, 1, 2]);
    expect(ids(moveImage(list, 2, 99))).toEqual([1, 3, 2]);
    expect(moveImage(list, 42, 0)).toBe(list);
    expect(sameOrder(list, [media(1), media(2), media(3)])).toBe(true);
    expect(sameOrder(list, moveImage(list, 1, 1))).toBe(false);
  });
});

describe('urls', () => {
  it('prefixes relative urls with the backend url', () => {
    expect(absoluteUrl('/uploads/a.webp', 'http://localhost:1337')).toBe(
      'http://localhost:1337/uploads/a.webp'
    );
    expect(absoluteUrl('/uploads/a.webp', 'http://localhost:1337/')).toBe(
      'http://localhost:1337/uploads/a.webp'
    );
    expect(absoluteUrl('https://cdn.example.com/a.webp', 'http://x')).toBe(
      'https://cdn.example.com/a.webp'
    );
    expect(absoluteUrl(null, 'http://x')).toBeNull();
  });

  it('prefers the thumbnail format', () => {
    expect(thumbnailUrl(media(1))).toBe('/uploads/image_1.webp');
    expect(
      thumbnailUrl(
        media(1, { formats: { small: { url: '/s.webp' }, thumbnail: { url: '/t.webp' } } })
      )
    ).toBe('/t.webp');
  });
});

describe('isImageAsset', () => {
  it('accepts image assets only', () => {
    expect(isImageAsset({ id: 3, mime: 'image/png' })).toBe(true);
    expect(isImageAsset({ id: 3, mime: 'application/pdf' })).toBe(false);
    expect(isImageAsset(null)).toBe(false);
  });
});

describe('buildFieldUploadForm', () => {
  const transform = {
    mode: 'crop' as const,
    width: 100,
    height: 50,
    crop: { x: 0, y: 0, width: 200, height: 100 },
  };

  it('sends the file, transform and trimmed alt text', () => {
    const file = new File([new Uint8Array([1, 2])], 'photo.jpg', { type: 'image/jpeg' });
    const form = buildFieldUploadForm({ file }, transform, '  A dog ');
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('sourceFileId')).toBeNull();
    expect(JSON.parse(String(form.get('transform')))).toEqual(transform);
    expect(form.get('alternativeText')).toBe('A dog');
  });

  it('sends a Media Library source by id', () => {
    const form = buildFieldUploadForm({ sourceFileId: 12 }, transform, '');
    expect(form.get('file')).toBeNull();
    expect(form.get('sourceFileId')).toBe('12');
  });
});

describe('uploadErrorKey', () => {
  it('maps the server answers to messages', () => {
    expect(uploadErrorKey(403, null)).toBe('upload.forbidden');
    expect(uploadErrorKey(400, 'IMAGE_TOO_LARGE')).toBe('upload.tooLarge');
    expect(uploadErrorKey(400, 'INVALID_IMAGE')).toBe('upload.invalidImage');
    expect(uploadErrorKey(400, 'SOURCE_NOT_FOUND')).toBe('upload.sourceError');
    expect(uploadErrorKey(500, null)).toBe('upload.error');
  });
});
