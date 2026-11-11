import { describe, it, expect } from 'vitest';
import {
  SETTINGS_MANAGE_ACTION,
  SETTINGS_READ_ACTION,
  rbacKey,
} from '../../../admin/src/ecommerce/utils/rbac';

describe('rbacKey', () => {
  it('uses the last dot segment of the action, prefixed with "can"', () => {
    expect(rbacKey(SETTINGS_MANAGE_ACTION)).toBe('canManage');
    expect(rbacKey(SETTINGS_READ_ACTION)).toBe('canRead');
    expect(rbacKey('admin::roles.create')).toBe('canCreate');
  });

  it('removes hyphens and capitalises each part', () => {
    expect(rbacKey('admin::roles.create-draft')).toBe('canCreateDraft');
  });

  it('pins the settings action uids', () => {
    expect(SETTINGS_READ_ACTION).toBe('plugin::littlebox-strapi-suite.ecommerce.settings.read');
    expect(SETTINGS_MANAGE_ACTION).toBe('plugin::littlebox-strapi-suite.ecommerce.settings.manage');
  });
});
