import crypto from 'crypto';
import { Readable } from 'stream';
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { slugify } from './domain/catalog';
import { processImage, processLogo, ImageTransform } from './domain/imageProcessing';
import { galleryCover, isGalleryPermutation, sortGallery } from './domain/galleryImages';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';

export type ImageRecord = {
  id: number;
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  url: string;
  position: number;
  /** The gallery's cover (only one per gallery). */
  cover: boolean;
};

/** The images of one gallery: a product's or a variant's. */
export type ImageOwner = { productId?: number; variantId?: number };

/** Stored image row, as needed to delete its file from the upload provider. */
export type StoredImage = {
  id: number;
  hash: string;
  ext: string;
  mime: string;
  url: string;
  providerMetadata?: unknown;
};

/** A file in the upload provider that has no image row (e.g. the store logo). */
export type StoredFile = Omit<StoredImage, 'id'>;

export type StoreLogoFile = {
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  hash: string;
  ext: '.png';
  mime: 'image/png';
  provider: string;
  providerMetadata: unknown | null;
};

const EcommerceImageService = ({ strapi }: { strapi: Core.Strapi }) => {
  const imageUid = (): string => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce.image;
  };
  const provider = (): any => (strapi.plugin('upload') as any).provider;
  const deleteFile = (record: StoredFile) =>
    provider().delete({
      hash: record.hash,
      ext: record.ext,
      mime: record.mime,
      url: record.url,
      provider_metadata: record.providerMetadata,
    });

  const ownerWhere = (owner: ImageOwner) =>
    owner.variantId ? { variant: owner.variantId } : { product: owner.productId };

  /** The gallery's images (id, position, cover), in gallery order. */
  const galleryOf = async (owner: ImageOwner) =>
    sortGallery<{ id: number; position: number | null; cover: boolean | null }>(
      await strapi.db.query(imageUid()).findMany({
        where: ownerWhere(owner),
        select: ['id', 'position', 'cover'],
      })
    );

  return {
    /**
     * Saves the gallery's order: `ids` lists every image of the gallery, first to last. A list that
     * is not exactly the gallery's images (one added or deleted meanwhile) is refused. The cover
     * never moves with the order: a gallery with no marked cover (images from before covers) gets
     * its current cover, the first image before the move, marked. Returns the cover.
     */
    async reorder(owner: ImageOwner, ids: unknown): Promise<{ coverId: number | null }> {
      if (!owner.productId === !owner.variantId) {
        throw new EcommerceValidationError('Invalid images', [{ path: 'owner', code: 'required' }]);
      }
      const current = await galleryOf(owner);
      if (!isGalleryPermutation(current.map((r) => r.id), ids)) {
        throw new EcommerceValidationError('Invalid images', [{ path: 'ids', code: 'IMAGES_CHANGED' }]);
      }
      const cover = galleryCover(current);
      const markCover = cover !== null && cover.cover !== true;
      await strapi.db.transaction(async () => {
        for (let i = 0; i < ids.length; i += 1) {
          await strapi.db.query(imageUid()).update({
            where: { id: ids[i] },
            data: { position: i + 1, ...(markCover && ids[i] === cover.id ? { cover: true } : {}) },
          });
        }
      });
      return { coverId: cover?.id ?? null };
    },

    /** Marks the image as its gallery's cover; the gallery's previous cover stops being one. */
    async setCover(imageId: number): Promise<void> {
      const image = await strapi.db.query(imageUid()).findOne({
        where: { id: imageId },
        populate: { product: { select: ['id'] }, variant: { select: ['id'] } },
      });
      if (!image || (!image.product && !image.variant)) {
        throw new EcommerceNotFoundError('Image not found');
      }
      const owner: ImageOwner = image.variant ? { variantId: image.variant.id } : { productId: image.product.id };
      await strapi.db.transaction(async () => {
        await strapi.db.query(imageUid()).updateMany({
          where: { ...ownerWhere(owner), cover: true, id: { $ne: imageId } },
          data: { cover: false },
        });
        await strapi.db.query(imageUid()).update({ where: { id: imageId }, data: { cover: true } });
      });
    },

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
      const siblings: { position: number }[] = await strapi.db.query(imageUid()).findMany({
        where: ownerWhere(params.owner),
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
          // A gallery's first image is its cover; later ones never take it over by themselves.
          cover: siblings.length === 0,
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
        cover: siblings.length === 0,
      };
    },

    /** Processes and sends the store logo to the upload provider; no Media Library, no image row. */
    async uploadStoreLogo(params: { buffer: Buffer; originalName: string }): Promise<StoreLogoFile> {
      const { buffer, width, height, sizeBytes } = await processLogo(params.buffer);
      const hash = `store-logo_${crypto.randomBytes(5).toString('hex')}`;
      const file: any = {
        name: 'store-logo.png',
        hash,
        ext: '.png',
        mime: 'image/png',
        size: Math.round((sizeBytes / 1024) * 100) / 100,
        width,
        height,
        buffer,
        getStream: () => Readable.from(buffer),
      };
      await provider().upload(file);
      // A provider that sets no URL would leave e-mails without the logo, silently.
      if (typeof file.url !== 'string' || file.url === '') throw new Error('UPLOAD_FAILED');
      const providerName: string =
        (strapi.config.get('plugin::upload') as any)?.provider || 'local';
      return {
        url: file.url,
        width,
        height,
        sizeBytes,
        hash,
        ext: '.png',
        mime: 'image/png',
        provider: providerName,
        providerMetadata: file.provider_metadata ?? null,
      };
    },

    /** Deletes the image; deleting the gallery's cover makes the first remaining image the cover. */
    async remove(imageId: number): Promise<void> {
      const record = await strapi.db.query(imageUid()).findOne({
        where: { id: imageId },
        populate: { product: { select: ['id'] }, variant: { select: ['id'] } },
      });
      if (!record) return;
      await deleteFile(record);
      const owner: ImageOwner | null = record.variant
        ? { variantId: record.variant.id }
        : record.product
          ? { productId: record.product.id }
          : null;
      const wasCover = owner ? galleryCover(await galleryOf(owner))?.id === imageId : false;
      await strapi.db.query(imageUid()).delete({ where: { id: imageId } });
      if (owner && wasCover) {
        const next = (await galleryOf(owner))[0];
        if (next) await strapi.db.query(imageUid()).update({ where: { id: next.id }, data: { cover: true } });
      }
    },

    /**
     * Deletes provider files of images whose records are already gone. Best effort: a failure
     * is logged and does not stop the remaining deletes (the records are committed by then).
     */
    async removeFiles(records: StoredFile[]): Promise<void> {
      for (const record of records) {
        try {
          await deleteFile(record);
        } catch (err) {
          strapi.log?.warn(
            `[ecommerce] could not delete image file ${record.hash}${record.ext}: ${String(err)}`
          );
        }
      }
    },
  };
};

export default EcommerceImageService;
