export const TABS_PLUGIN_KEY = 'littlebox-strapi-suite';

const SYSTEM_KEYS = [
  'id',
  'documentId',
  'locale',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'localizations',
];

export interface LtbTab {
  id: string;
  name: string;
}

export interface TabGroup {
  tab: LtbTab;
  key: string;
  fields: string[];
}

export function toTabKey(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function readTabs(pluginOptions: unknown): LtbTab[] {
  const tabs = (pluginOptions as any)?.[TABS_PLUGIN_KEY]?.tabs;
  if (!Array.isArray(tabs)) return [];
  return tabs.filter((tab) => tab && typeof tab.id === 'string' && typeof tab.name === 'string');
}

export function readAttributeTabId(attribute: unknown): string | null {
  const id = (attribute as any)?.pluginOptions?.[TABS_PLUGIN_KEY]?.tab;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function buildTabGroups(
  tabs: LtbTab[],
  attributes: Record<string, unknown>,
  onConflict?: (tab: LtbTab, key: string) => void
): TabGroup[] {
  const candidates = tabs
    .map((tab) => ({
      tab,
      key: toTabKey(tab.name),
      fields: Object.entries(attributes)
        .filter(([, attribute]) => readAttributeTabId(attribute) === tab.id)
        .map(([name]) => name),
    }))
    .filter((group) => group.fields.length > 0);

  // A tab key may not match any attribute: a rejected tab leaves its fields at the root,
  // so comparing only against ungrouped fields could still overwrite a value.
  const reservedKeys = new Set([...SYSTEM_KEYS, ...Object.keys(attributes)]);
  const usedKeys = new Set<string>();

  return candidates.filter((group) => {
    if (group.key === '' || reservedKeys.has(group.key) || usedKeys.has(group.key)) {
      onConflict?.(group.tab, group.key);
      return false;
    }
    usedKeys.add(group.key);
    return true;
  });
}

export function groupEntryByTabs(entry: unknown, groups: TabGroup[]): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || groups.length === 0) {
    return entry;
  }
  const fieldToKey = new Map<string, string>();
  groups.forEach((group) => group.fields.forEach((field) => fieldToKey.set(field, group.key)));

  const result: Record<string, unknown> = {};
  const grouped: Record<string, Record<string, unknown>> = {};
  Object.entries(entry).forEach(([name, value]) => {
    const key = fieldToKey.get(name);
    if (key === undefined) {
      result[name] = value;
    } else {
      (grouped[key] ??= {})[name] = value;
    }
  });
  groups.forEach((group) => {
    if (grouped[group.key]) result[group.key] = grouped[group.key];
  });
  return result;
}

export function groupDataByTabs(data: unknown, groups: TabGroup[]): unknown {
  if (groups.length === 0) return data;
  return Array.isArray(data)
    ? data.map((entry) => groupEntryByTabs(entry, groups))
    : groupEntryByTabs(data, groups);
}

export function parseHandlerUid(handler: unknown): string | null {
  if (typeof handler !== 'string') return null;
  const match = handler.match(/^(.+)\.(find|findOne)$/);
  return match ? match[1] : null;
}
