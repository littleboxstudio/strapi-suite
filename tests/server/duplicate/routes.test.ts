import { describe, expect, it } from 'vitest';
import routes from '../../../server/src/routes/duplicate/admin-duplicate';
import adminRoutes from '../../../server/src/routes/admin-api';
import controllers from '../../../server/src/controllers';
import { DUPLICATE_PERMISSION } from '../../../server/src/services/modules/duplicate/permissions';

const expected: [string, string, string][] = [
  ['GET', '/admin/duplicate/locales', 'getLocales'],
  ['POST', '/admin/duplicate/summary', 'summary'],
  ['GET', '/admin/duplicate/runs/current', 'currentRun'],
  ['GET', '/admin/duplicate/runs', 'listRuns'],
  ['POST', '/admin/duplicate/runs', 'start'],
];

describe('duplicate admin routes', () => {
  it.each(expected)('%s %s is guarded by the duplicate permission', (method, path, handler) => {
    const r: any = routes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r.handler).toBe(`DuplicateController.${handler}`);
    expect(r.config.policies).toEqual([
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [DUPLICATE_PERMISSION] } },
    ]);
    // Never the module middleware: it refuses paths it does not know.
    expect(r.config.middlewares).toBeUndefined();
  });

  it('declares exactly the expected routes', () => {
    expect(routes).toHaveLength(expected.length);
  });

  it('are included in the admin routes, and the controller exists', () => {
    expect(adminRoutes).toEqual(expect.arrayContaining(routes));
    expect((controllers as any).DuplicateController).toBeTypeOf('function');
  });
});
