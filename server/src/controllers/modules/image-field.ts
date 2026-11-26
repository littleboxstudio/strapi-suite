import fs from 'fs';
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';
import { removeTempUploads } from './ecommerce/uploads';
import { MAX_UPLOAD_BYTES } from '../../services/modules/ecommerce/domain/imageProcessing';
import {
  ImageFieldNotFoundError,
  ImageFieldValidationError,
} from '../../services/modules/image-field/errors';
import { IMAGE_FIELD_PERMISSIONS } from '../../routes/image-field/admin-image-field';

const present = (v: unknown) => v !== undefined && v !== null && v !== '';
const FILE_UID = 'plugin::upload.file';

const toId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const ImageFieldModuleController = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (): any => strapi.plugin(PLUGIN_ID).service('ImageFieldModuleService');

  /**
   * Whether the admin may run `action` on that Media Library file, permission conditions included
   * (as @strapi/upload's admin file controller checks it: the subject carries the creator and its
   * roles). `null` when the file does not exist.
   */
  const canOnFile = async (ctx: any, action: string, id: number): Promise<boolean | null> => {
    const file = await strapi
      .plugin('upload')
      .service('upload')
      .findOne(id, ['createdBy', 'folder']);
    if (!file) return null;
    const pm = strapi.service('admin::permission').createPermissionsManager({
      ability: ctx.state?.userAbility,
      action,
      model: FILE_UID,
    });
    const creatorId = file.createdBy?.id;
    const author = creatorId
      ? await strapi.service('admin::user').findOne(creatorId, ['roles'])
      : null;
    const subject = pm.toSubject({ ...file, createdBy: author }, FILE_UID);
    return !!pm.ability?.can(action, subject);
  };

  const handleError = (ctx: any, error: any) => {
    if (error instanceof ImageFieldValidationError) {
      return ctx.badRequest(error.code, { error: { code: error.code } });
    }
    if (error?.message === 'INVALID_IMAGE') {
      return ctx.badRequest('Invalid image', { error: { code: 'INVALID_IMAGE' } });
    }
    if (error instanceof ImageFieldNotFoundError) return ctx.notFound('File not found');
    throw error;
  };

  return {
    /**
     * Multipart: `file` (optional), `sourceFileId` (optional; exactly one of the two), `transform`
     * (JSON string, crop only), `alternativeText`. Answers `{ data: MediaValue }` (201).
     */
    async upload(ctx: any) {
      const file = ctx.request.files?.file;
      try {
        const body = ctx.request.body || {};
        if (Array.isArray(file)) return ctx.badRequest('Only one file is accepted');
        const hasFile = !!file;
        const hasSource = present(body.sourceFileId);
        if (hasFile === hasSource) {
          return ctx.badRequest('Exactly one of file or sourceFileId is required', {
            error: { code: 'ONE_SOURCE_REQUIRED' },
          });
        }
        if (hasFile && file.size > MAX_UPLOAD_BYTES) {
          return ctx.badRequest('The image exceeds 15 MB', { error: { code: 'IMAGE_TOO_LARGE' } });
        }
        const sourceFileId = hasSource ? toId(body.sourceFileId) : null;
        if (hasSource) {
          const allowed =
            sourceFileId === null
              ? null
              : await canOnFile(ctx, IMAGE_FIELD_PERMISSIONS.read, sourceFileId);
          if (allowed === null) {
            return ctx.badRequest('SOURCE_NOT_FOUND', { error: { code: 'SOURCE_NOT_FOUND' } });
          }
          if (!allowed) return ctx.forbidden('Reading this Media Library file is not allowed');
        }

        let transform;
        try {
          transform =
            typeof body.transform === 'string' ? JSON.parse(body.transform) : body.transform;
        } catch {
          return ctx.badRequest('transform must be valid JSON', {
            error: { code: 'TRANSFORM_REQUIRED' },
          });
        }

        try {
          const data = await service().upload({
            ...(hasFile
              ? {
                  buffer: await fs.promises.readFile(file.filepath),
                  originalName: file.originalFilename || 'image',
                }
              : { sourceFileId: sourceFileId as number }),
            transform,
            alternativeText: typeof body.alternativeText === 'string' ? body.alternativeText : null,
            user: ctx.state?.user,
          });
          ctx.status = 201;
          ctx.body = { data };
        } catch (error) {
          return handleError(ctx, error);
        }
      } finally {
        // Only the processed WebP is stored; the uploaded original is always discarded.
        await removeTempUploads(ctx.request.files?.file);
      }
    },

    /** Body `{ alternativeText: string | null }`; only files created by the field. */
    async updateAlt(ctx: any) {
      const body = ctx.request.body ?? {};
      const alt = body.alternativeText;
      if (alt !== null && alt !== undefined && typeof alt !== 'string') {
        return ctx.badRequest('alternativeText must be a string or null');
      }
      try {
        const id = toId(ctx.params.id);
        const allowed =
          id === null ? null : await canOnFile(ctx, IMAGE_FIELD_PERMISSIONS.update, id);
        if (allowed === null) return ctx.notFound('File not found');
        if (!allowed) return ctx.forbidden('Updating this file is not allowed');
        const data = await service().updateAlt(id, alt ?? null, ctx.state?.user);
        ctx.body = { data };
      } catch (error) {
        return handleError(ctx, error);
      }
    },
  };
};

export default ImageFieldModuleController;
