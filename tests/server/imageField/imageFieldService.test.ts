import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import ImageFieldModuleService, {
  ORPHAN_COLLECTION_INTERVAL_MS,
  webpName,
} from '../../../server/src/services/modules/image-field';
import { ImageFieldNotFoundError } from '../../../server/src/services/modules/image-field/errors';

const REGISTRY_UID = 'plugin::littlebox-strapi-suite.ltb-st-module-image-field-file';
const crop = (w = 200, h = 150) => ({
  mode: 'crop',
  width: w,
  height: h,
  crop: { x: 0, y: 0, width: 400, height: 300 },
});
const png = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#f00' } })
    .png()
    .toBuffer();

let publicDir: string;

function build(opts: { sourceFile?: any; folder?: any; registry?: any } = {}) {
  const uploadedFiles: any[] = [];
  const uploadService = {
    upload: vi.fn(async ({ data, files }: any, _opts?: any) => {
      // The temp file exists while the upload service reads it.
      const bytes = fs.readFileSync(files.filepath);
      uploadedFiles.push({ data, files, bytes });
      return [
        {
          id: 99,
          documentId: 'doc99',
          name: data.fileInfo.name,
          alternativeText: data.fileInfo.alternativeText,
          mime: 'image/webp',
          ext: '.webp',
          url: '/uploads/new.webp',
          folder: data.fileInfo.folder,
          width: 200,
          height: 150,
        },
      ];
    }),
    updateFileInfo: vi.fn(async (id: number, info: any) => ({
      id,
      alternativeText: info.alternativeText,
    })),
    remove: vi.fn(async () => undefined),
  };
  const folderService = { create: vi.fn(async (d: any) => ({ id: 12, ...d })) };
  const fileService = { signFileUrls: vi.fn(async (f: any) => f) };
  const fileQuery = {
    findOne: vi.fn(async () => opts.sourceFile ?? null),
    update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    delete: vi.fn(),
  };
  const folderQuery = { findOne: vi.fn(async () => opts.folder ?? null) };
  const registryQuery = {
    create: vi.fn(async ({ data }: any) => ({ id: 1, ...data })),
    findOne: vi.fn(async () => opts.registry ?? null),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  };
  const query = vi.fn((uid: string) => {
    if (uid === 'plugin::upload.file') return fileQuery;
    if (uid === 'plugin::upload.folder') return folderQuery;
    if (uid === REGISTRY_UID) return registryQuery;
    throw new Error(`unexpected query ${uid}`);
  });
  const strapi: any = {
    db: { query },
    dirs: { static: { public: publicDir } },
    log: { warn: vi.fn() },
    plugin: vi.fn(() => ({
      service: (name: string) =>
        name === 'upload' ? uploadService : name === 'folder' ? folderService : fileService,
    })),
    config: { get: vi.fn(() => ({ uuid: { modules: { imageField: { file: REGISTRY_UID } } } })) },
  };
  return {
    service: ImageFieldModuleService({ strapi }),
    uploadService,
    folderService,
    fileQuery,
    folderQuery,
    registryQuery,
    uploadedFiles,
  };
}

beforeEach(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltb-if-test-'));
  fs.mkdirSync(path.join(publicDir, 'uploads'));
});
afterEach(() => {
  fs.rmSync(publicDir, { recursive: true, force: true });
});

describe('webpName', () => {
  it('keeps the base name and swaps the extension', () => {
    expect(webpName('My Photo.JPG')).toBe('My Photo.webp');
    expect(webpName('../a/b.png')).toBe('b.webp');
    expect(webpName('')).toBe('image.webp');
    expect(webpName(undefined)).toBe('image.webp');
  });
});

