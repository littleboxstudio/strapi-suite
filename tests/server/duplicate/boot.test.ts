import { describe, expect, it, vi } from 'vitest';
import { bootDuplicate } from '../../../server/src/services/modules/duplicate/boot';

const makeStrapi = (interruptAll: any) => {
  const registerMany = vi.fn().mockResolvedValue(undefined);
  const strapi: any = {
    admin: { services: { permission: { actionProvider: { registerMany } } } },
    plugin: vi.fn(() => ({ service: vi.fn(() => ({ interruptAll })) })),
    log: { warn: vi.fn() },
  };
  return { strapi, registerMany };
};

describe('bootDuplicate', () => {
  it('registers the permission and marks stuck runs INTERRUPTED', async () => {
    const interruptAll = vi.fn().mockResolvedValue(2);
    const { strapi, registerMany } = makeStrapi(interruptAll);
    await bootDuplicate(strapi);
    expect(registerMany).toHaveBeenCalledTimes(1);
    expect(interruptAll).toHaveBeenCalledTimes(1);
    expect(strapi.plugin).toHaveBeenCalledWith('littlebox-strapi-suite');
  });

  it('a failing sweep never blocks the boot', async () => {
    const { strapi } = makeStrapi(vi.fn().mockRejectedValue(new TypeError('db down')));
    await expect(bootDuplicate(strapi)).resolves.toBeUndefined();
    expect(strapi.log.warn).toHaveBeenCalledWith('[duplicate] interrupted runs sweep failed: TypeError');
  });
});
