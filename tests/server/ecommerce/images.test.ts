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
});
