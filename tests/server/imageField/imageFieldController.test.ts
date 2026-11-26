import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import createController from '../../../server/src/controllers/modules/image-field';
import routes from '../../../server/src/routes/image-field/admin-image-field';
import {
  ImageFieldNotFoundError,
  ImageFieldValidationError,
} from '../../../server/src/services/modules/image-field/errors';

const FILES: Record<number, any> = {
  3: { id: 3, name: 'a.png', createdBy: { id: 7 } },
  4: { id: 4, name: 'b.webp', createdBy: null },
};

/** Admin permission service double: the subject is the file (with its creator's roles). */
function setup(service: any) {
  const uploadService = {
    findOne: vi.fn(async (id: number, populate: string[]) => {
      expect(populate).toEqual(expect.arrayContaining(['createdBy']));
      return FILES[id] ?? null;
    }),
  };
  const strapi: any = {
    plugin: (name: string) => ({
      service: () => (name === 'upload' ? uploadService : service),
    }),
    service: (name: string) => {
      if (name === 'admin::user') {
        return { findOne: vi.fn(async (id: number) => ({ id, roles: [{ id: 1 }] })) };
      }
      return {
        createPermissionsManager: ({ ability, action, model }: any) => ({
          ability,
          action,
          toSubject: (target: any, subject = model) => ({ __subject: subject, ...target }),
        }),
      };
    },
  };
  return createController({ strapi });
}

const ctxOf = (request: any, extra: any = {}) => ({
  request: { body: {}, ...request },
  params: {},
  state: { user: { id: 1 }, userAbility: { can: vi.fn(() => true) } },
  badRequest: vi.fn(),
  forbidden: vi.fn(),
  notFound: vi.fn(),
  ...extra,
});

const tempFile = () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltb-if-ctl-')), 'f.png');
  fs.writeFileSync(p, Buffer.from('x'));
  return p;
};

describe('image field routes', () => {
  it('require an admin with the upload create (upload) / update (alt) permission', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /image-field/upload',
      'PUT /image-field/files/:id/alt',
    ]);
    const policies = (action: string) => [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ];
    expect(routes[0].config.policies).toEqual(policies('plugin::upload.assets.create'));
    expect(routes[1].config.policies).toEqual(policies('plugin::upload.assets.update'));
  });
});

