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

  it('exposes the settings action uids', () => {
    expect(ECOMMERCE_PERMISSIONS.settingsRead).toBe(
      'plugin::littlebox-strapi-suite.ecommerce.settings.read'
    );
    expect(ECOMMERCE_PERMISSIONS.settingsManage).toBe(
      'plugin::littlebox-strapi-suite.ecommerce.settings.manage'
    );
  });

  it('exposes the orders and customers action uids', () => {
    expect(ECOMMERCE_PERMISSIONS.ordersRead).toBe('plugin::littlebox-strapi-suite.ecommerce.orders.read');
    expect(ECOMMERCE_PERMISSIONS.ordersManage).toBe('plugin::littlebox-strapi-suite.ecommerce.orders.manage');
    expect(ECOMMERCE_PERMISSIONS.customersRead).toBe('plugin::littlebox-strapi-suite.ecommerce.customers.read');
    expect(ECOMMERCE_PERMISSIONS.customersManage).toBe('plugin::littlebox-strapi-suite.ecommerce.customers.manage');
  });

  it('exposes the refunds and payments action uids', () => {
    expect(ECOMMERCE_PERMISSIONS.refundsManage).toBe('plugin::littlebox-strapi-suite.ecommerce.refunds.manage');
    expect(ECOMMERCE_PERMISSIONS.paymentsManage).toBe('plugin::littlebox-strapi-suite.ecommerce.payments.manage');
  });

  it('exposes the invoicing action uid', () => {
    expect(ECOMMERCE_PERMISSIONS.invoicingManage).toBe(
      'plugin::littlebox-strapi-suite.ecommerce.invoicing.manage'
    );
  });

  it('exposes the promotions action uids', () => {
    expect(ECOMMERCE_PERMISSIONS.promotionsRead).toBe('plugin::littlebox-strapi-suite.ecommerce.promotions.read');
    expect(ECOMMERCE_PERMISSIONS.promotionsManage).toBe('plugin::littlebox-strapi-suite.ecommerce.promotions.manage');
  });

  it('registers read and manage actions', async () => {
    const registerMany = vi.fn().mockResolvedValue(undefined);
    const strapi = {
      admin: { services: { permission: { actionProvider: { registerMany } } } },
    };

    await registerEcommercePermissions(strapi as any);

    expect(registerMany).toHaveBeenCalledTimes(1);
    const actions = registerMany.mock.calls[0][0];
    expect(actions).toHaveLength(13);
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
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.settings.read',
        displayName: 'Read settings',
      }),
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.settings.manage',
        displayName: 'Manage settings',
      }),
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.orders.read',
        displayName: 'Read orders',
      }),
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.orders.manage',
        displayName: 'Manage orders',
      }),
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.customers.read',
        displayName: 'Read customers',
      }),
      expect.objectContaining({
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'ecommerce',
        uid: 'ecommerce.customers.manage',
        displayName: 'Manage customers',
      }),
      expect.objectContaining({
        uid: 'ecommerce.refunds.manage',
        displayName: 'Manage refunds and store credit',
      }),
      expect.objectContaining({
        uid: 'ecommerce.payments.manage',
        displayName: 'Manage payment links and instructions',
      }),
      expect.objectContaining({
        uid: 'ecommerce.invoicing.manage',
        displayName: 'Issue invoices and credit notes',
      }),
      expect.objectContaining({ uid: 'ecommerce.promotions.read', displayName: 'Read promotions' }),
      expect.objectContaining({ uid: 'ecommerce.promotions.manage', displayName: 'Manage promotions' }),
    ]);
  });
});
