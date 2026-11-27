import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../ecommerce/helpers/fakeDb';
import DuplicateRunService, {
  DUPLICATE_RUNS_KEPT,
  DUPLICATE_FAILURES_KEPT,
  DUPLICATE_NOTES_KEPT,
} from '../../../server/src/services/modules/duplicate/runs';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const RUN = 'plugin::littlebox-strapi-suite.ltb-st-module-duplicate-run';
const NOW = new Date('2026-11-27T10:00:00.000Z');
const MIN = 60_000;

const INPUT = {
  sourceLocale: 'en',
  targetLocale: 'pt',
  options: { existing: 'skip', status: 'follow', ecommerce: false },
  userId: '1',
  userName: 'Ana Admin',
  total: 3,
};

const setup = () => {
  const db = createFakeDb([RUN], {});
  const strapi = { db, config: { get: () => ({ uuid: { modules: { duplicateRun: RUN } } }) } };
  return { svc: DuplicateRunService({ strapi } as never), rows: () => db.tables[RUN] };
};

describe('duplicate run content type', () => {
  const ct: any = (contentTypes as any)['ltb-st-module-duplicate-run'];

  it('is registered under its singular name, hidden and not localized', () => {
    expect(ct.schema.info.singularName).toBe('ltb-st-module-duplicate-run');
    expect(ct.schema.collectionName).toBe('ltb_st_module_duplicate_runs');
    expect(ct.schema.options.draftAndPublish).toBe(false);
    expect(ct.schema.pluginOptions['content-manager'].visible).toBe(false);
    expect(ct.schema.pluginOptions['content-type-builder'].visible).toBe(false);
    expect(ct.schema.pluginOptions.i18n.localized).toBe(false);
  });

  it('declares the run attributes and the started_at index', () => {
    expect(Object.keys(ct.schema.attributes).sort()).toEqual(
      [
        'status', 'sourceLocale', 'targetLocale', 'options', 'startedAt', 'finishedAt',
        'userId', 'userName', 'progress', 'counts', 'failures',
      ].sort()
    );
    expect(ct.schema.attributes.status.enum).toEqual(['RUNNING', 'SUCCESS', 'FAILED', 'INTERRUPTED']);
    expect(ct.schema.attributes.status.default).toBe('RUNNING');
    expect(ct.schema.attributes.startedAt.required).toBe(true);
    expect(ct.schema.indexes).toEqual([{ name: 'duplicate_run_started', columns: ['started_at'] }]);
  });

  it('has its uid in the plugin config', () => {
    expect((config as any).default.uuid.modules.duplicateRun).toBe(RUN);
  });
});

