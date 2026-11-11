import { describe, it, expect, vi } from 'vitest';
import {
  ECOMMERCE_PERMISSIONS,
  registerEcommercePermissions,
} from '../../../server/src/services/modules/ecommerce/permissions';

describe('registerEcommercePermissions', () => {
  it('exposes the product action uids', () => {
    expect(ECOMMERCE_PERMISSIONS.productsRead).toBe(
      'plugin::littlebox-strapi-suite.ecommerce.products.read'
    );
    expect(ECOMMERCE_PERMISSIONS.productsManage).toBe(
      'plugin::littlebox-strapi-suite.ecommerce.products.manage'
    );
  });

  it('registers read and manage actions', async () => {
    const registerMany = vi.fn().mockResolvedValue(undefined);
    const strapi = {
      admin: { services: { permission: { actionProvider: { registerMany } } } },
    };

    await registerEcommercePermissions(strapi as any);

    expect(registerMany).toHaveBeenCalledTimes(1);
    const actions = registerMany.mock.calls[0][0];
    expect(actions).toHaveLength(2);
    expect(actions).toEqual([
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.products.read',
        displayName: 'Read products',
      }),
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.products.manage',
        displayName: 'Manage products',
      }),
    ]);
  });
});
