import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { applySectionVisibility } from './sectionVisibility';
import { tabsStore } from './tabsStore';

type TabSectionProps = {
  ltbTabKey?: string;
};

/** Invisible marker that hides or shows the panels of its tab. */
const TabSection = ({ ltbTabKey = '' }: TabSectionProps) => {
  const ref = useRef<HTMLSpanElement>(null);
  const active = useSyncExternalStore(tabsStore.subscribe, tabsStore.get);

  useLayoutEffect(() => {
    const marker = ref.current;
    if (!marker || active === null) return;
    const visible = active === ltbTabKey;
    const container = applySectionVisibility(marker, visible);
    if (!container) return;
    // Re-apply when the content manager re-renders the list of panels.
    const observer = new MutationObserver(() => applySectionVisibility(marker, visible));
    observer.observe(container, { childList: true });
    return () => observer.disconnect();
  }, [active, ltbTabKey]);

  return <span ref={ref} data-ltb-tab-section={ltbTabKey} hidden />;
};

export default TabSection;
