import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";


export default interface SettingGateway {
  fetch(): Promise<FetchOutput[]>;
  update(data: UpdateInput): Promise<void>;
}

export class SettingGatewayHttp implements SettingGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }
  
  async fetch(): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/settings`);
  }

  async update(data: UpdateInput): Promise<void> { 
    return this.httpClient.put(`/${config.pluginId}/admin/settings`, data);
  }
}

type FetchOutput = {
  module: string;
  settings: Record<string, any>;
}


type UpdateInput = {
  module: string;
  property: string;
  value: any;
}
