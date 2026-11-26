import { describe, it, expect, vi } from 'vitest';
import { errors } from '@strapi/utils';
import {
  ORPHAN_AGE_MS,
  SCAN_BATCH_SIZE,
  collectOrphans,
  createImageFieldMiddleware,
  deleteUnreferenced,
  fieldPaths,
  isReferenced,
} from '../../../server/src/services/modules/image-field/cleanup';
import { IMAGE_FIELD_UID } from '../../../server/src/services/modules/image-field/domain/values';

const REGISTRY = 'plugin::littlebox-strapi-suite.ltb-st-module-image-field-file';
const FILE = 'plugin::upload.file';
const PAGE = 'api::page.page';
const ARTICLE = 'api::article.article';
const img = (id: number) => ({ id });
/** Lets deferred (setImmediate) cleanup work run to completion. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** A tiny in-memory db: each uid is an array of rows; components are stored pre-populated. */
function build(
  opts: {
    pages?: any[];
    components?: any[];
    registry?: any[];
    files?: (number | Record<string, any>)[];
    mediaLinks?: number[];
    articles?: any[];
    texts?: any[];
  } = {}
) {
  const tables: Record<string, any[]> = {
    [PAGE]: opts.pages ?? [],
    'blocks.slide': opts.components ?? [],
    [REGISTRY]: opts.registry ?? [],
    [FILE]: (opts.files ?? []).map((f) =>
      typeof f === 'number' ? { id: f, provider: 'local' } : { provider: 'local', ...f }
    ),
    [ARTICLE]: opts.articles ?? [],
    'blocks.text': opts.texts ?? [],
  };
  const matches = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, cond]: [string, any]) => {
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('$gt' in cond) return row[k] > cond.$gt;
        if ('$lt' in cond) return new Date(row[k]).getTime() < new Date(cond.$lt).getTime();
        if ('$in' in cond) return cond.$in.includes(row[k]);
      }
      return row[k] === cond;
    });
  const queries: Record<string, any> = {};
  const query = vi.fn((uid: string) => {
    queries[uid] ??= {
      findMany: vi.fn(async ({ where, limit }: any = {}) => {
        const rows = (tables[uid] ?? []).filter((r) => matches(r, where));
        rows.sort((a, b) => a.id - b.id);
        return structuredClone(limit ? rows.slice(0, limit) : rows);
      }),
      findOne: vi.fn(
        async ({ where }: any) => (tables[uid] ?? []).find((r) => matches(r, where)) ?? null
      ),
      delete: vi.fn(async ({ where }: any) => {
        tables[uid] = tables[uid].filter((r) => !matches(r, where));
      }),
    };
    return queries[uid];
  });
  const remove = vi.fn(async (file: any) => {
    tables[FILE] = tables[FILE].filter((f) => f.id !== file.id);
  });
  const commitCallbacks: (() => void)[] = [];
  let inTrx = false;
  const strapi: any = {
    contentTypes: {
      [PAGE]: {
        options: { draftAndPublish: true },
        attributes: {
          cover: { type: 'json', customField: IMAGE_FIELD_UID },
          slides: { type: 'component', component: 'blocks.slide', repeatable: true },
        },
      },
      'api::plain.plain': { attributes: { title: { type: 'string' } } },
      [ARTICLE]: { attributes: { body: { type: 'blocks' }, notes: { type: 'richtext' } } },
    },
    components: {
      'blocks.slide': {
        attributes: {
          photos: {
            type: 'json',
            customField: IMAGE_FIELD_UID,
            options: { mode: 'gallery', maxImages: 2 },
            required: true,
          },
        },
      },
      'blocks.text': { attributes: { content: { type: 'blocks' } } },
    },
    db: {
      query,
      metadata: {
        get: () => ({
          attributes: {
            related: { joinTable: { name: 'files_related_mph', joinColumn: { name: 'file_id' } } },
          },
        }),
      },
      getConnection: vi.fn(() => ({
        select: () => ({
          whereIn: async (_c: string, ids: number[]) =>
            (opts.mediaLinks ?? [])
              .filter((id) => ids.includes(id))
              .map((file_id) => ({ file_id })),
        }),
      })),
      inTransaction: () => inTrx,
      transaction: async (cb: any) =>
        cb({ onCommit: (fn: () => void) => commitCallbacks.push(fn) }),
    },
    plugin: vi.fn(() => ({ service: () => ({ remove }) })),
    log: { warn: vi.fn() },
  };
  return {
    strapi,
    tables,
    remove,
    setInTransaction: (v: boolean) => (inTrx = v),
    commit: () => commitCallbacks.splice(0).forEach((fn) => fn()),
  };
}

