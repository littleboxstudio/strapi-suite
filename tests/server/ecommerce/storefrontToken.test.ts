import { afterEach, describe, expect, it, vi } from 'vitest';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { UIDS, makeStrapi } from './helpers/settingsStrapi';

/** The generic PUT no longer writes it: seed the row the way the service stores it. */
const storeTokenId = (tables: Record<string, any[]>, id: number) => {
  tables[UIDS.storeSetting].push({ id: 1000 + id, key: 'storefrontApiTokenId', value: { v: id } });
};

const setup = () => makeStrapi();

afterEach(() => {
  vi.useRealTimers();
});

describe('EcommerceSettingsService — storefront token state', () => {
  it('has no token when none is configured', async () => {
    const { service, tables } = setup();
    expect(await service.getStorefrontToken()).toEqual({ token: null, missing: false });
  });

  it('reports a configured token that no longer exists as missing', async () => {
    const { service, tables } = setup();
    storeTokenId(tables, 42);
    expect(await service.getStorefrontToken()).toEqual({ token: null, missing: true });
  });

  it('describes the configured token, never its value', async () => {
    const { service, apiTokens, tables } = setup();
    const seeded = apiTokens.seed({ name: 'Manual BFF', type: 'full-access', lastUsedAt: '2026-11-10T10:00:00.000Z' });
    storeTokenId(tables, seeded.id);
    const state = await service.getStorefrontToken();
    expect(state).toEqual({
      missing: false,
      token: {
        id: seeded.id,
        name: 'Manual BFF',
        description: null,
        type: 'full-access',
        createdAt: seeded.createdAt,
        lastUsedAt: '2026-11-10T10:00:00.000Z',
        expiresAt: null,
      },
    });
    expect(JSON.stringify(state)).not.toContain('access-key');
  });
});

describe('EcommerceSettingsService — generateStorefrontToken', () => {
  it('creates a custom token with no permissions and unlimited lifespan, stores it and returns the key once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T09:08:07.000Z'));
    const { service, apiTokens, tables } = setup();
    const res = await service.generateStorefrontToken('3');

    expect(apiTokens.service.create).toHaveBeenCalledTimes(1);
    const attrs = apiTokens.service.create.mock.calls[0][0];
    expect(attrs).toEqual({
      name: 'Littlebox storefront BFF 2026-11-11 09:08:07',
      description: expect.stringContaining('e-commerce module'),
      type: 'custom',
      permissions: [],
      lifespan: null,
    });
    expect(attrs.description.length).toBeLessThanOrEqual(255);

    const created = [...apiTokens.rows.values()][0];
    expect(created.expiresAt).toBeNull();
    expect(res.accessKey).toBe(created.accessKey);
    expect(res.token).toMatchObject({ id: created.id, name: attrs.name, type: 'custom', expiresAt: null });
    expect(res.missing).toBe(false);
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBe(created.id);

    // The key is returned once: the state never carries it.
    expect(JSON.stringify(await service.getStorefrontToken())).not.toContain(created.accessKey);

    const audit = tables[UIDS.auditLog].at(-1);
    expect(audit).toMatchObject({ area: 'settings', action: 'store.update', userId: '3' });
    expect(audit.details).toEqual({
      changedFields: ['storefrontApiTokenId'],
      storefrontToken: 'generated',
      tokenId: created.id,
    });
    expect(JSON.stringify(tables[UIDS.auditLog])).not.toContain(created.accessKey);
  });

  it('refuses to generate when a token is configured (409 code)', async () => {
    const { service, apiTokens, tables } = setup();
    const seeded = apiTokens.seed({ name: 'Existing' });
    storeTokenId(tables, seeded.id);
    const err = await service.generateStorefrontToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect((err as EcommerceValidationError).errors).toEqual([
      { path: 'storefrontApiTokenId', code: 'STOREFRONT_TOKEN_EXISTS' },
    ]);
    expect(apiTokens.service.create).not.toHaveBeenCalled();
  });

  it('generates when the configured token no longer exists', async () => {
    const { service, apiTokens, tables } = setup();
    storeTokenId(tables, 42);
    const res = await service.generateStorefrontToken();
    expect(res.token).not.toBeNull();
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBe(res.token!.id);
    expect(apiTokens.service.revoke).not.toHaveBeenCalled();
  });

  it('makes the name unique when a token already uses it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T09:08:07.000Z'));
    const { service, apiTokens, tables } = setup();
    apiTokens.seed({ name: 'Littlebox storefront BFF 2026-11-11 09:08:07' });
    apiTokens.seed({ name: 'Littlebox storefront BFF 2026-11-11 09:08:07 (2)' });
    const res = await service.generateStorefrontToken();
    expect(res.token!.name).toBe('Littlebox storefront BFF 2026-11-11 09:08:07 (3)');
  });

  it('retries with another name when create hits a name collision', async () => {
    const { service, apiTokens, tables } = setup();
    const original = apiTokens.service.create.getMockImplementation()!;
    apiTokens.service.create.mockImplementationOnce(async (attrs: any) => {
      // Another process took the name between the check and the insert.
      apiTokens.seed({ name: attrs.name });
      return original(attrs);
    });
    const res = await service.generateStorefrontToken();
    expect(apiTokens.service.create).toHaveBeenCalledTimes(2);
    expect(res.token!.name).toMatch(/\(2\)$/);
  });

  it('propagates a create failure that is not a name collision and stores nothing', async () => {
    const { service, apiTokens, tables } = setup();
    apiTokens.service.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.generateStorefrontToken()).rejects.toThrow('db down');
    expect(apiTokens.service.create).toHaveBeenCalledTimes(1);
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBeNull();
    expect(tables[UIDS.auditLog]).toHaveLength(0);
  });

  it('deletes the new token when saving its id fails', async () => {
    const { service, apiTokens, strapi, tables } = setup();
    strapi.db.transaction = vi.fn().mockRejectedValueOnce(new Error('write failed'));
    await expect(service.generateStorefrontToken()).rejects.toThrow('write failed');
    expect(apiTokens.rows.size).toBe(0);
  });
});

