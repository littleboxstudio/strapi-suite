import { describe, it, expect } from 'vitest';
import {
  MEDIA_VALUE_KEYS,
  toMediaValue,
} from '../../../server/src/services/modules/image-field/domain/mediaValue';

describe('toMediaValue', () => {
  it('picks exactly the media keys, drops the rest and fills missing ones with null', () => {
    const created = new Date('2026-11-26T10:00:00.000Z');
    const value = toMediaValue({
      id: 5,
      documentId: 'abc',
      name: 'photo.webp',
      alternativeText: 'Alt',
      width: 800,
      height: 600,
      formats: { thumbnail: { url: '/uploads/t.webp' } },
      hash: 'photo_123',
      ext: '.webp',
      mime: 'image/webp',
      size: 12.3,
      url: '/uploads/photo_123.webp',
      provider: 'local',
      createdAt: created,
      updatedAt: '2026-11-26T11:00:00.000Z',
      folder: { id: 1 },
      folderPath: '/1',
      related: [],
      sizeInBytes: 12345,
    });
    expect(Object.keys(value).sort()).toEqual([...MEDIA_VALUE_KEYS].sort());
    expect(value).toMatchObject({
      id: 5,
      documentId: 'abc',
      caption: null,
      previewUrl: null,
      provider_metadata: null,
      formats: { thumbnail: { url: '/uploads/t.webp' } },
      createdAt: '2026-11-26T10:00:00.000Z',
      updatedAt: '2026-11-26T11:00:00.000Z',
    });
    expect((value as any).folder).toBeUndefined();
  });
});
