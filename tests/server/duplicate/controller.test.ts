import { describe, expect, it, vi } from 'vitest';
import DuplicateController from '../../../server/src/controllers/modules/duplicate';
import { DuplicateError } from '../../../server/src/services/modules/duplicate/errors';

const setup = () => {
  const duplicate = { summary: vi.fn(), start: vi.fn() };
  const runs = { list: vi.fn(), running: vi.fn() };
  const locales = {
    find: vi.fn(async () => [
      { id: 1, code: 'en', name: 'English (en)', isDefault: true },
      { id: 2, code: 'pt', name: 'Portuguese (pt)', isDefault: false },
    ]),
    getDefaultLocale: vi.fn(async () => 'en'),
  };
  const strapi: any = {
    plugin: (id: string) => ({
      service: (name: string) =>
        id === 'i18n' ? locales : ({ DuplicateService: duplicate, DuplicateRunService: runs } as any)[name],
    }),
  };
  const ctx = (body: any = {}, user: any = { id: 3, firstname: 'Ana', lastname: 'Admin', email: 'ana@example.com' }) =>
    ({ request: { body }, params: {}, query: {}, state: { user }, status: 200, body: undefined }) as any;
  return { controller: DuplicateController({ strapi }), duplicate, runs, ctx };
};

describe('DuplicateController', () => {
  it('lists the locales with the default one', async () => {
    const { controller, ctx } = setup();
    const c = ctx();
    await controller.getLocales(c);
    expect(c.body).toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', name: 'English (en)' },
        { code: 'pt', name: 'Portuguese (pt)' },
      ],
    });
  });

  it('answers the summary', async () => {
    const { controller, duplicate, ctx } = setup();
    duplicate.summary.mockResolvedValue({ sourceLocale: 'en' });
    const c = ctx({ targetLocale: 'pt', ecommerce: true });
    await controller.summary(c);
    expect(duplicate.summary).toHaveBeenCalledWith('pt', true);
    expect(c.body).toEqual({ sourceLocale: 'en' });
  });

  it('starts a run with 202 and the user who asked', async () => {
    const { controller, duplicate, ctx } = setup();
    duplicate.start.mockResolvedValue({ runId: 9 });
    const body = { targetLocale: 'pt', existing: 'skip', status: 'follow', ecommerce: false };
    const c = ctx(body);
    await controller.start(c);
    expect(duplicate.start).toHaveBeenCalledWith(body, { id: 3, name: 'Ana Admin' });
    expect(c.status).toBe(202);
    expect(c.body).toEqual({ runId: 9 });
  });

  it('names the user by username when there is no first or last name', async () => {
    const { controller, duplicate, ctx } = setup();
    duplicate.start.mockResolvedValue({ runId: 1 });
    await controller.start(ctx({}, { id: 4, username: 'ops' }));
    expect(duplicate.start.mock.calls[0][1]).toEqual({ id: 4, name: 'ops' });
  });

  it.each([
    ['RUN_IN_PROGRESS', 409],
    ['invalid_locale', 400],
    ['invalid_option', 400],
  ] as const)('maps %s to %i', async (code, status) => {
    const { controller, duplicate, ctx } = setup();
    duplicate.start.mockRejectedValue(new DuplicateError(code));
    duplicate.summary.mockRejectedValue(new DuplicateError(code));
    const c = ctx({});
    await controller.start(c);
    expect(c.status).toBe(status);
    expect(c.body).toMatchObject({ data: null, error: { status, details: { code } } });
    const s = ctx({});
    await controller.summary(s);
    expect(s.status).toBe(status);
    expect(s.body).toMatchObject({ data: null, error: { status, details: { code } } });
  });

  it('rethrows unexpected errors', async () => {
    const { controller, duplicate, ctx } = setup();
    duplicate.start.mockRejectedValue(new TypeError('boom'));
    await expect(controller.start(ctx({}))).rejects.toThrow('boom');
  });

  it('lists the runs and gives the running one', async () => {
    const { controller, runs, ctx } = setup();
    runs.list.mockResolvedValue([{ id: 2 }, { id: 1 }]);
    runs.running.mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce(null);
    const list = ctx();
    await controller.listRuns(list);
    expect(list.body).toEqual([{ id: 2 }, { id: 1 }]);
    const current = ctx();
    await controller.currentRun(current);
    expect(current.body).toEqual({ run: { id: 2 } });
    const none = ctx();
    await controller.currentRun(none);
    expect(none.body).toEqual({ run: null });
  });
});
