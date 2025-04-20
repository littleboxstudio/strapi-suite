function arrayToTree(items: any): any[] {
  const itemMap: Record<string | number, any> = {};
  items.forEach((item: any) => {
    const clonedItem = { ...item };
    clonedItem.children = [];
    itemMap[item.id] = clonedItem;
  });
  const roots: any[] = [];
  items.forEach((item: any) => {
    const id = item.id;
    const parentId = item.parentId;
    if (parentId === null) {
      roots.push(itemMap[id]);
    } else {
      if (itemMap[parentId]) {
        itemMap[parentId].children!.push(itemMap[id]);
      } else {
        roots.push(itemMap[id]);
      }
    }
  });
  return roots;
}

export { arrayToTree };
