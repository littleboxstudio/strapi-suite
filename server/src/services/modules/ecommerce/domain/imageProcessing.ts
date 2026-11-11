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
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const invalid = () => new Error('INVALID_IMAGE');

const validDimension = (n: number) =>
  Number.isInteger(n) && n > 0 && n <= MAX_IMAGE_DIMENSION;

// Size as displayed by browsers, i.e. after applying the EXIF orientation.
function orientedSize(metadata: Metadata): { width: number; height: number } | null {
  const auto: Partial<Metadata['autoOrient']> | undefined = metadata.autoOrient;
  if (auto?.width && auto?.height) return { width: auto.width, height: auto.height };
  if (!metadata.width || !metadata.height) return null;
  const swap = (metadata.orientation ?? 1) >= 5;
  return swap
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

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
  const size = orientedSize(metadata);
  if (!size) throw invalid();

  // Auto-orient first so crop coordinates refer to the frame the browser showed.
  let pipeline = sharp(input).rotate();
  if (t.mode === 'crop') {
    const { x, y, width, height } = t.crop;
    const ints = [x, y, width, height].every(Number.isInteger);
    if (
      !ints ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > size.width ||
      y + height > size.height
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

/** Store logo: auto-oriented, fitted inside 480x96 without enlarging, as PNG (keeps transparency). */
export async function processLogo(
  input: Buffer
): Promise<{ buffer: Buffer; width: number; height: number; sizeBytes: number }> {
  try {
    const metadata = await sharp(input).metadata();
    if (!orientedSize(metadata)) throw invalid();
    const { data, info } = await sharp(input)
      .rotate()
      .resize(480, 96, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, sizeBytes: data.length };
  } catch {
    throw invalid();
  }
}
