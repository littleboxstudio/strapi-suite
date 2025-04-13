import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";

export default interface TranslationGateway {
  fetch(): Promise<FetchOutput[]>;
  delete(uids: string[]): Promise<void>;
  create(params: { uid: string; translation: string; locale: string }[]): Promise<void>;
  edit(uids: string, params: { uid: string; translation: string; locale: string }[]): Promise<void>;
}

export class TranslationGatewayHttp implements TranslationGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }

  async fetch(): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/translations`);
  }

  async delete(uids: string[], params: Record<string, any> = {}): Promise<void> { 
    return this.httpClient.post(
      `/${config.pluginId}/admin/translations/actions/delete`,
      { uids }
    );
  }

  async create(params: { uid: string; translation: string; locale: string }[]): Promise<void> { 
    return this.httpClient.post(`/${config.pluginId}/admin/translations`, params);
  }

  async edit(uid: string, params: { uid: string; translation: string; locale: string }[]): Promise<void> { 
    return this.httpClient.put(`/${config.pluginId}/admin/translations/${uid}`, params);
  }
}

type FetchOutput = {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  uid: string;
  translation: string;
  locale: string;
}