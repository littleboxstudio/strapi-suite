import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";

export default interface ParameterGateway {
  fetch(params: Record<string, any>): Promise<FetchOutput[]>;
  delete(documentIds: string[]): Promise<void>;
  create(params: { uid: string; value: string; private: boolean }): Promise<void>;
  edit(documentId: string, params: { uid: string; value: string; private: boolean }): Promise<void>;
}

export class ParameterGatewayHttp implements ParameterGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }

  async fetch(): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/parameters`);
  }

  async delete(documentIds: string[], params: Record<string, any> = {}): Promise<void> { 
    return this.httpClient.post(
      `/${config.pluginId}/admin/parameters/actions/delete`,
      { documentIds }
    );
  }

  async create(params: { uid: string; value: string; private: boolean }): Promise<void> { 
    return this.httpClient.post(`/${config.pluginId}/admin/parameters`, params);
  }

  async edit(documentId: string, params: { uid: string; value: string; private: boolean }): Promise<void> { 
    return this.httpClient.put(`/${config.pluginId}/admin/parameters/${documentId}`, params);
  }
}

type FetchOutput = {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  uid: string;
  value: string;
  private: boolean;
}