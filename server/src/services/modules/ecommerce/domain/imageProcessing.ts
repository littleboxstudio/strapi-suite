import sharp, { type Metadata } from 'sharp';

export type ImageTransform =
  | {
      mode: 'crop';
      width: number;
      height: number;
      crop: { x: number; y: number; width: number; height: number };
    }
  | { mode: 'resize'; width: number; height: number };

export const MAX_IMAGE_DIMENSION = 6000;

const invalid = () => new Error('INVALID_IMAGE');

const validDimension = (n: number) =>
  Number.isInteger(n) && n > 0 && n <= MAX_IMAGE_DIMENSION;

export async function processImage(
  input: Buffer,
  t: ImageTransform
): Promise<{ buffer: Buffer; width: number; height: number; sizeBytes: number }> {
  if (!validDimension(t.width) || !validDimension(t.height)) throw invalid();

  let metadata: Metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw invalid();
  }
  if (!metadata.width || !metadata.height) throw invalid();

  let pipeline = sharp(input);
  if (t.mode === 'crop') {
    const { x, y, width, height } = t.crop;
    const ints = [x, y, width, height].every(Number.isInteger);
    if (
      !ints ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > metadata.width ||
      y + height > metadata.height
    ) {
      throw invalid();
    }
    pipeline = pipeline.extract({ left: x, top: y, width, height });
  }

  try {
    const buffer = await pipeline
      .resize(t.width, t.height, { fit: 'fill' })
      .webp({ quality: 80 })
      .toBuffer();
    return { buffer, width: t.width, height: t.height, sizeBytes: buffer.length };
  } catch {
    throw invalid();
  }
}