describe('EcommerceSettingsService — regenerateStorefrontToken', () => {
  it('creates the new token first, points the setting to it, then deletes the old one', async () => {
    const { service, apiTokens, tables } = setup();
    const old = apiTokens.seed({ name: 'Old BFF' });
    storeTokenId(tables, old.id);

    const res = await service.regenerateStorefrontToken('3');

    expect(apiTokens.service.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'custom', permissions: [], lifespan: null })
    );
    expect(apiTokens.service.revoke).toHaveBeenCalledWith(old.id);
    expect(apiTokens.service.create.mock.invocationCallOrder[0]).toBeLessThan(
      apiTokens.service.revoke.mock.invocationCallOrder[0]
    );
    expect(apiTokens.rows.has(old.id)).toBe(false);
    const created = [...apiTokens.rows.values()][0];
    expect(created.expiresAt).toBeNull();
    expect(res.accessKey).toBe(created.accessKey);
    expect(res.token!.id).toBe(created.id);
    expect(res.previousTokenDeleted).toBe(true);
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBe(created.id);
    expect(tables[UIDS.auditLog].at(-1).details).toEqual({
      changedFields: ['storefrontApiTokenId'],
      storefrontToken: 'regenerated',
      tokenId: created.id,
      previousTokenId: old.id,
    });
  });

  it('deletes a manually created old token too', async () => {
    const { service, apiTokens, tables } = setup();
    const manual = apiTokens.seed({ name: 'Full access', type: 'full-access' });
    storeTokenId(tables, manual.id);
    await service.regenerateStorefrontToken();
    expect(apiTokens.rows.has(manual.id)).toBe(false);
  });

  it('an old token that no longer exists is not an error', async () => {
    const { service, apiTokens, tables } = setup();
    storeTokenId(tables, 42);
    const res = await service.regenerateStorefrontToken();
    expect(apiTokens.service.revoke).toHaveBeenCalledWith(42);
    expect(res.previousTokenDeleted).toBe(true);
    expect(res.token).not.toBeNull();
  });

  it('works without a configured token (nothing to delete)', async () => {
    const { service, apiTokens, tables } = setup();
    const res = await service.regenerateStorefrontToken();
    expect(apiTokens.service.revoke).not.toHaveBeenCalled();
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBe(res.token!.id);
  });

  it('changes nothing when creating the new token fails', async () => {
    const { service, apiTokens, tables } = setup();
    const old = apiTokens.seed({ name: 'Old BFF' });
    storeTokenId(tables, old.id);
    const auditBefore = tables[UIDS.auditLog].length;
    apiTokens.service.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.regenerateStorefrontToken()).rejects.toThrow('db down');
    expect(apiTokens.service.revoke).not.toHaveBeenCalled();
    expect(apiTokens.rows.has(old.id)).toBe(true);
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBe(old.id);
    expect(tables[UIDS.auditLog]).toHaveLength(auditBefore);
  });

  it('keeps the old token and deletes the new one when saving the id fails', async () => {
    const { service, apiTokens, strapi, tables } = setup();
    const old = apiTokens.seed({ name: 'Old BFF' });
    storeTokenId(tables, old.id);
    strapi.db.transaction = vi.fn().mockRejectedValueOnce(new Error('write failed'));
    await expect(service.regenerateStorefrontToken()).rejects.toThrow('write failed');
    expect([...apiTokens.rows.keys()]).toEqual([old.id]);
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBe(old.id);
  });

  it('still returns the new key when deleting the old token fails', async () => {
    const { service, apiTokens, strapi, tables } = setup();
    const old = apiTokens.seed({ name: 'Old BFF' });
    storeTokenId(tables, old.id);
    apiTokens.service.revoke.mockRejectedValueOnce(new Error('revoke failed'));
    const res = await service.regenerateStorefrontToken();
    expect(res.accessKey).toBeTruthy();
    expect(res.previousTokenDeleted).toBe(false);
    expect((await service.getStoreSettings()).storefrontApiTokenId).toBe(res.token!.id);
    expect(strapi.log.warn).toHaveBeenCalled();
  });
});

describe('EcommerceSettingsService — storefrontApiTokenId is not writable through the store PUT', () => {
  it('ignores it in updateStoreSettings', async () => {
    const { service, apiTokens, tables } = setup();
    const seeded = apiTokens.seed({ name: 'Manual' });
    const res = await service.updateStoreSettings({ storefrontApiTokenId: seeded.id, storeName: 'Shop' } as any);
    expect(res.storefrontApiTokenId).toBeNull();
    expect(res.storeName).toBe('Shop');
    expect(apiTokens.service.getById).not.toHaveBeenCalled();
  });
});
