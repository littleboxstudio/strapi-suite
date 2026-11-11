import crypto from 'crypto';
import { Readable } from 'stream';
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { slugify } from './domain/catalog';
import { processImage, ImageTransform } from './domain/imageProcessing';

export type ImageRecord = {
  id: number;
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  url: string;
  position: number;
};

const EcommerceImageService = ({ strapi }: { strapi: Core.Strapi }) => {
  const imageUid = (): string => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce.image;
  };
  const provider = (): any => (strapi.plugin('upload') as any).provider;

  return {
    async upload(params: {
      buffer: Buffer;
      originalName: string;
      transform: ImageTransform;
      owner: { productId?: number; variantId?: number };
    }): Promise<ImageRecord> {
      const { buffer, width, height, sizeBytes } = await processImage(
        params.buffer,
        params.transform
      );

      const base = slugify(params.originalName.replace(/\.[^./\\]+$/, '')) || 'image';
      const hash = `${base}_${crypto.randomBytes(5).toString('hex')}`;
      const file: any = {
        name: `${base}.webp`,
        hash,
        ext: '.webp',
        mime: 'image/webp',
        size: Math.round((sizeBytes / 1024) * 100) / 100,
        width,
        height,
        buffer,
        getStream: () => Readable.from(buffer),
      };
      await provider().upload(file);

      const { productId, variantId } = params.owner;
      const ownerWhere = variantId ? { variant: variantId } : { product: productId };
      const siblings: { position: number }[] = await strapi.db.query(imageUid()).findMany({
        where: ownerWhere,
        select: ['position'],
      });
      const position = siblings.reduce((max, s) => Math.max(max, s.position ?? 0), 0) + 1;

      const providerName: string =
        (strapi.config.get('plugin::upload') as any)?.provider || 'local';
      const record = await strapi.db.query(imageUid()).create({
        data: {
          ...(productId ? { product: productId } : {}),
          ...(variantId ? { variant: variantId } : {}),
          position,
          name: file.name,
          width,
          height,
          sizeBytes,
          mime: file.mime,
          ext: file.ext,
          hash,
          url: file.url,
          provider: providerName,
          providerMetadata: file.provider_metadata ?? null,
        },
      });

      return {
        id: record.id,
        name: record.name,
        width: record.width,
        height: record.height,
        sizeBytes: record.sizeBytes,
        url: record.url,
        position: record.position,
      };
    },

    async remove(imageId: number): Promise<void> {
      const record = await strapi.db.query(imageUid()).findOne({ where: { id: imageId } });
      if (!record) return;
      await provider().delete({
        hash: record.hash,
        ext: record.ext,
        mime: record.mime,
        url: record.url,
        provider_metadata: record.providerMetadata,
      });
      await strapi.db.query(imageUid()).delete({ where: { id: imageId } });
    },
  };
};

export default EcommerceImageService;
