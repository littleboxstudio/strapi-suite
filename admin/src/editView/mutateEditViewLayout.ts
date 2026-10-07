import {
  TABS_BAR_FIELD_TYPE,
  TABS_SECTION_FIELD_TYPE,
  LayoutPanel,
  readTabs,
  groupLayoutByTabs,
  mapFieldsToTabKeys,
  findAnchorName,
  isEditViewPath,
  toTabKey,
} from '../core/utils/tabs';

type HookArgs = { layout: any; [key: string]: unknown };

function pseudoField(name: string, type: string, extra: Record<string, unknown>) {
  return {
    name,
    label: '',
    type,
    size: 12,
    visible: true,
    disabled: false,
    required: false,
    unique: false,
    hint: '',
    placeholder: '',
    attribute: { type },
    ...extra,
  };
}

/**
 * Keeps every field in the layout and arranges it as: fields without a tab, the tabs bar,
 * then one section per tab (a marker panel followed by the tab panels). Switching tabs only
 * hides and shows sections at render time: the content manager recomputes this hook only when
 * the URL query changes, and a query change triggers its unsaved-changes guard and a refetch.
 */
export function mutateEditViewLayout<T extends HookArgs>(
  args: T,
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : ''
): T {
  const tabs = readTabs(args.layout?.options);
  const panels: LayoutPanel[] = args.layout?.layout ?? [];
  if (tabs.length === 0 || !isEditViewPath(pathname)) return args;

  const { rootPanels, sections } = groupLayoutByTabs(panels, tabs);
  // Pseudo fields borrow a real field name so the content manager RBAC check lets them render.
  const anchor =
    findAnchorName(rootPanels, args.layout?.components) ??
    findAnchorName(panels, args.layout?.components);
  if (!anchor) return args;

  const bar = pseudoField(anchor, TABS_BAR_FIELD_TYPE, {
    ltbTabs: tabs.map((tab) => ({ ...tab, key: toTabKey(tab.name) })),
    ltbFieldTabKeys: mapFieldsToTabKeys(panels, tabs),
  });

  return {
    ...args,
    layout: {
      ...args.layout,
      layout: [
        ...rootPanels,
        [[bar]],
        ...sections.flatMap(({ tab, panels: tabPanels }) => [
          [[pseudoField(anchor, TABS_SECTION_FIELD_TYPE, { ltbTabKey: toTabKey(tab.name) })]],
          ...tabPanels,
        ]),
      ],
    },
  };
}
