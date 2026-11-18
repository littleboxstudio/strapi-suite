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
    update: vi.fn().mockResolvedValue(undefined),
    updateMany: vi.fn().mockResolvedValue(undefined),
  };
  const query = vi.fn((uid: string) => {
    if (uid === IMAGE_UID) return imageQuery;
    throw new Error(`unexpected query ${uid}`);
  });
  const strapi: any = {
    db: { query, transaction: vi.fn(async (fn: any) => fn()) },
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
    expect(data.cover).toBe(false);
    expect(rec).toMatchObject({ width: 200, height: 150, url: data.url, position: 3, cover: false });
  });

  it('the first image of a gallery is its cover', async () => {
    const { service } = build({}, []);
    const rec = await service.upload({
      buffer: await png(),
      originalName: 'a.png',
      transform: { mode: 'resize', width: 20, height: 15 },
      owner: { variantId: 4 },
    });
    expect(rec.cover).toBe(true);
  });

  describe('reorder', () => {
    const gallery = [
      { id: 5, position: 1, cover: false },
      { id: 6, position: 2, cover: true },
      { id: 7, position: 3, cover: false },
    ];

    it('saves positions 1..n in the given order', async () => {
      const { service, imageQuery } = build({}, gallery);
      expect(await service.reorder({ productId: 3 }, [7, 5, 6])).toEqual({ coverId: 6 });
      expect(imageQuery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { product: 3 } }));
      expect(imageQuery.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.position])).toEqual([
        [7, 1],
        [5, 2],
        [6, 3],
      ]);
    });

    it('the cover never moves with the order; an unmarked gallery gets its first image marked', async () => {
      const { service, imageQuery } = build({}, gallery.map((g) => ({ ...g, cover: false })));
      expect(await service.reorder({ productId: 3 }, [7, 5, 6])).toEqual({ coverId: 5 });
      expect(imageQuery.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { position: 2, cover: true } });
      expect(imageQuery.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { position: 1 } });
    });

    it('refuses a list that is not exactly the gallery', async () => {
      const { service, imageQuery } = build({}, gallery);
      await expect(service.reorder({ variantId: 2 }, [7, 5])).rejects.toMatchObject({
        errors: [{ path: 'ids', code: 'IMAGES_CHANGED' }],
      });
      await expect(service.reorder({}, [7, 5, 6])).rejects.toMatchObject({
        errors: [{ path: 'owner', code: 'required' }],
      });
      expect(imageQuery.update).not.toHaveBeenCalled();
    });
  });

  describe('setCover', () => {
    it("marks the image and unmarks its gallery's previous cover", async () => {
      const { service, imageQuery } = build();
      imageQuery.findOne.mockResolvedValue({ id: 7, product: null, variant: { id: 2 } });
      await service.setCover(7);
      expect(imageQuery.updateMany).toHaveBeenCalledWith({
        where: { variant: 2, cover: true, id: { $ne: 7 } },
        data: { cover: false },
      });
      expect(imageQuery.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { cover: true } });
    });

    it('an unknown image is not found', async () => {
      const { service, imageQuery } = build();
      imageQuery.findOne.mockResolvedValue(null);
      await expect(service.setCover(99)).rejects.toThrow('Image not found');
      expect(imageQuery.update).not.toHaveBeenCalled();
    });
  });

  it('remove keeps record when provider fails', async () => {
    const { service, imageQuery } = build({ delete: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(service.remove(7)).rejects.toThrow('boom');
    expect(imageQuery.delete).not.toHaveBeenCalled();
  });

  it('deleting the cover makes the first remaining image the cover', async () => {
    const { service, imageQuery } = build();
    imageQuery.findOne.mockResolvedValue({ id: 7, hash: 'a_b', ext: '.webp', mime: 'image/webp', url: '/u', product: { id: 3 } });
    imageQuery.findMany
      .mockResolvedValueOnce([{ id: 4, position: 1, cover: false }, { id: 7, position: 2, cover: true }])
      .mockResolvedValueOnce([{ id: 4, position: 1, cover: false }]);
    await service.remove(7);
    expect(imageQuery.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(imageQuery.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { cover: true } });
  });

  it('deleting another image keeps the cover', async () => {
    const { service, imageQuery } = build();
    imageQuery.findOne.mockResolvedValue({ id: 7, hash: 'a_b', ext: '.webp', mime: 'image/webp', url: '/u', variant: { id: 2 } });
    imageQuery.findMany.mockResolvedValueOnce([{ id: 4, position: 1, cover: true }, { id: 7, position: 2, cover: false }]);
    await service.remove(7);
    expect(imageQuery.update).not.toHaveBeenCalled();
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

    it('renders a small SVG large enough to fill the box', async () => {
      const { service } = build();
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" fill="#000"/></svg>'
      );
      const logo = await service.uploadStoreLogo({ buffer: svg, originalName: 'logo.svg' });
      expect(logo).toMatchObject({ width: 192, height: 96 });
    });

    it('fails when the provider sets no URL', async () => {
      const { service } = build({ upload: vi.fn(async () => undefined) });
      const buffer = await png();
      await expect(service.uploadStoreLogo({ buffer, originalName: 'l.png' })).rejects.toThrow('UPLOAD_FAILED');
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
