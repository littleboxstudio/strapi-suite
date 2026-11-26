import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';
import { ImageTransform, MAX_UPLOAD_BYTES, processImage } from './ecommerce/domain/imageProcessing';
import { MediaValue, toMediaValue } from './image-field/domain/mediaValue';
import { ImageFieldNotFoundError, ImageFieldValidationError } from './image-field/errors';
import {
  collectOrphans as collectOrphanFiles,
  createImageFieldMiddleware,
  isReferenced as isFileReferenced,
} from './image-field/cleanup';

export const IMAGE_FIELD_FOLDER_NAME = 'Littlebox';
/** Orphan collection runs at most this often (on start and on upload). */
export const ORPHAN_COLLECTION_INTERVAL_MS = 60 * 60 * 1000;

/** A remote Media Library source must answer within this time. */
export const REMOTE_SOURCE_TIMEOUT_MS = 15_000;

const FILE_UID = 'plugin::upload.file';
const FOLDER_UID = 'plugin::upload.folder';

export type ImageFieldUploadParams = {
  buffer?: Buffer;
  sourceFileId?: number;
  originalName?: string;
  transform: unknown;
  alternativeText?: string | null;
  /** The admin user, recorded as the Media Library file's creator. */
  user?: unknown;
};

/** Only crop with zoom: the field never stretches an image. */
export function validateCropTransform(transform: unknown): ImageTransform {
  if (!transform || typeof transform !== 'object') {
    throw new ImageFieldValidationError('TRANSFORM_REQUIRED');
  }
  const t = transform as any;
  if (t.mode !== 'crop') throw new ImageFieldValidationError('CROP_REQUIRED');
  if (!t.crop || typeof t.crop !== 'object') throw new ImageFieldValidationError('CROP_REQUIRED');
  return {
    mode: 'crop',
    width: t.width,
    height: t.height,
    crop: { x: t.crop.x, y: t.crop.y, width: t.crop.width, height: t.crop.height },
  };
}

