import { useEffect, useState, useRef } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box } from '@strapi/design-system';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Item } from './types';
import MenuItem from './MenuItem';

function customCollisionDetectionAlgorithm(args: any) {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return rectIntersection(args);
}

function MenuList(props: {
  items: Item[];
  level: number;
  parentId?: number;
  onAddEvent: (id: number) => void;
  onRemoveEvent: (id: number) => void;
  onUpdateEvent: (id: number) => void;
  onSortingEvent: (sortedItems: Item[], parentId?: number) => void;
}) {
  const [activeItem, setActiveIdtem] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [lastSorting, setLastSorting] = useState<number | null>(null);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((items: Item[]) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
      setLastSorting(Date.now());
    }
    setActiveIdtem(null);
  }

  function handleDragStart(event: DragEndEvent) {
    const activeItem = items.find((item) => item.id === event.active.id);
    setActiveIdtem(activeItem);
  }

  useEffect(() => {
    if (lastSorting) {
      props.onSortingEvent(items, props.parentId);
    }
  }, [items, lastSorting]);

  useEffect(() => {
    setItems(props.items);
  }, [props.items]);

  return (
    <Box style={{ width: '100%' }}>
      <DndContext
        collisionDetection={customCollisionDetectionAlgorithm}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items.map((item: Item) => (
            <MenuItem
              key={item.id}
              data={item}
              active={activeItem && activeItem.id === item.id}
              level={props.level}
              onAddEvent={props.onAddEvent}
              onRemoveEvent={props.onRemoveEvent}
              onUpdateEvent={props.onUpdateEvent}
              onSortingEvent={props.onSortingEvent}
            />
          ))}
        </SortableContext>
        <DragOverlay>
          {activeItem ? (
            <MenuItem
              data={activeItem}
              active={false}
              level={0}
              onAddEvent={() => {}}
              onRemoveEvent={() => {}}
              onUpdateEvent={() => {}}
              onSortingEvent={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </Box>
  );
}

export default MenuList;
