import Event from './event';

export default class AppSettingsUpdated implements Event {
  id = "appSettingsUpdated";
  static id = "appSettingsUpdated";
  constructor (readonly data: AppSettingsUpdatedData) {}
}

export type AppSettingsUpdatedData = {
  module: string;
  property: string;
  value: any;
}