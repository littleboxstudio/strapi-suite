import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Badge, Box, Flex, Tabs } from '@strapi/design-system';
import { unstable_useContentManagerContext as useContentManagerContext } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { getTranslation } from '../core/utils/getTranslation';
import { countErrorsByTab, pickInitialTab, readTabFromHash, tabHash } from '../core/utils/tabs';
import { tabsStore } from './tabsStore';

type TabsBarProps = {
  ltbTabs?: { id: string; name: string; key: string }[];
  ltbFieldTabKeys?: Record<string, string>;
};

// The active tab lives in the URL hash: the content manager ignores it, while a query change
// would trigger its unsaved-changes guard and refetch the document.
function selectTab(key: string) {
  tabsStore.set(key);
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}${tabHash(key)}`);
}

const TabsBar = ({ ltbTabs = [], ltbFieldTabKeys = {} }: TabsBarProps) => {
  const { formatMessage } = useIntl();
  const { form }: any = useContentManagerContext();
  const errors = form?.errors;
  const active = useSyncExternalStore(tabsStore.subscribe, tabsStore.get);
  const keys = useMemo(() => ltbTabs.map((tab) => tab.key), [ltbTabs]);
  const errorCounts = useMemo(
    () => countErrorsByTab(errors, ltbFieldTabKeys),
    [errors, ltbFieldTabKeys]
  );

  // Runs before paint, so the sections never flash with every tab visible.
  useLayoutEffect(() => {
    const initial = pickInitialTab(keys, readTabFromHash(window.location.hash), tabsStore.get());
    if (initial) tabsStore.set(initial);
  }, [keys.join('|')]);

  // After a failed submit, jump to the first tab with errors if the active one has none.
  const previousErrors = useRef(errors);
  useEffect(() => {
    if (previousErrors.current === errors) return;
    previousErrors.current = errors;
    if (active && (errorCounts[active] ?? 0) > 0) return;
    const tabWithErrors = ltbTabs.find((tab) => (errorCounts[tab.key] ?? 0) > 0);
    if (tabWithErrors) selectTab(tabWithErrors.key);
  }, [errors]);

  return (
    <Box data-ltb-tabs-bar="">
      <Tabs.Root variant="simple" value={active ?? keys[0]} onValueChange={selectTab}>
        <Tabs.List
          aria-label={formatMessage({
            id: getTranslation('tabs.edit-view.label'),
            defaultMessage: 'Content tabs',
          })}
        >
          {ltbTabs.map((tab) => {
            const count = errorCounts[tab.key] ?? 0;
            return (
              <Tabs.Trigger key={tab.id} value={tab.key}>
                <Flex gap={2} alignItems="center">
                  {tab.name}
                  {count > 0 && (
                    <Badge
                      backgroundColor="danger100"
                      textColor="danger600"
                      title={formatMessage(
                        {
                          id: getTranslation('tabs.edit-view.errors'),
                          defaultMessage: '{count, plural, one {# error} other {# errors}}',
                        },
                        { count }
                      )}
                    >
                      {count}
                    </Badge>
                  )}
                </Flex>
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>
      </Tabs.Root>
    </Box>
  );
};

export default TabsBar;
