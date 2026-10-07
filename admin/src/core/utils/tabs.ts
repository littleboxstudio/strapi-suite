export const TABS_PLUGIN_KEY = 'littlebox-strapi-suite';
export const TABS_HASH_PARAM = 'ltbTab';
export const TABS_BAR_FIELD_TYPE = 'ltb-tabs-bar';
export const TABS_SECTION_FIELD_TYPE = 'ltb-tab-section';

export interface LtbTab {
  id: string;
  name: string;
}

export type LayoutField = { name: string; attribute?: unknown; [key: string]: unknown };
export type LayoutPanel = LayoutField[][];
export type TabsValidationError = 'name.required' | 'key.empty' | 'key.duplicated';

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

export function generateTabId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function readTabs(pluginOptions: unknown): LtbTab[] {
  const tabs = (pluginOptions as any)?.[TABS_PLUGIN_KEY]?.tabs;
  if (!Array.isArray(tabs)) return [];
  return tabs.filter((tab) => tab && typeof tab.id === 'string' && typeof tab.name === 'string');
}

/**
 * Tabs value to store in the form. The content type builder applies the modal values to its state
 * with lodash `merge`, which merges arrays by index, so a shorter array would keep the removed
 * tabs. Padding with `null` up to the previous length overwrites them; `readTabs` ignores nulls
 * and `cleanContentTypeSchema` drops them on save.
 */
export function padTabs(next: LtbTab[], previous: unknown): (LtbTab | null)[] {
  const previousLength = Array.isArray(previous) ? previous.length : 0;
  const padding = Math.max(previousLength - next.length, 0);
  return [...next, ...Array<null>(padding).fill(null)];
}

export function readAttributeTabId(attribute: unknown): string | null {
  const id = (attribute as any)?.pluginOptions?.[TABS_PLUGIN_KEY]?.tab;
  return typeof id === 'string' && id !== '' ? id : null;
}

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

function attributeNames(attributes: unknown): string[] {
  if (Array.isArray(attributes)) {
    return attributes
      .map((attribute) => attribute?.name)
      .filter((name) => typeof name === 'string');
  }
  return attributes && typeof attributes === 'object' ? Object.keys(attributes) : [];
}

/** Tabs whose API key matches a field or system key; the server does not group them. */
export function getConflictingTabIds(tabs: LtbTab[], attributes: unknown): Set<string> {
  const reserved = new Set([...SYSTEM_KEYS, ...attributeNames(attributes)]);
  return new Set(tabs.filter((tab) => reserved.has(toTabKey(tab.name))).map((tab) => tab.id));
}

export function validateTabs(tabs: LtbTab[]): TabsValidationError | null {
  const keys = new Set<string>();
  for (const tab of tabs) {
    if (!tab.name || tab.name.trim() === '') return 'name.required';
    const key = toTabKey(tab.name);
    if (key === '') return 'key.empty';
    if (keys.has(key)) return 'key.duplicated';
    keys.add(key);
  }
  return null;
}

function omitPluginKey(pluginOptions: Record<string, unknown>) {
  const { [TABS_PLUGIN_KEY]: _removed, ...rest } = pluginOptions;
  return rest;
}

function cleanAttribute(attribute: any, validIds: Set<string>) {
  if (!attribute?.pluginOptions || !(TABS_PLUGIN_KEY in attribute.pluginOptions)) return attribute;
  const id = readAttributeTabId(attribute);
  if (id && validIds.has(id)) return attribute;
  return { ...attribute, pluginOptions: omitPluginKey(attribute.pluginOptions) };
}

export function cleanContentTypeSchema<T>(schema: T): T {
  const current = schema as any;
  if (!current || typeof current !== 'object') return schema;

  const tabs = readTabs(current.pluginOptions);
  const validIds = new Set(tabs.map((tab) => tab.id));
  let changed = false;
  const next: any = { ...current };

  if (current.pluginOptions && TABS_PLUGIN_KEY in current.pluginOptions) {
    const storedTabs = current.pluginOptions[TABS_PLUGIN_KEY]?.tabs;
    if (tabs.length === 0) {
      next.pluginOptions = omitPluginKey(current.pluginOptions);
      changed = true;
    } else if (!Array.isArray(storedTabs) || storedTabs.length !== tabs.length) {
      next.pluginOptions = {
        ...current.pluginOptions,
        [TABS_PLUGIN_KEY]: { ...current.pluginOptions[TABS_PLUGIN_KEY], tabs },
      };
      changed = true;
    }
  }

  const clean = (attribute: any) => {
    const cleaned = cleanAttribute(attribute, validIds);
    if (cleaned !== attribute) changed = true;
    return cleaned;
  };
  if (Array.isArray(current.attributes)) {
    next.attributes = current.attributes.map(clean);
  } else if (current.attributes && typeof current.attributes === 'object') {
    next.attributes = Object.fromEntries(
      Object.entries(current.attributes).map(([name, attribute]) => [name, clean(attribute)])
    );
  }

  return changed ? next : schema;
}

