import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { processImage } from '../../../../server/src/services/modules/ecommerce/domain/imageProcessing';

const makePng = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#f00' } })
    .png()
    .toBuffer();

const makeRotatedJpeg = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#0f0' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

describe('processImage', () => {
  it('crops in the EXIF-oriented frame (orientation 6)', async () => {
    const out = await processImage(await makeRotatedJpeg(), {
      mode: 'crop',
      width: 150,
      height: 200,
      crop: { x: 0, y: 0, width: 300, height: 400 },
    });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([150, 200]);
    expect([out.width, out.height]).toEqual([150, 200]);
  });

  it('resizes an EXIF-oriented image to the requested size', async () => {
    const out = await processImage(await makeRotatedJpeg(), { mode: 'resize', width: 150, height: 200 });
    const meta = await sharp(out.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([150, 200]);
  });

  it('rejects a crop that only fits the raw (unoriented) frame', async () => {
    await expect(
      processImage(await makeRotatedJpeg(), {
        mode: 'crop',
        width: 100,
        height: 100,
        crop: { x: 0, y: 0, width: 400, height: 300 },
      })
    ).rejects.toThrow('INVALID_IMAGE');
  });

  it('crops then resizes to webp', async () => {
    const out = await processImage(await makePng(), {
      mode: 'crop',
      width: 120,
      height: 120,
      crop: { x: 50, y: 0, width: 300, height: 300 },
    });
    expect(out.width).toBe(120);
    expect(out.height).toBe(120);
    expect(out.sizeBytes).toBe(out.buffer.length);
    expect((await sharp(out.buffer).metadata()).format).toBe('webp');
  });

  it('resizes to webp', async () => {
    const out = await processImage(await makePng(), { mode: 'resize', width: 200, height: 150 });
    expect(out.width).toBe(200);
    expect(out.height).toBe(150);
    expect((await sharp(out.buffer).metadata()).format).toBe('webp');
  });

  it('rejects unreadable input', async () => {
    await expect(
      processImage(Buffer.from('nope'), { mode: 'resize', width: 10, height: 10 })
    ).rejects.toThrow('INVALID_IMAGE');
  });

  it('rejects crop outside bounds', async () => {
    await expect(
      processImage(await makePng(), {
        mode: 'crop',
        width: 100,
        height: 100,
        crop: { x: 350, y: 0, width: 300, height: 300 },
      })
    ).rejects.toThrow('INVALID_IMAGE');
  });

  it('rejects invalid dimensions', async () => {
    const png = await makePng();
    await expect(processImage(png, { mode: 'resize', width: 0, height: 10 })).rejects.toThrow('INVALID_IMAGE');
    await expect(processImage(png, { mode: 'resize', width: 6001, height: 10 })).rejects.toThrow('INVALID_IMAGE');
  });
});
