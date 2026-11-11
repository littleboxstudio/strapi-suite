import { describe, it, expect } from 'vitest';
import {
  PROMOTIONS_MANAGE_ACTION,
  PROMOTIONS_READ_ACTION,
  filterMenu,
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

describe('promotions permissions', () => {
  it('pins the action uids and the useRBAC keys', () => {
    expect(PROMOTIONS_READ_ACTION).toBe('plugin::littlebox-strapi-suite.ecommerce.promotions.read');
    expect(PROMOTIONS_MANAGE_ACTION).toBe('plugin::littlebox-strapi-suite.ecommerce.promotions.manage');
    expect(rbacKey(PROMOTIONS_MANAGE_ACTION)).toBe('canManage');
    expect(rbacKey(PROMOTIONS_READ_ACTION)).toBe('canRead');
  });
});

describe('filterMenu', () => {
  const menu = [
    { key: 'products' },
    { key: 'orders' },
    { key: 'customers' },
    { key: 'promotions' },
    { key: 'settings' },
  ];

  it('hides promotions without promotions.read and keeps the other items in order', () => {
    expect(filterMenu(menu, []).map((i) => i.key)).toEqual(['products', 'orders', 'customers', 'settings']);
    expect(filterMenu(menu, [PROMOTIONS_MANAGE_ACTION]).map((i) => i.key)).not.toContain('promotions');
  });

  it('shows promotions with promotions.read', () => {
    expect(filterMenu(menu, [PROMOTIONS_READ_ACTION]).map((i) => i.key)).toEqual(menu.map((i) => i.key));
  });
});
