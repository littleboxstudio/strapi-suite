import Event from './event';

export default class PageAttributeUpdated implements Event {
  id = "pageAttributeUpdated";
  static id = "pageAttributeUpdated";
  constructor (readonly data: PageAttributeUpdatedData) {}
}

export type PageAttributeUpdatedData = {
  parentSlug: string;
}