import { DUPLICATE_PERMISSION } from '../../services/modules/duplicate/permissions';

// No module middleware: duplication is not a module (check-module-is-active refuses unknown paths).
const route = (method: string, path: string, handler: string) => ({
  method,
  path: `/admin/duplicate${path}`,
  handler: `DuplicateController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [DUPLICATE_PERMISSION] } },
    ],
  },
});

export default [
  route('GET', '/locales', 'getLocales'),
  route('POST', '/summary', 'summary'),
  route('GET', '/runs/current', 'currentRun'),
  route('GET', '/runs', 'listRuns'),
  route('POST', '/runs', 'start'),
];
