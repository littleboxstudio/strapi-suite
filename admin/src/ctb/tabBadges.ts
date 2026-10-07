import { readAttributeTabId, readTabs } from '../core/utils/tabs';

const BADGE_ATTRIBUTE = 'data-ltb-tab-badge';
const ROW_SELECTOR = 'li[aria-label]';
const CTB_STATE_KEY = 'content-type-builder_dataManagerProvider';
const CTB_CONTENT_TYPE_PATH = /\/plugins\/content-type-builder\/content-types\/([^/]+)\/?$/;

export function ctbContentTypeUid(pathname: string): string | null {
  const match = pathname.match(CTB_CONTENT_TYPE_PATH);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Maps each field that belongs to an existing tab to the tab name. */
export function buildFieldTabNames(contentType: any): Record<string, string> {
  const tabs = readTabs(contentType?.pluginOptions);
  if (tabs.length === 0) return {};
  const namesById = new Map(tabs.map((tab) => [tab.id, tab.name]));
  const attributes: [string, unknown][] = Array.isArray(contentType?.attributes)
    ? contentType.attributes.map((attribute: any) => [attribute?.name, attribute])
    : Object.entries(contentType?.attributes ?? {});

  const result: Record<string, string> = {};
  attributes.forEach(([name, attribute]) => {
    const id = readAttributeTabId(attribute);
    const tabName = id ? namesById.get(id) : undefined;
    if (typeof name === 'string' && tabName !== undefined) result[name] = tabName;
  });
  return result;
}

function findNameElement(row: Element, name: string): HTMLElement | null {
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent === name) return node.parentElement;
  }
  return null;
}

function createBadge(doc: Document): HTMLElement {
  const badge = doc.createElement('span');
  badge.setAttribute(BADGE_ATTRIBUTE, '');
  Object.assign(badge.style, {
    flexShrink: '0',
    marginLeft: '8px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '1.1rem',
    fontWeight: '600',
    lineHeight: '1.6rem',
    whiteSpace: 'nowrap',
    color: '#7b79ff',
    backgroundColor: 'rgba(123, 121, 255, 0.16)',
  });
  return badge;
}

/**
 * Adds, updates or removes the tab badge after the name of each top-level field row of the
 * content type builder list. Rows of component sub-fields are left untouched.
 */
export function syncTabBadges(root: ParentNode, fieldTabNames: Record<string, string>) {
  root.querySelectorAll(ROW_SELECTOR).forEach((row) => {
    if (row.parentElement?.closest(ROW_SELECTOR)) return;
    const name = row.getAttribute('aria-label') ?? '';
    const nameElement = findNameElement(row, name);
    if (!nameElement) return;

    const existing = nameElement.nextElementSibling?.hasAttribute(BADGE_ATTRIBUTE)
      ? (nameElement.nextElementSibling as HTMLElement)
      : null;
    const tabName = fieldTabNames[name];
    if (!tabName) {
      existing?.remove();
      return;
    }
    const badge = existing ?? createBadge(row.ownerDocument);
    if (badge.textContent !== tabName) badge.textContent = tabName;
    if (!existing) nameElement.after(badge);
  });
}

/**
 * Shows the tab of each field in the content type builder list. The builder has no extension
 * point there, so this watches the DOM and reads the builder state (including unsaved changes)
 * from the admin redux store. If the markup changes in a future Strapi version, no badge shows.
 */
export function startTabBadges(app: any) {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  let scheduled = false;
  let storeUnsubscribe: (() => void) | null = null;

  const update = () => {
    scheduled = false;
    const uid = ctbContentTypeUid(window.location.pathname);
    if (!uid) return;
    const store = app?.store;
    if (store && !storeUnsubscribe) storeUnsubscribe = store.subscribe(schedule);
    const contentType = store?.getState?.()[CTB_STATE_KEY]?.current?.contentTypes?.[uid];
    syncTabBadges(document, buildFieldTabNames(contentType));
  };

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  const observer = new MutationObserver((mutations) => {
    // Ignore the mutations made by the badges themselves.
    const onlyBadges = mutations.every((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].every(
        (node) => node instanceof Element && node.hasAttribute(BADGE_ATTRIBUTE)
      )
    );
    if (!onlyBadges) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
