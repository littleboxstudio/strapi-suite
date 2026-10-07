type Listener = () => void;

export function createTabsStore() {
  let active: string | null = null;
  const listeners = new Set<Listener>();
  return {
    get: () => active,
    set(key: string) {
      if (key === active) return;
      active = key;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Active tab shared by the tabs bar and the tab sections of the open edit view. */
export const tabsStore = createTabsStore();