describe('ImageFieldModuleService.upload', () => {
  it('refuses both sources and neither source', async () => {
    const { service, uploadService } = build();
    await expect(service.upload({ transform: crop() })).rejects.toMatchObject({
      code: 'ONE_SOURCE_REQUIRED',
    });
    await expect(
      service.upload({ buffer: await png(), sourceFileId: 3, transform: crop() })
    ).rejects.toMatchObject({ code: 'ONE_SOURCE_REQUIRED' });
    expect(uploadService.upload).not.toHaveBeenCalled();
  });

  it('refuses a resize transform (crop only)', async () => {
    const { service, uploadService } = build();
    await expect(
      service.upload({ buffer: await png(), transform: { mode: 'resize', width: 10, height: 10 } })
    ).rejects.toMatchObject({ code: 'CROP_REQUIRED' });
    expect(uploadService.upload).not.toHaveBeenCalled();
  });

  it('maps an out-of-bounds crop to INVALID_IMAGE', async () => {
    const { service } = build();
    await expect(
      service.upload({
        buffer: await png(),
        transform: {
          mode: 'crop',
          width: 10,
          height: 10,
          crop: { x: 0, y: 0, width: 500, height: 300 },
        },
      })
    ).rejects.toThrow('INVALID_IMAGE');
  });

  it('creates a WebP in a new "Littlebox" folder, records it and answers the media value', async () => {
    const { service, uploadService, folderService, registryQuery, uploadedFiles } = build();
    const value = await service.upload({
      buffer: await png(),
      originalName: 'Beach.png',
      transform: crop(),
      alternativeText: 'Sea',
      user: { id: 1 },
    });
    expect(folderService.create).toHaveBeenCalledWith(
      { name: 'Littlebox', parent: null },
      { user: { id: 1 } }
    );
    const call = uploadedFiles[0];
    expect(call.data.fileInfo).toEqual({ name: 'Beach.webp', alternativeText: 'Sea', folder: 12 });
    expect(call.files.mimetype).toBe('image/webp');
    const meta = await sharp(call.bytes).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 200, height: 150 });
    expect(fs.existsSync(call.files.filepath)).toBe(false);
    expect(uploadService.upload.mock.calls[0][1]).toEqual({ user: { id: 1 } });
    expect(registryQuery.create).toHaveBeenCalledWith({ data: { fileId: 99 } });
    expect(value).toMatchObject({
      id: 99,
      documentId: 'doc99',
      name: 'Beach.webp',
      alternativeText: 'Sea',
    });
    expect((value as any).folder).toBeUndefined();
  });

  it('reuses an existing "Littlebox" folder', async () => {
    const { service, folderService, uploadedFiles } = build({ folder: { id: 4 } });
    await service.upload({ buffer: await png(), originalName: 'a.png', transform: crop() });
    expect(folderService.create).not.toHaveBeenCalled();
    expect(uploadedFiles[0].data.fileInfo.folder).toBe(4);
  });

  it('library source: reads the original, creates a new file and never modifies the original', async () => {
    const original = await png();
    fs.writeFileSync(path.join(publicDir, 'uploads', 'orig_1.png'), original);
    const sourceFile = {
      id: 3,
      name: 'Original.png',
      mime: 'image/png',
      provider: 'local',
      url: '/uploads/orig_1.png',
      size: 2,
    };
    const { service, uploadService, fileQuery, uploadedFiles } = build({ sourceFile });
    const value = await service.upload({ sourceFileId: 3, transform: crop() });
    expect(uploadService.upload).toHaveBeenCalledTimes(1);
    expect(uploadedFiles[0].data.fileInfo.name).toBe('Original.webp');
    expect(value.id).toBe(99);
    expect(uploadService.updateFileInfo).not.toHaveBeenCalled();
    expect(uploadService.remove).not.toHaveBeenCalled();
    expect(fileQuery.update).not.toHaveBeenCalled();
    expect(fileQuery.delete).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(publicDir, 'uploads', 'orig_1.png')).equals(original)).toBe(
      true
    );
  });

  it('library source: a file this field created becomes user-owned (registry row removed)', async () => {
    fs.writeFileSync(path.join(publicDir, 'uploads', 'orig_1.png'), await png());
    const sourceFile = {
      id: 3,
      name: 'Original.png',
      mime: 'image/png',
      provider: 'local',
      url: '/uploads/orig_1.png',
    };
    const { service, registryQuery } = build({ sourceFile });
    await service.upload({ sourceFileId: 3, transform: crop() });
    expect(registryQuery.deleteMany).toHaveBeenCalledWith({ where: { fileId: 3 } });
    expect(registryQuery.create).toHaveBeenCalledWith({ data: { fileId: 99 } });
  });

  describe('remote library source', () => {
    const remote = {
      id: 3,
      name: 'R.png',
      mime: 'image/png',
      provider: 'aws-s3',
      url: 'https://cdn/x',
    };
    afterEach(() => vi.unstubAllGlobals());

    it('fetches with a timeout and no redirects', async () => {
      const body = await png();
      const fetchMock = vi.fn(async () => new Response(body));
      vi.stubGlobal('fetch', fetchMock);
      const { service } = build({ sourceFile: remote });
      await service.upload({ sourceFileId: 3, transform: crop() });
      const init: any = (fetchMock.mock.calls[0] as any[])[1];
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('stops reading once the body exceeds the cap (no content-length)', async () => {
      let pulled = 0;
      const chunk = new Uint8Array(1024 * 1024);
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          if (pulled > 40) controller.close();
          else controller.enqueue(chunk);
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(stream))
      );
      const { service } = build({ sourceFile: remote });
      await expect(service.upload({ sourceFileId: 3, transform: crop() })).rejects.toMatchObject({
        code: 'IMAGE_TOO_LARGE',
      });
      expect(pulled).toBeLessThan(20);
    });

    it('maps a fetch failure (e.g. a redirect or a timeout) to SOURCE_UNREADABLE', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('redirect')));
      const { service } = build({ sourceFile: remote });
      await expect(service.upload({ sourceFileId: 3, transform: crop() })).rejects.toMatchObject({
        code: 'SOURCE_UNREADABLE',
      });
    });
  });

  it('library source must be an existing image inside the public folder', async () => {
    await expect(
      build().service.upload({ sourceFileId: 3, transform: crop() })
    ).rejects.toMatchObject({
      code: 'SOURCE_NOT_FOUND',
    });
    await expect(
      build({
        sourceFile: { id: 3, mime: 'application/pdf', provider: 'local', url: '/uploads/a.pdf' },
      }).service.upload({ sourceFileId: 3, transform: crop() })
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_IMAGE' });
    await expect(
      build({
        sourceFile: { id: 3, mime: 'image/png', provider: 'local', url: '/../../etc/passwd' },
      }).service.upload({ sourceFileId: 3, transform: crop() })
    ).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE' });
  });

  it('removes the created file when it cannot be recorded', async () => {
    const { service, uploadService, registryQuery } = build();
    registryQuery.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.upload({ buffer: await png(), transform: crop() })).rejects.toThrow(
      'db down'
    );
    expect(uploadService.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
  });
});