describe('fieldPaths', () => {
  it('finds fields in content types and components and the content types reaching them', () => {
    const { strapi } = build();
    const paths = fieldPaths(strapi);
    expect(paths.fields.map((f) => `${f.uid}.${f.attribute}`)).toEqual([
      `${PAGE}.cover`,
      'blocks.slide.photos',
    ]);
    expect(paths.fields[1]).toMatchObject({
      kind: 'component',
      required: true,
      options: { maxImages: 2 },
    });
    expect([...paths.populate.keys()]).toEqual([PAGE]);
    expect(paths.populate.get(PAGE)).toEqual({ slides: { populate: {} } });
  });
});

describe('isReferenced', () => {
  it('scans content type and component rows, across batches', async () => {
    const pages = Array.from({ length: SCAN_BATCH_SIZE + 3 }, (_, i) => ({
      id: i + 1,
      cover: null,
    }));
    pages[SCAN_BATCH_SIZE + 1].cover = img(42);
    const { strapi } = build({ pages, components: [{ id: 1, photos: [img(7)] }] });
    expect(await isReferenced(strapi, 42)).toBe(true);
    expect(await isReferenced(strapi, 7)).toBe(true);
    expect(await isReferenced(strapi, 8)).toBe(false);
  });

  it('counts an image block (by id or url) in a blocks field, in content types and components', async () => {
    const imageBlock = (image: any) => [
      { type: 'paragraph', children: [{ type: 'text', text: 'hi' }] },
      { type: 'image', image, children: [{ type: 'text', text: '' }] },
    ];
    const { strapi } = build({
      files: [
        { id: 20, url: '/uploads/a_1.webp', hash: 'a_1' },
        { id: 21, url: '/uploads/b_2.webp', hash: 'b_2' },
        { id: 22, url: '/uploads/c_3.webp', hash: 'c_3' },
      ],
      articles: [{ id: 1, body: imageBlock({ id: 20 }), notes: null }],
      texts: [{ id: 1, content: imageBlock({ url: '/uploads/b_2.webp' }) }],
    });
    expect(await isReferenced(strapi, 20)).toBe(true);
    expect(await isReferenced(strapi, 21)).toBe(true);
    expect(await isReferenced(strapi, 22)).toBe(false);
  });

  it('counts a markdown (richtext) mention of the url, a format url or the hash', async () => {
    const { strapi } = build({
      files: [
        { id: 30, url: 'https://cdn.x/a_1.webp', hash: 'a_1' },
        {
          id: 31,
          url: 'https://cdn.x/b_2.webp',
          hash: 'b_2',
          formats: { small: { url: 'https://cdn.x/small_b_2.webp', hash: 'small_b_2' } },
        },
        { id: 32, url: 'https://cdn.x/c_3.webp', hash: 'c_3' },
        { id: 33, url: '/uploads/d_4.webp', hash: 'd_4' },
      ],
      articles: [
        { id: 1, notes: 'See ![a](https://cdn.x/a_1.webp)' },
        { id: 2, notes: '![b](https://cdn.x/small_b_2.webp)' },
        { id: 3, notes: 'ref d_4 here' },
      ],
    });
    expect(await isReferenced(strapi, 30)).toBe(true);
    expect(await isReferenced(strapi, 31)).toBe(true);
    expect(await isReferenced(strapi, 32)).toBe(false);
    expect(await isReferenced(strapi, 33)).toBe(true);
  });

  it('scans blocks fields across batches', async () => {
    const articles = Array.from({ length: SCAN_BATCH_SIZE + 2 }, (_, i) => ({
      id: i + 1,
      body: [],
    }));
    articles[SCAN_BATCH_SIZE + 1].body = [{ type: 'image', image: { id: 40 }, children: [] }];
    const { strapi } = build({ files: [40], articles });
    expect(await isReferenced(strapi, 40)).toBe(true);
  });

  it('counts a link from a regular Strapi media field as a use', async () => {
    const { strapi } = build({ mediaLinks: [9] });
    expect(await isReferenced(strapi, 9)).toBe(true);
  });
});

