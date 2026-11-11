import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import EcommerceImageService from '../../../server/src/services/modules/ecommerce/images';

const IMAGE_UID = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-image';

function build(providerOverrides: any = {}, existing: any[] = []) {
  const provider = {
    upload: vi.fn(async (file: any) => {
      file.url = `/uploads/${file.hash}${file.ext}`;
    }),
    delete: vi.fn(async () => undefined),
    ...providerOverrides,
  };
  const imageQuery = {
    findMany: vi.fn().mockResolvedValue(existing),
    findOne: vi.fn().mockResolvedValue({
      id: 7, hash: 'a_b', ext: '.webp', mime: 'image/webp', url: '/uploads/a_b.webp', providerMetadata: null,
    }),
    create: vi.fn(async ({ data }: any) => ({ id: 1, ...data })),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const query = vi.fn((uid: string) => {
    if (uid === IMAGE_UID) return imageQuery;
    throw new Error(`unexpected query ${uid}`);
  });
  const strapi: any = {
    db: { query },
    plugin: vi.fn(() => ({ provider })),
    config: {
      get: vi.fn((key: string) =>
        key === 'plugin::upload'
          ? { provider: 'local' }
          : { uuid: { modules: { ecommerce: { image: IMAGE_UID } } } }
      ),
    },
  };
  return { service: EcommerceImageService({ strapi }), provider, imageQuery, query };
}

const png = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#f00' } }).png().toBuffer();

describe('EcommerceImageService', () => {
  it('uploads via provider and creates record without touching upload files', async () => {
    const { service, provider, imageQuery, query } = build({}, [{ position: 2 }]);
    const rec = await service.upload({
      buffer: await png(),
      originalName: 'Minha Foto.PNG',
      transform: { mode: 'resize', width: 200, height: 150 },
      owner: { productId: 3 },
    });

    expect(provider.upload).toHaveBeenCalledTimes(1);
    const file = provider.upload.mock.calls[0][0];
    expect(file.mime).toBe('image/webp');
    expect(file.ext).toBe('.webp');
    expect(file.name).toBe('minha-foto.webp');
    expect(file.hash).toMatch(/^minha-foto_[0-9a-f]{10}$/);
    expect(query).not.toHaveBeenCalledWith('plugin::upload.file');
    const data = imageQuery.create.mock.calls[0][0].data;
    expect(data.url).toBe(`/uploads/${file.hash}.webp`);
    expect(data.position).toBe(3);
    expect(data.product).toBe(3);
    expect(data.provider).toBe('local');
    expect(rec).toMatchObject({ width: 200, height: 150, url: data.url, position: 3 });
  });

  it('remove keeps record when provider fails', async () => {
    const { service, imageQuery } = build({ delete: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(service.remove(7)).rejects.toThrow('boom');
    expect(imageQuery.delete).not.toHaveBeenCalled();
  });

  it('remove deletes provider file then record', async () => {
    const { service, provider, imageQuery } = build();
    await service.remove(7);
    expect(provider.delete).toHaveBeenCalledWith(expect.objectContaining({ hash: 'a_b', ext: '.webp' }));
    expect(imageQuery.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('removeFiles deletes each provider file and keeps going after a failure', async () => {
    const del = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const { service, imageQuery } = build({ delete: del });
    const rec = (id: number) => ({ id, hash: `h${id}`, ext: '.webp', mime: 'image/webp', url: `/u/${id}` });
    await service.removeFiles([rec(1), rec(2)]);
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenLastCalledWith(expect.objectContaining({ hash: 'h2', ext: '.webp' }));
    expect(imageQuery.delete).not.toHaveBeenCalled();
  });

  describe('uploadStoreLogo', () => {
    it('sends a PNG fitted into 480x96 and creates no image row', async () => {
      const { service, provider, imageQuery } = build();
      const buffer = await sharp({ create: { width: 1000, height: 500, channels: 3, background: '#0f0' } }).png().toBuffer();
      const logo = await service.uploadStoreLogo({ buffer, originalName: 'logo.png' });
      const file = provider.upload.mock.calls[0][0];
      expect(file.ext).toBe('.png');
      expect(file.mime).toBe('image/png');
      expect(file.hash).toMatch(/^store-logo_[0-9a-f]{10}$/);
      expect(logo).toMatchObject({ width: 192, height: 96, url: `/uploads/${file.hash}.png` });
      expect(imageQuery.create).not.toHaveBeenCalled();
    });

    it('does not enlarge a small JPEG', async () => {
      const { service } = build();
      const buffer = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#00f' } }).jpeg().toBuffer();
      const logo = await service.uploadStoreLogo({ buffer, originalName: 'l.jpg' });
      expect(logo).toMatchObject({ width: 100, height: 50 });
    });

    it('rejects a non-image without calling the provider', async () => {
      const { service, provider } = build();
      await expect(
        service.uploadStoreLogo({ buffer: Buffer.from('not an image'), originalName: 'x.txt' })
      ).rejects.toThrow('INVALID_IMAGE');
      expect(provider.upload).not.toHaveBeenCalled();
    });
  });
});