describe('ImageFieldModuleService.collectOrphansThrottled', () => {
  it('runs at most once per interval', async () => {
    const { service } = build();
    const spy = vi.spyOn(service, 'collectOrphans');
    const now = 10 * ORPHAN_COLLECTION_INTERVAL_MS;
    await service.collectOrphansThrottled(now);
    expect(service.collectOrphansThrottled(now + 1000)).toBeNull();
    await service.collectOrphansThrottled(now + ORPHAN_COLLECTION_INTERVAL_MS);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('ImageFieldModuleService.updateAlt', () => {
  it('only updates files the field created', async () => {
    const { service, uploadService } = build();
    await expect(service.updateAlt(5, 'x')).rejects.toBeInstanceOf(ImageFieldNotFoundError);
    expect(uploadService.updateFileInfo).not.toHaveBeenCalled();
  });

  it('updates the alt text, and clears it for null', async () => {
    const { service, uploadService, fileQuery } = build({ registry: { id: 1 } });
    expect(await service.updateAlt(5, 'New')).toMatchObject({ id: 5, alternativeText: 'New' });
    expect(uploadService.updateFileInfo).toHaveBeenCalledWith(
      5,
      { alternativeText: 'New' },
      undefined
    );
    expect(await service.updateAlt(5, null)).toMatchObject({ id: 5, alternativeText: null });
    expect(fileQuery.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { alternativeText: null },
    });
  });
});