describe('deleteUnreferenced', () => {
  it('deletes an unreferenced registry file and its row', async () => {
    const { strapi, tables, remove } = build({ registry: [{ id: 1, fileId: 5 }], files: [5] });
    expect(await deleteUnreferenced(strapi, REGISTRY, [5])).toEqual([5]);
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
    expect(tables[REGISTRY]).toEqual([]);
  });

  it('keeps a file still referenced elsewhere (e.g. by the published version)', async () => {
    const { strapi, remove, tables } = build({
      registry: [{ id: 1, fileId: 5 }],
      files: [5],
      pages: [{ id: 2, documentId: 'd', publishedAt: '2026-01-01', cover: img(5) }],
    });
    expect(await deleteUnreferenced(strapi, REGISTRY, [5])).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    expect(tables[REGISTRY]).toHaveLength(1);
  });

  it('never deletes a file that is not in the registry', async () => {
    const { strapi, remove } = build({ files: [5] });
    expect(await deleteUnreferenced(strapi, REGISTRY, [5])).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('collectOrphans', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const ago = (h: number) => new Date(now - h * 3600 * 1000).toISOString();

  it('deletes unreferenced files older than 24 h only', async () => {
    const { strapi, remove, tables } = build({
      registry: [
        { id: 1, fileId: 10, createdAt: ago(23) },
        { id: 2, fileId: 11, createdAt: ago(25) },
        { id: 3, fileId: 12, createdAt: ago(25) },
      ],
      files: [10, 11, 12],
      pages: [{ id: 1, documentId: 'd', cover: img(12) }],
    });
    expect(ORPHAN_AGE_MS).toBe(24 * 3600 * 1000);
    expect(await collectOrphans(strapi, REGISTRY, now)).toEqual([11]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(tables[REGISTRY].map((r) => r.fileId)).toEqual([10, 12]);
  });

  it('drops registry rows whose file no longer exists', async () => {
    const { strapi, remove, tables } = build({
      registry: [{ id: 1, fileId: 10, createdAt: ago(30) }],
      files: [],
    });
    await collectOrphans(strapi, REGISTRY, now);
    expect(remove).not.toHaveBeenCalled();
    expect(tables[REGISTRY]).toEqual([]);
  });
});

describe('document middleware', () => {
  const run = async (env: ReturnType<typeof build>, ctx: any, mutate: () => void = () => {}) => {
    const mw = createImageFieldMiddleware(env.strapi, () => REGISTRY);
    const next = vi.fn(async () => {
      mutate();
      return 'result';
    });
    const result = await mw(ctx, next);
    return { result, next };
  };

  it('rejects an invalid value before saving', async () => {
    const env = build();
    const ctx = {
      uid: PAGE,
      action: 'update',
      params: { documentId: 'd', data: { slides: [{ photos: [img(1), img(2), img(3)] }] } },
    };
    const mw = createImageFieldMiddleware(env.strapi, () => REGISTRY);
    const next = vi.fn();
    await expect(mw(ctx, next)).rejects.toThrow(errors.ValidationError);
    expect(next).not.toHaveBeenCalled();
  });

  it('a draft may leave a required gallery empty; publishing it may not', async () => {
    const env = build({
      pages: [
        {
          id: 1,
          documentId: 'd',
          publishedAt: null,
          locale: 'en',
          cover: null,
          slides: [{ id: 1, photos: [] }],
        },
      ],
    });
    const save = await run(env, {
      uid: PAGE,
      action: 'update',
      params: { documentId: 'd', data: { slides: [{ photos: [] }] } },
    });
    expect(save.result).toBe('result');
    await expect(
      run(env, { uid: PAGE, action: 'publish', params: { documentId: 'd', locale: 'en' } })
    ).rejects.toThrow(errors.ValidationError);
  });

  it('keeps a file removed from the draft while the published version still has it', async () => {
    const env = build({
      registry: [{ id: 1, fileId: 5 }],
      files: [5],
      pages: [
        { id: 1, documentId: 'd', publishedAt: null, cover: img(5) },
        { id: 2, documentId: 'd', publishedAt: '2026-01-01', cover: img(5) },
      ],
    });
    await run(
      env,
      { uid: PAGE, action: 'update', params: { documentId: 'd', data: { cover: null } } },
      () => {
        env.tables[PAGE][0].cover = null;
      }
    );
    await settle();
    expect(env.remove).not.toHaveBeenCalled();

    // Publishing the draft drops the last reference: the file goes.
    await run(env, { uid: PAGE, action: 'publish', params: { documentId: 'd' } }, () => {
      env.tables[PAGE][1].cover = null;
    });
    await vi.waitFor(() =>
      expect(env.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }))
    );
    await vi.waitFor(() => expect(env.tables[REGISTRY]).toEqual([]));
  });

  it('deletes the files of a deleted entry, through components too', async () => {
    const env = build({
      registry: [
        { id: 1, fileId: 5 },
        { id: 2, fileId: 6 },
      ],
      files: [5, 6],
      pages: [{ id: 1, documentId: 'd', cover: img(5), slides: [{ id: 1, photos: [img(6)] }] }],
    });
    await run(env, { uid: PAGE, action: 'delete', params: { documentId: 'd' } }, () => {
      env.tables[PAGE] = [];
    });
    await vi.waitFor(() => expect(env.remove).toHaveBeenCalledTimes(2));
  });

  it('answers before the deletion work runs (outside a transaction)', async () => {
    const env = build({
      registry: [{ id: 1, fileId: 5 }],
      files: [5],
      pages: [{ id: 1, documentId: 'd', cover: img(5) }],
    });
    const { result } = await run(
      env,
      { uid: PAGE, action: 'delete', params: { documentId: 'd' } },
      () => {
        env.tables[PAGE] = [];
      }
    );
    expect(result).toBe('result');
    expect(env.remove).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(env.remove).toHaveBeenCalledTimes(1));
  });

  it('a failing "before" snapshot only skips cleanup', async () => {
    const env = build({ pages: [{ id: 1, documentId: 'd', cover: img(5) }] });
    const realQuery = env.strapi.db.query.getMockImplementation();
    env.strapi.db.query.mockImplementation((uid: string) => {
      const q = realQuery(uid);
      if (uid !== PAGE) return q;
      return { ...q, findMany: vi.fn().mockRejectedValue(new Error('db busy')) };
    });
    const { result, next } = await run(env, {
      uid: PAGE,
      action: 'delete',
      params: { documentId: 'd' },
    });
    expect(result).toBe('result');
    expect(next).toHaveBeenCalled();
    expect(env.strapi.log.warn).toHaveBeenCalledWith(expect.not.stringContaining('db busy'));
  });

  it('replaces incoming values with the stored file (order kept) and refuses unknown ids', async () => {
    const env = build({
      files: [
        { id: 5, url: '/uploads/real5.webp', name: 'five.webp', folder: { id: 1 } },
        { id: 6, url: '/uploads/real6.webp', name: 'six.webp' },
      ],
      pages: [{ id: 1, documentId: 'd', cover: null }],
    });
    const data: any = {
      cover: { id: 5, url: 'https://evil.example/x.png', name: 'forged' },
      slides: [{ photos: [{ id: 6, url: 'x' }, { id: 5 }] }],
    };
    await run(env, { uid: PAGE, action: 'update', params: { documentId: 'd', data } });
    expect(data.cover).toMatchObject({ id: 5, url: '/uploads/real5.webp', name: 'five.webp' });
    expect(data.cover.folder).toBeUndefined();
    expect(data.slides[0].photos.map((p: any) => [p.id, p.url])).toEqual([
      [6, '/uploads/real6.webp'],
      [5, '/uploads/real5.webp'],
    ]);

    const bad = { uid: PAGE, action: 'create', params: { data: { cover: { id: 77 } } } };
    const mw = createImageFieldMiddleware(env.strapi, () => REGISTRY);
    const next = vi.fn();
    await expect(mw(bad, next)).rejects.toThrow(errors.ValidationError);
    await expect(mw(bad, next)).rejects.toThrow(/cover/);
    expect(next).not.toHaveBeenCalled();
  });

  it('waits for the surrounding transaction to commit', async () => {
    const env = build({
      registry: [{ id: 1, fileId: 5 }],
      files: [5],
      pages: [{ id: 1, documentId: 'd', cover: img(5) }],
    });
    env.setInTransaction(true);
    await run(env, { uid: PAGE, action: 'delete', params: { documentId: 'd' } }, () => {
      env.tables[PAGE] = [];
    });
    expect(env.remove).not.toHaveBeenCalled();
    env.setInTransaction(false);
    env.commit();
    await vi.waitFor(() => expect(env.remove).toHaveBeenCalledTimes(1));
  });

  it('never fails the action when cleanup fails', async () => {
    const env = build({
      registry: [{ id: 1, fileId: 5 }],
      files: [5],
      pages: [{ id: 1, documentId: 'd', cover: img(5) }],
    });
    env.remove.mockRejectedValueOnce(new Error('disk'));
    const { result } = await run(
      env,
      { uid: PAGE, action: 'delete', params: { documentId: 'd' } },
      () => {
        env.tables[PAGE] = [];
      }
    );
    expect(result).toBe('result');
    await vi.waitFor(() => expect(env.strapi.log.warn).toHaveBeenCalled());
  });

  it('ignores content types without the field and unrelated actions', async () => {
    const env = build();
    const a = await run(env, {
      uid: 'api::plain.plain',
      action: 'delete',
      params: { documentId: 'x' },
    });
    const b = await run(env, { uid: PAGE, action: 'findMany', params: {} });
    expect(a.next).toHaveBeenCalled();
    expect(b.next).toHaveBeenCalled();
    expect(env.strapi.db.query).not.toHaveBeenCalled();
  });
});
