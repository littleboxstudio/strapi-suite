import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { processImage } from '../../../../server/src/services/modules/ecommerce/domain/imageProcessing';

const makePng = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#f00' } })
    .png()
    .toBuffer();

describe('processImage', () => {
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
