import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Button,
  Box,
  TextInput,
  Field,
  Typography,
  Loader,
  EmptyStateLayout,
} from '@strapi/design-system';
import { EmptyDocuments } from '@strapi/icons/symbols';
import { Plus } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../../core/utils/getTranslation';
import { Output as OutputFetchMenu, OutputChildren } from '../../core/usecases/fetchMenu';
import FetchMenus, { Output as OutputFetchMenus } from '../../core/usecases/fetchMenus';
import { isEmpty, isNotEmpty } from '../../core/utils/isEmpty';
import { convertToSlug } from '../../core/utils/convertToSlug';
import { arrayToTree } from '../../core/utils/arrayToTree';
import config from '../../core/config';
import { Item, RequestEditInput } from './types';
import MenuList from './MenuList';
import MenuEditItem from './MenuEditItem';

const BoxInput = styled(Box)`
  & > div {
    width: 100%;
  }
`;

function MenuDragDrop(props: {
  data: OutputFetchMenu;
  onSaveEvent: (data: RequestEditInput | null) => void;
}) {
  const [module, setModule] = useState(config.uuid.modules.menu);
  const [selectedItem, setSelectedItem] = useState<Item>();
  const [items, setItems] = useState<Item[]>([]);
  const { formatMessage } = useIntl();
  const [formTitle, setFormTitle] = useState(props.data.title);
  const [formUid, setFormUid] = useState(props.data.uid);
  const [uidExist, setUidExist] = useState(false);
  const [records, setRecords] = useState<OutputFetchMenus[]>([]);
  const [fetchInProgress, setFetchInProgress] = useState(true);
  const [itemsAreValid, setItemsAreValid] = useState(true);
  const numberOfInteractions = useRef(0);

  async function fetchRecords() {
    const fetchMenus = new FetchMenus();
    const OutputFetchMenus = await fetchMenus.execute({
      locale: props.data.locale,
    });
    const menusExceptCurrent = OutputFetchMenus.filter(
      (item) => item.documentId !== props.data.documentId
    );
    setRecords(menusExceptCurrent);
    setFetchInProgress(false);
  }

  function checkUidExist(uid: string): boolean {
    const uidExist = records.find((record: OutputFetchMenus) => record.uid === uid);
    setUidExist(!!uidExist);
    return !!uidExist;
  }

  async function handlerForm() {
    const uidExist = checkUidExist(formUid);
    if (!uidExist && isNotEmpty(formTitle) && isNotEmpty(formUid) && itemsAreValid) {
      setUidExist(false);
      props.onSaveEvent({
        uid: formUid,
        title: formTitle,
        children: items,
      });
    } else {
      props.onSaveEvent(null);
    }
  }

  function findItemById(items: Item[], id: number): Item | null {
    for (const item of items) {
      if (item.id === id) {
        return item;
      }
      if (item.children && item.children.length > 0) {
        const result: Item | null = findItemById(item.children, id);
        if (result) {
          return result;
        }
      }
    }
    return null;
  }

  function createNewItem(order: number): Item {
    const data: Item = {
      id: Date.now(),
      url: '',
      title: 'New Item',
      order,
      target: '_blank',
      metadata: {},
      selected: true,
      children: [],
    };
    return data;
  }

  function addRootItem() {
    const newItems = [...items];
    unselectItems(newItems);
    const newItem = createNewItem(items.length + 1);
    newItems.push(newItem);
    setSelectedItem(newItem);
    setItems(newItems);
  }

  function addSubItem(items: Item[], parentId: number) {
    unselectItems(items);
    const item = findItemById(items, parentId) as Item;
    const newItem = createNewItem(item.children.length + 1);
    item.children.push(newItem);
    setSelectedItem(newItem);
    setItems(items);
  }

  function removeItemById(items: Item[], id: number) {
    return items
      .map((item) => {
        if (item.children && item.children.length > 0) {
          item.children = removeItemById(item.children, id);
        }
        return item;
      })
      .filter((item) => item.id !== id);
  }

  function unselectItems(items: Item[]) {
    for (const item of items) {
      item.selected = false;
      if (item.children && item.children.length > 0) {
        unselectItems(item.children);
      }
    }
  }

  function updateItem(updatedItem: Item) {
    const copyItems = [...items];
    const item = findItemById(copyItems, updatedItem.id) as Item;
    item.title = updatedItem.title;
    item.url = updatedItem.url;
    item.contentId = updatedItem.contentId;
    item.contentModel = updatedItem.contentModel;
    item.target = updatedItem.target;
    item.metadata = updatedItem.metadata;
    setItems(copyItems);
  }

  function handleAddItem(id: number) {
    const newItems = [...items];
    addSubItem(newItems, id);
    setItems(newItems);
  }

  function handleRemoveItem(id: number) {
    const newItems = removeItemById([...items], id);
    if (selectedItem && selectedItem.id === id && newItems.length > 0) {
      newItems[0].selected = true;
      setSelectedItem(newItems[0]);
    }
    if (selectedItem && selectedItem.id === id && newItems.length === 0) {
      setSelectedItem(undefined);
    }
    setItems(newItems);
  }

  function handleUpdateItem(id: number) {
    unselectItems(items);
    const item = findItemById(items, id) as Item;
    item.selected = true;
    setSelectedItem(item);
  }

  function handleSorting(sortedItems: Item[], parentId?: number) {
    if (!parentId) {
      setItems(sortedItems);
      return;
    }
    const copyItems = [...items];
    if (parentId) {
      const item = findItemById(copyItems, parentId) as Item;
      item.children = sortedItems;
    }
    setItems(copyItems);
  }

  function buildHierarchy(items: OutputChildren[]) {
    const mappedItems: Item[] = arrayToTree(items);
    if (mappedItems.length > 0) {
      mappedItems[0].selected = true;
      setSelectedItem(mappedItems[0]);
    }
    setItems(mappedItems);
  }

  useEffect(() => {
    if (numberOfInteractions.current < 2) {
      numberOfInteractions.current += 1;
      return;
    }
    handlerForm();
  }, [formTitle, formUid, items]);

  useEffect(() => {
    fetchRecords();
    buildHierarchy(props.data.children);
  }, []);

  return (
    <>
      {fetchInProgress && (
        <Box style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
          <Loader small />
        </Box>
      )}
      {!fetchInProgress && (
        <Box style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
          <Card
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '20px',
              padding: '20px',
            }}
          >
            <Box
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                alignSelf: 'start',
                height: 'auto',
              }}
            >
              <span style={{ paddingBottom: '5px' }}>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.edit.input.title`),
                    defaultMessage: 'Title',
                  })}
                </Typography>
              </span>
              <BoxInput style={{ flex: 1, display: 'flex', width: '100%', marginRight: '10px' }}>
                <TextInput
                  style={{ width: '100%' }}
                  aria-label={''}
                  value={formTitle}
                  hasError={isEmpty(formTitle)}
                  onChange={(e: any) => setFormTitle(e.target.value)}
                />
                <Field.Hint />
                <Field.Error />
              </BoxInput>
            </Box>
            <Box
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                alignSelf: 'start',
                height: 'auto',
              }}
            >
              <span style={{ paddingBottom: '5px' }}>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.edit.input.uid`),
                    defaultMessage: 'UID',
                  })}
                </Typography>
              </span>
              <BoxInput
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  width: '100%',
                  marginRight: '10px',
                }}
              >
                <TextInput
                  style={{ width: '100%' }}
                  aria-label={formatMessage({
                    id: getTranslation(`module.${module}.edit.input.uid`),
                    defaultMessage: 'UID',
                  })}
                  value={formUid}
                  hasError={isEmpty(formUid) || uidExist}
                  onChange={(e: any) => {
                    const convertedText = convertToSlug(e.target.value);
                    setFormUid(convertedText);
                    checkUidExist(e.target.value);
                  }}
                />
                <Field.Hint />
                <Field.Error />
                {uidExist && (
                  <Typography variant="pi" style={{ color: '#ee5e52', paddingTop: '5px' }}>
                    {formatMessage({
                      id: getTranslation(`module.${module}.edit.input.uid.error.duplicated`),
                      defaultMessage: 'The UID already exists for the selected locale',
                    })}
                  </Typography>
                )}
              </BoxInput>
              <span style={{ paddingTop: '5px', color: '#a5a5ba', display: 'flex' }}>
                <Typography variant="pi">
                  {formatMessage({
                    id: getTranslation(`module.${module}.edit.input.uid.description`),
                    defaultMessage:
                      'Unique identifier for the menu. Repeat the UID only if you are entering translations for an existing menu',
                  })}
                </Typography>
              </span>
            </Box>
          </Card>
          {items.length === 0 && (
            <Box
              style={{
                width: '100%',
                paddingTop: '40px',
              }}
            >
              <EmptyStateLayout
                shadow={false}
                action={
                  <Button size="S" variant="secondary" startIcon={<Plus />} onClick={addRootItem}>
                    {formatMessage({
                      id: getTranslation(`module.${module}.edit.add-new-button`),
                      defaultMessage: 'Add new item',
                    })}
                  </Button>
                }
                content={
                  <>
                    <EmptyDocuments width="160px" height="88px" />
                    <br />
                    <br />
                    {formatMessage({ id: getTranslation('app.empty') })}
                  </>
                }
              />
            </Box>
          )}
          {items.length > 0 && (
            <Box
              style={{
                width: '100%',
                paddingTop: '40px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '20px',
              }}
            >
              <Box style={{ flex: '1' }}>
                <MenuList
                  items={items}
                  level={0}
                  onAddEvent={(id: number) => handleAddItem(id)}
                  onRemoveEvent={(id: number) => handleRemoveItem(id)}
                  onUpdateEvent={(id: number) => handleUpdateItem(id)}
                  onSortingEvent={(sortedItems: Item[], parentId?: number) =>
                    handleSorting(sortedItems, parentId)
                  }
                />
                <Button
                  size="L"
                  variant="tertiary"
                  style={{ width: '100%' }}
                  startIcon={<Plus />}
                  onClick={addRootItem}
                >
                  {formatMessage({
                    id: getTranslation(`module.${module}.edit.add-new-button`),
                    defaultMessage: 'Add new item',
                  })}
                </Button>
              </Box>
              {selectedItem && (
                <Box style={{ display: 'flex', flexDirection: 'column' }}>
                  <Card style={{ width: '100%', position: 'sticky', top: '20px' }}>
                    <MenuEditItem
                      data={selectedItem}
                      locale={props.data.locale}
                      onChangeEvent={(data: Item) => {
                        setSelectedItem(data);
                        updateItem(data);
                      }}
                      onCheckEvent={(isValid: boolean) => setItemsAreValid(isValid)}
                    />
                  </Card>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </>
  );
}

export default MenuDragDrop;
