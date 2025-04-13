import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";
import { objectToQueryString } from "../utils/objectToQueryString";

export default interface TemplateGateway {
  fetch(): Promise<FetchOutput[]>;
  delete(documentIds: string[]): Promise<void>;
  create(params: { uid: string; name: string }): Promise<void>;
  edit(documentId: string, params: { uid: string; name: string }): Promise<void>;
}

export class TemplateGatewayHttp implements TemplateGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }
  
  async fetch(params: Record<string, any> = {}): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/templates${objectToQueryString(params)}`);
  }

  async delete(documentIds: string[], params: Record<string, any> = {}): Promise<void> { 
    return this.httpClient.post(
      `/${config.pluginId}/admin/templates/actions/delete`,
      { documentIds }
    );
  }

  async create(params: { uid: string; name: string }): Promise<void> { 
    return this.httpClient.post(`/${config.pluginId}/admin/templates`, params);
  }

  async edit(documentId: string, params: { uid: string; name: string }): Promise<void> { 
    return this.httpClient.put(`/${config.pluginId}/admin/templates/${documentId}`, params);
  }
}

type FetchOutput = {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  uid: string;
  name: string;
}