export function resolveActiveTab(tabs: LtbTab[], requested: unknown): LtbTab | null {
  if (tabs.length === 0) return null;
  if (typeof requested === 'string') {
    const found = tabs.find((tab) => toTabKey(tab.name) === requested);
    if (found) return found;
  }
  return tabs[0];
}

function fieldTabId(field: LayoutField, validIds: Set<string>): string | null {
  const id = readAttributeTabId(field.attribute);
  return id && validIds.has(id) ? id : null;
}

function pickFields(
  panels: LayoutPanel[],
  predicate: (field: LayoutField) => boolean
): LayoutPanel[] {
  return panels
    .map((panel) => panel.map((row) => row.filter(predicate)).filter((row) => row.length > 0))
    .filter((panel) => panel.length > 0);
}

export function groupLayoutByTabs(panels: LayoutPanel[], tabs: LtbTab[]) {
  const validIds = new Set(tabs.map((tab) => tab.id));
  return {
    rootPanels: pickFields(panels, (field) => fieldTabId(field, validIds) === null),
    sections: tabs.map((tab) => ({
      tab,
      panels: pickFields(panels, (field) => fieldTabId(field, validIds) === tab.id),
    })),
  };
}

type ComponentLayouts = Record<string, { layout?: LayoutField[][] } | undefined>;

function componentLeafPath(
  field: LayoutField,
  components: ComponentLayouts,
  depth = 0
): string | null {
  const attribute = field.attribute as any;
  if (attribute?.type !== 'component') return field.name;
  if (depth > 10) return null;
  const inner = components[attribute.component]?.layout?.flat() ?? [];
  for (const child of inner) {
    const path = componentLeafPath(child, components, depth + 1);
    if (path) return `${field.name}.${path}`;
  }
  return null;
}

/**
 * Name borrowed by the tabs bar and section fields. The content manager checks field
 * permissions by name, and permissions only list component leaves (e.g. `seo.metaTitle`).
 */
export function findAnchorName(
  panels: LayoutPanel[],
  components: ComponentLayouts = {}
): string | null {
  const fields = panels.flat(2);
  const plain = fields.find((field) => (field.attribute as any)?.type !== 'component');
  if (plain) return plain.name;
  for (const field of fields) {
    const path = componentLeafPath(field, components);
    if (path) return path;
  }
  return null;
}

export function readTabFromHash(hash: string): string | null {
  const value = new URLSearchParams((hash ?? '').replace(/^#/, '')).get(TABS_HASH_PARAM);
  return value ? value : null;
}

export function pickInitialTab(
  keys: string[],
  hashKey: string | null,
  currentKey: string | null
): string | null {
  if (hashKey && keys.includes(hashKey)) return hashKey;
  if (currentKey && keys.includes(currentKey)) return currentKey;
  return keys[0] ?? null;
}

export function tabHash(key: string): string {
  return `#${TABS_HASH_PARAM}=${encodeURIComponent(key)}`;
}

export function mapFieldsToTabKeys(panels: LayoutPanel[], tabs: LtbTab[]): Record<string, string> {
  const keysById = new Map(tabs.map((tab) => [tab.id, toTabKey(tab.name)]));
  const result: Record<string, string> = {};
  panels.flat(2).forEach((field) => {
    const id = readAttributeTabId(field.attribute);
    const key = id ? keysById.get(id) : undefined;
    if (key !== undefined) result[field.name] = key;
  });
  return result;
}

export function countErrorsByTab(
  errors: unknown,
  fieldTabKeys: Record<string, string>
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!errors || typeof errors !== 'object') return counts;
  Object.entries(errors).forEach(([name, error]) => {
    const key = fieldTabKeys[name];
    if (key !== undefined && error) counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

const EDIT_VIEW_PATH =
  /\/content-manager\/(collection-types\/[^/]+\/[^/]+|single-types\/[^/]+)\/?$/;
const NON_EDIT_SEGMENTS = new Set(['history', 'preview', 'configurations']);

export function isEditViewPath(pathname: string): boolean {
  if (!EDIT_VIEW_PATH.test(pathname)) return false;
  const lastSegment = pathname.replace(/\/$/, '').split('/').pop() ?? '';
  return !NON_EDIT_SEGMENTS.has(lastSegment);
}