describe('DuplicateRunService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('records a RUNNING run with empty progress and counts', async () => {
    const { svc } = setup();
    const id = await svc.start(INPUT);
    expect(await svc.running()).toEqual({
      id,
      status: 'RUNNING',
      sourceLocale: 'en',
      targetLocale: 'pt',
      options: { existing: 'skip', status: 'follow', ecommerce: false },
      startedAt: NOW.toISOString(),
      finishedAt: null,
      userId: '1',
      userName: 'Ana Admin',
      progress: { total: 3, done: 0, current: null },
      counts: { duplicated: 0, replaced: 0, skipped: 0, untranslated: 0, failed: 0 },
      failures: [],
    });
  });

  it('writes progress, merges counts and appends failures', async () => {
    const { svc } = setup();
    const id = await svc.start(INPUT);
    const current = { uid: 'api::page.page', documentId: 'p1', title: 'About' };
    await svc.progress(id, { done: 1, current, counts: { duplicated: 1 } });
    await svc.progress(id, {
      done: 2,
      counts: { failed: 1 },
      failure: { uid: 'api::page.page', documentId: 'p2', reason: 'Boom' },
    });
    const run = (await svc.running())!;
    expect(run.progress).toEqual({ total: 3, done: 2, current });
    expect(run.counts).toEqual({ duplicated: 1, replaced: 0, skipped: 0, untranslated: 0, failed: 1 });
    expect(run.failures).toEqual([{ uid: 'api::page.page', documentId: 'p2', reason: 'Boom' }]);
  });

  it(`keeps at most ${DUPLICATE_FAILURES_KEPT} failures`, async () => {
    const { svc } = setup();
    const id = await svc.start(INPUT);
    const failures = Array.from({ length: DUPLICATE_FAILURES_KEPT + 3 }, (_, i) => ({
      uid: 'api::page.page',
      documentId: `d${i}`,
      reason: 'x',
    }));
    await svc.progress(id, { failures });
    const run = (await svc.running())!;
    expect(run.failures).toHaveLength(DUPLICATE_FAILURES_KEPT);
    expect(run.failures[0].documentId).toBe('d0');
  });

  it('relation notes are capped apart and never hide a real failure', async () => {
    const { svc } = setup();
    const id = await svc.start(INPUT);
    const notes = Array.from({ length: DUPLICATE_NOTES_KEPT + 10 }, (_, i) => ({
      uid: 'api::page.page',
      documentId: `n${i}`,
      reason: 'Relation "x" left empty',
      kind: 'note' as const,
    }));
    await svc.progress(id, { failures: notes });
    await svc.progress(id, { failure: { uid: 'api::page.page', documentId: 'real', reason: 'Write refused' } });
    const run = (await svc.running())!;
    expect(run.failures[0]).toEqual({ uid: 'api::page.page', documentId: 'real', reason: 'Write refused' });
    expect(run.failures.filter((f) => f.kind === 'note')).toHaveLength(DUPLICATE_NOTES_KEPT);
    expect(run.failures[1]).toMatchObject({ documentId: 'n0', kind: 'note' });
  });

  it('a failing prune does not fail the start (the RUNNING row has a job behind it)', async () => {
    const db = createFakeDb([RUN], {});
    const query = db.query.bind(db);
    const strapi = {
      db: {
        ...db,
        query: (uid: string) => {
          const q: any = query(uid as never);
          return {
            ...q,
            findMany: async (args: any) => {
              if (args?.offset !== undefined) throw new Error('lock timeout');
              return q.findMany(args);
            },
          };
        },
      },
      config: { get: () => ({ uuid: { modules: { duplicateRun: RUN } } }) },
      log: { warn: vi.fn() },
    };
    const svc = DuplicateRunService({ strapi } as never);
    const id = await svc.start(INPUT);
    expect((await svc.running())?.id).toBe(id);
    expect(strapi.log.warn).toHaveBeenCalled();
  });

  it('finishes only a RUNNING run, and clears the current document', async () => {
    const { svc } = setup();
    const id = await svc.start(INPUT);
    await svc.progress(id, { current: { uid: 'api::page.page', documentId: 'p1' } });
    vi.setSystemTime(new Date(NOW.getTime() + 5000));
    await svc.finish(id, 'SUCCESS');
    await svc.finish(id, 'FAILED');
    expect(await svc.running()).toBeNull();
    const [run] = await svc.list();
    expect(run.status).toBe('SUCCESS');
    expect(run.finishedAt).toBe(new Date(NOW.getTime() + 5000).toISOString());
    expect(run.progress.current).toBeNull();
  });

  it('a progress write never reopens a closed run', async () => {
    const { svc } = setup();
    const id = await svc.start(INPUT);
    await svc.interruptAll();
    await svc.progress(id, { done: 3 });
    const [run] = await svc.list();
    expect(run.status).toBe('INTERRUPTED');
    expect(run.progress.done).toBe(0);
  });

  it('marks every RUNNING run INTERRUPTED (boot sweep)', async () => {
    const { svc } = setup();
    const a = await svc.start(INPUT);
    const b = await svc.start(INPUT);
    await svc.finish(a, 'SUCCESS');
    expect(await svc.interruptAll()).toBe(1);
    const runs = await svc.list();
    expect(runs.find((r) => r.id === b)!.status).toBe('INTERRUPTED');
    expect(runs.find((r) => r.id === b)!.finishedAt).toBe(NOW.toISOString());
    expect(runs.find((r) => r.id === a)!.status).toBe('SUCCESS');
    expect(await svc.running()).toBeNull();
  });

  it(`keeps and lists only the newest ${DUPLICATE_RUNS_KEPT} runs, newest first`, async () => {
    const { svc, rows } = setup();
    for (let i = 0; i < DUPLICATE_RUNS_KEPT + 4; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + i * MIN));
      const id = await svc.start(INPUT);
      await svc.finish(id, 'SUCCESS');
    }
    expect(rows()).toHaveLength(DUPLICATE_RUNS_KEPT);
    const list = await svc.list();
    expect(list).toHaveLength(DUPLICATE_RUNS_KEPT);
    expect(list[0].startedAt).toBe(new Date(NOW.getTime() + (DUPLICATE_RUNS_KEPT + 3) * MIN).toISOString());
  });

  it('sanitises stored json in the view', async () => {
    const { svc, rows } = setup();
    const id = await svc.start(INPUT);
    Object.assign(rows().find((r) => r.id === id), {
      progress: 'bad',
      counts: { duplicated: 'x', skipped: 2 },
      failures: [{ uid: 1 }, { uid: 'api::a.a', documentId: 'd', reason: 'r', title: 'T' }],
      options: null,
    });
    const run = (await svc.running())!;
    expect(run.progress).toEqual({ total: 0, done: 0, current: null });
    expect(run.counts).toEqual({ duplicated: 0, replaced: 0, skipped: 2, untranslated: 0, failed: 0 });
    expect(run.failures).toEqual([{ uid: 'api::a.a', documentId: 'd', reason: 'r', title: 'T' }]);
    expect(run.options).toEqual({});
  });
});
