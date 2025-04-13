import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, Box, Typography } from '@strapi/design-system';
import { Drag, Plus, Pencil, Trash } from '@strapi/icons';
import { useTheme } from 'styled-components';
import MenuList from './MenuList';
import { Item } from './types';

function MenuItem(props: {
  data: Item;
  active: boolean;
  level: number;
  onAddEvent: (id: number) => void;
  onRemoveEvent: (id: number) => void;
  onUpdateEvent: (id: number) => void;
  onSortingEvent: (sortedItems: Item[], parentId?: number) => void;
}) {
  const theme = useTheme();
  const [isDarkMode, setIsDarkMode] = useState(theme.colors.alternative100 === '#181826');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.data.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: props.active ? '0.2' : '1',
  };

  return (
    <Box ref={setNodeRef} style={{ ...style, position: 'relative' }}>
      <Box
        style={{
          position: 'absolute',
          height: '100%',
          width: '2px',
          backgroundColor: isDarkMode ? '#32324d' : '#dcdce4',
          left: '20px',
          zIndex: '1',
        }}
      ></Box>
      <Box
        style={{
          display: 'flex',
          width: '100%',
          marginBottom: '5px',
          position: 'relative',
          zIndex: '2',
        }}
      >
        <Card
          {...attributes}
          {...listeners}
          style={{
            border: props.data.selected
              ? '1px solid #7b79ff'
              : `1px solid ${isDarkMode ? '#32324d' : '#dcdce4'}`,
            alignItems: 'center',
            justifyContent: 'center',
            height: '40px',
            width: '40px',
            display: 'flex',
            cursor: 'grab',
            marginRight: '5px',
          }}
        >
          <Drag />
        </Card>
        <Card
          style={{
            border: props.data.selected
              ? '1px solid #7b79ff'
              : `1px solid ${isDarkMode ? '#32324d' : '#dcdce4'}`,
            width: '100%',
            flex: '1',
            display: 'flex',
            alignItems: 'center',
            height: '40px',
            padding: '0 15px',
            marginRight: '5px',
          }}
        >
          <Typography variant="omega">{props.data.title}</Typography>
        </Card>
        <Box style={{ display: 'flex' }}>
          <Card
            style={{
              border: props.data.selected
                ? '1px solid #7b79ff'
                : `1px solid ${isDarkMode ? '#32324d' : '#dcdce4'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '40px',
              width: '40px',
              marginRight: '5px',
              cursor: 'pointer',
            }}
            onClick={() => props.onAddEvent(props.data.id)}
          >
            <Plus />
          </Card>
          <Card
            style={{
              border: props.data.selected
                ? '1px solid #7b79ff'
                : `1px solid ${isDarkMode ? '#32324d' : '#dcdce4'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '40px',
              width: '40px',
              marginRight: '5px',
              cursor: 'pointer',
            }}
            onClick={() => props.onUpdateEvent(props.data.id)}
          >
            <Pencil />
          </Card>
          <Card
            style={{
              border: props.data.selected
                ? '1px solid #7b79ff'
                : `1px solid ${isDarkMode ? '#32324d' : '#dcdce4'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '40px',
              width: '40px',
              cursor: 'pointer',
            }}
            onClick={() => props.onRemoveEvent(props.data.id)}
          >
            <Trash />
          </Card>
        </Box>
      </Box>

      {props.data.children.length > 0 && (
        <Box style={{ width: '100%', paddingLeft: '45px' }}>
          <MenuList
            items={props.data.children}
            level={props.level + 1}
            parentId={props.data.id}
            onAddEvent={props.onAddEvent}
            onRemoveEvent={props.onRemoveEvent}
            onUpdateEvent={props.onUpdateEvent}
            onSortingEvent={props.onSortingEvent}
          />
        </Box>
      )}
    </Box>
  );
}

export default MenuItem;
