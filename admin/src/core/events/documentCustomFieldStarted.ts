import Event from './event';

export default class DocumentCustomFieldStarted implements Event {
  id = "documentCustomFieldStarted";
  static id = "documentCustomFieldStarted";
  constructor (readonly data: DocumentCustomFieldStartedData) {}
}

export type DocumentCustomFieldStartedData = {
  name: string
}