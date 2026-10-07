import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Box,
  Button,
  Divider,
  Field,
  Flex,
  IconButton,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Drag, Plus, Trash } from '@strapi/icons';
import { useIntl } from 'react-intl';
import { getTranslation } from '../core/utils/getTranslation';
import { LtbTab, generateTabId, padTabs, readTabs, TABS_PLUGIN_KEY } from '../core/utils/tabs';

type IntlMessage = { id: string; defaultMessage: string; values?: Record<string, string | number> };

type TabsEditorProps = {
  name: string;
  value?: unknown;
  error?: string;
  intlLabel: IntlMessage;
  description?: IntlMessage;
  onChange: (event: { target: { name: string; value: (LtbTab | null)[] } }) => void;
};

const TabRow = ({
  tab,
  onRename,
  onRemove,
}: {
  tab: LtbTab;
  onRename: (name: string) => void;
  onRemove: () => void;
}) => {
  const { formatMessage } = useIntl();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tab.id });
  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      paddingBottom={2}
    >
      <Flex gap={2} alignItems="center">
        <IconButton
          {...attributes}
          {...listeners}
          type="button"
          variant="ghost"
          label={formatMessage({
            id: getTranslation('tabs.ctb.reorder'),
            defaultMessage: 'Drag to reorder',
          })}
          style={{ cursor: 'grab' }}
        >
          <Drag />
        </IconButton>
        <Box style={{ flex: 1 }}>
          <TextInput
            aria-label={formatMessage({
              id: getTranslation('tabs.ctb.name.placeholder'),
              defaultMessage: 'Tab name',
            })}
            placeholder={formatMessage({
              id: getTranslation('tabs.ctb.name.placeholder'),
              defaultMessage: 'Tab name',
            })}
            value={tab.name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onRename(event.target.value)}
          />
        </Box>
        <IconButton
          type="button"
          variant="ghost"
          label={formatMessage({
            id: getTranslation('tabs.ctb.remove'),
            defaultMessage: 'Remove tab',
          })}
          onClick={onRemove}
        >
          <Trash />
        </IconButton>
      </Flex>
    </Box>
  );
};

const TabsEditor = ({ name, value, error, intlLabel, description, onChange }: TabsEditorProps) => {
  const { formatMessage } = useIntl();
  const tabs = readTabs({ [TABS_PLUGIN_KEY]: { tabs: value } });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const change = (next: LtbTab[]) => onChange({ target: { name, value: padTabs(next, value) } });

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex((tab) => tab.id === active.id);
    const newIndex = tabs.findIndex((tab) => tab.id === over.id);
    change(arrayMove(tabs, oldIndex, newIndex));
  };

  return (
    <Box>
      <Box paddingTop={2} paddingBottom={4}>
        <Divider />
      </Box>
      <Field.Root name={name} id={name} error={error}>
        <Field.Label style={{ fontSize: '1.4rem' }}>
          {formatMessage(intlLabel, intlLabel.values)}
        </Field.Label>
        {description && (
          <Box paddingBottom={2}>
            <Typography variant="pi" textColor="neutral600">
              {formatMessage(description, description.values)}
            </Typography>
          </Box>
        )}
        {tabs.length === 0 && (
          <Box paddingBottom={2}>
            <Typography variant="omega" textColor="neutral500">
              {formatMessage({
                id: getTranslation('tabs.ctb.empty'),
                defaultMessage: 'No tabs yet.',
              })}
            </Typography>
          </Box>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabs.map((tab) => tab.id)} strategy={verticalListSortingStrategy}>
            {tabs.map((tab) => (
              <TabRow
                key={tab.id}
                tab={tab}
                onRename={(tabName) =>
                  change(
                    tabs.map((current) =>
                      current.id === tab.id ? { ...current, name: tabName } : current
                    )
                  )
                }
                onRemove={() => change(tabs.filter((current) => current.id !== tab.id))}
              />
            ))}
          </SortableContext>
        </DndContext>
        <Box>
          <Button
            type="button"
            variant="secondary"
            startIcon={<Plus />}
            onClick={() => change([...tabs, { id: generateTabId(), name: '' }])}
          >
            {formatMessage({ id: getTranslation('tabs.ctb.add'), defaultMessage: 'Add tab' })}
          </Button>
        </Box>
        <Field.Error />
      </Field.Root>
    </Box>
  );
};

export default TabsEditor;
