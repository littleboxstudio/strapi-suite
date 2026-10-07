import type { Core } from '@strapi/strapi';
import { readTabs, buildTabGroups, groupDataByTabs } from './tabs';

/**
 * Returns a function that groups the fields of a content type entry (or list of entries)
 * by the tabs configured in its schema. Conflicting tabs are warned about once; any failure
 * is logged and the data is returned unchanged.
 */
export function createContentTypeTabsGrouper(strapi: Core.Strapi) {
  const warned = new Set<string>();

  return function groupByContentTypeTabs<T>(uid: string, data: T): T {
    try {
      const contentType: any = strapi.contentType(uid as any);
      if (!contentType) return data;
      const tabs = readTabs(contentType.pluginOptions);
      if (tabs.length === 0) return data;

      const groups = buildTabGroups(tabs, contentType.attributes ?? {}, (tab, key) => {
        const id = `${uid}:${tab.id}`;
        if (warned.has(id)) return;
        warned.add(id);
        strapi.log.warn(
          `[littlebox-strapi-suite] Tab "${tab.name}" of ${uid} was not grouped: the key "${key}" is empty or conflicts with a field or another tab.`
        );
      });
      return groupDataByTabs(data, groups) as T;
    } catch (error) {
      strapi.log.error(`[littlebox-strapi-suite] Could not group ${uid} data by tabs: ${error}`);
      return data;
    }
  };
}