describe('ImageFieldModuleController.upload', () => {
  it('400 with neither or both sources, without calling the service', async () => {
    const upload = vi.fn();
    const controller = setup({ upload });
    const neither: any = ctxOf({ body: { transform: '{}' } });
    await controller.upload(neither);
    expect(neither.badRequest).toHaveBeenCalled();
    const filepath = tempFile();
    const both: any = ctxOf({
      files: { file: { size: 1, filepath } },
      body: { sourceFileId: '3', transform: '{}' },
    });
    await controller.upload(both);
    expect(both.badRequest).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(fs.existsSync(filepath)).toBe(false);
  });

  it('400 for files over 15 MB', async () => {
    const upload = vi.fn();
    const ctx: any = ctxOf({
      files: { file: { size: 15 * 1024 * 1024 + 1, filepath: '/nonexistent' } },
      body: { transform: '{}' },
    });
    await setup({ upload }).upload(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('The image exceeds 15 MB', {
      error: { code: 'IMAGE_TOO_LARGE' },
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('403 for a library source the admin cannot read (checked on the file subject)', async () => {
    const upload = vi.fn();
    const ctx: any = ctxOf({ body: { sourceFileId: '3', transform: '{}' } });
    ctx.state.userAbility.can = vi.fn(
      (a: string, subject: any) => !(a === 'plugin::upload.read' && subject?.id === 3)
    );
    await setup({ upload }).upload(ctx);
    expect(ctx.state.userAbility.can).toHaveBeenCalledWith(
      'plugin::upload.read',
      expect.objectContaining({
        __subject: 'plugin::upload.file',
        id: 3,
        createdBy: { id: 7, roles: [{ id: 1 }] },
      })
    );
    expect(ctx.forbidden).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('400 SOURCE_NOT_FOUND for a missing or malformed library source', async () => {
    const upload = vi.fn();
    for (const sourceFileId of ['99', 'abc']) {
      const ctx: any = ctxOf({ body: { sourceFileId, transform: '{}' } });
      await setup({ upload }).upload(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith('SOURCE_NOT_FOUND', {
        error: { code: 'SOURCE_NOT_FOUND' },
      });
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it('maps service validation (e.g. resize) and INVALID_IMAGE to 400', async () => {
    const resize: any = ctxOf({ body: { sourceFileId: '3', transform: '{"mode":"resize"}' } });
    await setup({
      upload: vi.fn().mockRejectedValue(new ImageFieldValidationError('CROP_REQUIRED')),
    }).upload(resize);
    expect(resize.badRequest).toHaveBeenCalledWith('CROP_REQUIRED', {
      error: { code: 'CROP_REQUIRED' },
    });

    const invalid: any = ctxOf({ body: { sourceFileId: '3', transform: '{}' } });
    await setup({ upload: vi.fn().mockRejectedValue(new Error('INVALID_IMAGE')) }).upload(invalid);
    expect(invalid.badRequest).toHaveBeenCalledWith('Invalid image', {
      error: { code: 'INVALID_IMAGE' },
    });
  });

  it('passes the file bytes and answers 201 { data }', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 9 });
    const filepath = tempFile();
    const ctx: any = ctxOf({
      files: { file: { size: 1, filepath, originalFilename: 'a.png' } },
      body: { transform: '{"mode":"crop"}', alternativeText: 'Alt' },
    });
    await setup({ upload }).upload(ctx);
    const arg = upload.mock.calls[0][0];
    expect(arg.buffer.toString()).toBe('x');
    expect(arg).toMatchObject({
      originalName: 'a.png',
      transform: { mode: 'crop' },
      alternativeText: 'Alt',
      user: { id: 1 },
    });
    expect(arg.sourceFileId).toBeUndefined();
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ data: { id: 9 } });
    expect(fs.existsSync(filepath)).toBe(false);
  });
});

describe('ImageFieldModuleController.updateAlt', () => {
  it('403 when the admin cannot update that file', async () => {
    const updateAlt = vi.fn();
    const ctx: any = ctxOf({ body: { alternativeText: 'x' } }, { params: { id: '4' } });
    ctx.state.userAbility.can = vi.fn(
      (a: string, s: any) => !(a === 'plugin::upload.assets.update' && s?.id === 4)
    );
    await setup({ updateAlt }).updateAlt(ctx);
    expect(ctx.forbidden).toHaveBeenCalled();
    expect(updateAlt).not.toHaveBeenCalled();
  });

  it('answers { data } and 404 for files the field did not create', async () => {
    const updateAlt = vi
      .fn()
      .mockResolvedValueOnce({ id: 4, alternativeText: 'x' })
      .mockRejectedValueOnce(new ImageFieldNotFoundError());
    const controller = setup({ updateAlt });
    const ok: any = ctxOf({ body: { alternativeText: 'x' } }, { params: { id: '4' } });
    await controller.updateAlt(ok);
    expect(updateAlt).toHaveBeenCalledWith(4, 'x', { id: 1 });
    expect(ok.body).toEqual({ data: { id: 4, alternativeText: 'x' } });
    const missing: any = ctxOf({ body: { alternativeText: null } }, { params: { id: '5' } });
    await controller.updateAlt(missing);
    expect(missing.notFound).toHaveBeenCalled();
  });

  it('400 for a non-string alt text', async () => {
    const updateAlt = vi.fn();
    const ctx: any = ctxOf({ body: { alternativeText: 5 } }, { params: { id: '4' } });
    await setup({ updateAlt }).updateAlt(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(updateAlt).not.toHaveBeenCalled();
  });
});