/** The original's base name (no extension, no path, no control characters) + `.webp`. */
export function webpName(originalName: string | undefined | null): string {
  const base = String(originalName ?? '')
    .split(/[/\\]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return `${base || 'image'}.webp`;
}

const normalizeAlt = (alt: unknown): string | null =>
  typeof alt === 'string' && alt.trim() !== '' ? alt : null;

const ImageFieldModuleService = ({ strapi }: { strapi: Core.Strapi }) => {
  const registryUid = (): string => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.imageField.file;
  };
  const uploadService = (): any => strapi.plugin('upload').service('upload');

  let lastOrphanCollection = 0;
  let folderPromise: Promise<number> | null = null;

  /** Id of the root Media Library folder "Littlebox", created when missing. */
  const findOrCreateFolder = async (user?: unknown): Promise<number> => {
    const existing = await strapi.db
      .query(FOLDER_UID)
      .findOne({ where: { name: IMAGE_FIELD_FOLDER_NAME, parent: null }, select: ['id'] });
    if (existing) return existing.id;
    const created = await strapi
      .plugin('upload')
      .service('folder')
      .create({ name: IMAGE_FIELD_FOLDER_NAME, parent: null }, user ? { user } : {});
    return created.id;
  };

  const folderId = (user?: unknown): Promise<number> => {
    // Concurrent first uploads share one lookup / creation (no duplicated folder).
    if (!folderPromise) {
      folderPromise = findOrCreateFolder(user).finally(() => {
        folderPromise = null;
      });
    }
    return folderPromise;
  };

  /** Bytes of a Media Library file, read by the server. The file itself is never changed. */
  const readLibraryFile = async (file: any): Promise<Buffer> => {
    if (typeof file.size === 'number' && file.size * 1024 > MAX_UPLOAD_BYTES) {
      throw new ImageFieldValidationError('IMAGE_TOO_LARGE');
    }
    if (file.provider === 'local') {
      const publicDir = path.resolve(strapi.dirs.static.public);
      const url = typeof file.url === 'string' ? file.url.split('?')[0] : '';
      const full = path.resolve(publicDir, `.${url}`);
      if (!url.startsWith('/') || !full.startsWith(publicDir + path.sep)) {
        throw new ImageFieldValidationError('SOURCE_UNREADABLE');
      }
      try {
        return await fs.promises.readFile(full);
      } catch {
        throw new ImageFieldValidationError('SOURCE_UNREADABLE');
      }
    }
    const signed = await strapi.plugin('upload').service('file').signFileUrls(file);
    let res: Response;
    try {
      res = await fetch(signed.url, {
        redirect: 'error',
        signal: AbortSignal.timeout(REMOTE_SOURCE_TIMEOUT_MS),
      });
    } catch {
      throw new ImageFieldValidationError('SOURCE_UNREADABLE');
    }
    if (!res.ok || !res.body) throw new ImageFieldValidationError('SOURCE_UNREADABLE');
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_UPLOAD_BYTES) {
      await res.body.cancel().catch(() => undefined);
      throw new ImageFieldValidationError('IMAGE_TOO_LARGE');
    }
    return readCapped(res.body);
  };

  /** Reads a response body, aborting as soon as it exceeds `MAX_UPLOAD_BYTES`. */
  const readCapped = async (body: ReadableStream<Uint8Array>): Promise<Buffer> => {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let step: Awaited<ReturnType<typeof reader.read>>;
      try {
        step = await reader.read();
      } catch {
        throw new ImageFieldValidationError('SOURCE_UNREADABLE');
      }
      if (step.done) break;
      total += step.value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ImageFieldValidationError('IMAGE_TOO_LARGE');
      }
      chunks.push(step.value);
    }
    return Buffer.concat(chunks);
  };

  const service = {
    /**
     * Deletes the field's orphan files: registry files older than 24 h that no `ltbimage` value
     * references (uploaded, never saved), and registry rows whose file is already gone.
     */
    async collectOrphans(now: number = Date.now()): Promise<void> {
      await collectOrphanFiles(strapi, registryUid(), now);
    },

    /** True when any `ltbimage` value (any version, locale, entry or component) uses the file. */
    isReferenced(fileId: number): Promise<boolean> {
      return isFileReferenced(strapi, fileId);
    },

    /** The document service middleware validating values and deleting files that left them. */
    documentMiddleware() {
      return createImageFieldMiddleware(strapi, registryUid);
    },

    /** Runs `collectOrphans` at most once per interval, in the background; failures are only logged. */
    collectOrphansThrottled(now: number = Date.now()): Promise<void> | null {
      if (now - lastOrphanCollection < ORPHAN_COLLECTION_INTERVAL_MS) return null;
      lastOrphanCollection = now;
      return Promise.resolve()
        .then(() => service.collectOrphans())
        .catch((err: unknown) => {
          strapi.log?.warn(
            `[image-field] orphan collection failed: ${err instanceof Error ? err.name : 'error'}`
          );
        });
    },

    /** True when the Media Library file was created by this field (only those are ever deleted). */
    async isRegistered(fileId: number): Promise<boolean> {
      const row = await strapi.db
        .query(registryUid())
        .findOne({ where: { fileId }, select: ['id'] });
      return !!row;
    },

    /**
     * Crops the source (an uploaded buffer or a Media Library file, exactly one) to a WebP and
     * creates it as a new Media Library file in the "Littlebox" folder. A library source is never
     * modified or deleted.
     */
    async upload(params: ImageFieldUploadParams): Promise<MediaValue> {
      const hasBuffer = params.buffer !== undefined && params.buffer !== null;
      const hasSource = params.sourceFileId !== undefined && params.sourceFileId !== null;
      if (hasBuffer === hasSource) throw new ImageFieldValidationError('ONE_SOURCE_REQUIRED');
      const transform = validateCropTransform(params.transform);

      let input: Buffer;
      let originalName = params.originalName;
      if (hasSource) {
        const id = Number(params.sourceFileId);
        if (!Number.isInteger(id) || id <= 0)
          throw new ImageFieldValidationError('SOURCE_NOT_FOUND');
        const source = await strapi.db.query(FILE_UID).findOne({ where: { id } });
        if (!source) throw new ImageFieldValidationError('SOURCE_NOT_FOUND');
        if (typeof source.mime !== 'string' || !source.mime.startsWith('image/')) {
          throw new ImageFieldValidationError('SOURCE_NOT_IMAGE');
        }
        // Picked as a source, a file this field created becomes a user-owned original: it must
        // never be deleted by the field's cleanup again.
        await strapi.db.query(registryUid()).deleteMany({ where: { fileId: source.id } });
        input = await readLibraryFile(source);
        originalName = source.name;
      } else {
        input = params.buffer as Buffer;
        if (input.length > MAX_UPLOAD_BYTES) throw new ImageFieldValidationError('IMAGE_TOO_LARGE');
      }

      // Throws Error('INVALID_IMAGE') for an unreadable image or an out-of-bounds crop.
      const processed = await processImage(input, transform);
      const name = webpName(originalName);
      const folder = await folderId(params.user);

      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ltb-image-field-'));
      let created: any;
      try {
        const filepath = path.join(dir, 'image.webp');
        await fs.promises.writeFile(filepath, processed.buffer);
        const result = await uploadService().upload(
          {
            data: {
              fileInfo: { name, alternativeText: normalizeAlt(params.alternativeText), folder },
            },
            files: {
              filepath,
              originalFilename: name,
              mimetype: 'image/webp',
              size: processed.sizeBytes,
            },
          },
          params.user ? { user: params.user } : undefined
        );
        created = Array.isArray(result) ? result[0] : result;
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (!created?.id) throw new Error('UPLOAD_FAILED');

      try {
        await strapi.db.query(registryUid()).create({ data: { fileId: created.id } });
      } catch (err) {
        // An unregistered file would never be cleaned up: remove it rather than leak it.
        await uploadService()
          .remove(created)
          .catch(() => undefined);
        throw err;
      }

      service.collectOrphansThrottled();
      return toMediaValue(created);
    },

    /** Sets the alt text of a file this field created (404 for any other file). */
    async updateAlt(
      fileId: number,
      alternativeText: string | null,
      user?: unknown
    ): Promise<MediaValue> {
      if (!Number.isInteger(fileId) || fileId <= 0 || !(await service.isRegistered(fileId))) {
        throw new ImageFieldNotFoundError('File not found');
      }
      const alt = normalizeAlt(alternativeText);
      let updated: any;
      if (alt === null) {
        // updateFileInfo keeps the previous alt text for null: clear it directly.
        updated = await strapi.db
          .query(FILE_UID)
          .update({ where: { id: fileId }, data: { alternativeText: null } });
      } else {
        updated = await uploadService().updateFileInfo(
          fileId,
          { alternativeText: alt },
          user ? { user } : undefined
        );
      }
      if (!updated) throw new ImageFieldNotFoundError('File not found');
      return toMediaValue(updated);
    },
  };

  return service;
};

export default ImageFieldModuleService;
