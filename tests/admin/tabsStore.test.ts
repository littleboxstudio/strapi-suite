import { describe, it, expect, vi } from 'vitest';
import { createTabsStore } from '../../admin/src/editView/tabsStore';

describe('createTabsStore', () => {
  it('guarda a tab ativa e avisa os inscritos só quando muda', () => {
    const store = createTabsStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get()).toBeNull();
    store.set('contato');
    store.set('contato');
    expect(store.get()).toBe('contato');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set('loja');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
