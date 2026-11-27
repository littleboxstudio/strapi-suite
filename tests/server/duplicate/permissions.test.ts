import { describe, expect, it, vi } from 'vitest';
import {
  DUPLICATE_PERMISSION,
  registerDuplicatePermissions,
} from '../../../server/src/services/modules/duplicate/permissions';

describe('registerDuplicatePermissions', () => {
  it('exposes the full action uid', () => {
    expect(DUPLICATE_PERMISSION).toBe('plugin::littlebox-strapi-suite.duplicate.run');
  });

  it('registers the one "Duplicate content" action', async () => {
    const registerMany = vi.fn().mockResolvedValue(undefined);
    await registerDuplicatePermissions({
      admin: { services: { permission: { actionProvider: { registerMany } } } },
    } as any);
    expect(registerMany).toHaveBeenCalledWith([
      {
        section: 'plugins',
        pluginName: 'littlebox-strapi-suite',
        subCategory: 'duplicate',
        uid: 'duplicate.run',
        displayName: 'Duplicate content',
      },
    ]);
  });
});
