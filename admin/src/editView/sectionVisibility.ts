const BAR_SELECTOR = '[data-ltb-tabs-bar]';
const SECTION_SELECTOR = '[data-ltb-tab-section]';

/**
 * Shows or hides the panels of a tab section. The content manager renders every panel of
 * the edit layout as a direct child of one column; the section marker sits in its own panel,
 * followed by the panels of its tab until the next marker. Returns that column, or null when
 * the structure is not found, in which case nothing is hidden.
 */
export function applySectionVisibility(marker: HTMLElement, visible: boolean): HTMLElement | null {
  let panel: HTMLElement | null = marker;
  while (panel?.parentElement && !panel.parentElement.querySelector(BAR_SELECTOR)) {
    panel = panel.parentElement;
  }
  if (!panel?.parentElement) return null;

  panel.style.display = 'none';
  let sibling = panel.nextElementSibling as HTMLElement | null;
  while (
    sibling &&
    !sibling.querySelector(SECTION_SELECTOR) &&
    !sibling.querySelector(BAR_SELECTOR)
  ) {
    sibling.style.display = visible ? '' : 'none';
    sibling = sibling.nextElementSibling as HTMLElement | null;
  }
  return panel.parentElement;
}
