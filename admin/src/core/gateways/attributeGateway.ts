import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";
import { objectToQueryString } from "../utils/objectToQueryString";

export default interface AttributeGateway {
  fetch(params: Record<string, any>): Promise<FetchOutput[]>;
  fetchByContentId(contentId: string, params: Record<string, any>): Promise<FetchOutput[]>;
  delete(data: string[], params: Record<string, any>): Promise<void>;
}

export class AttributeGatewayHttp implements AttributeGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }

  async fetch(params: Record<string, any> = {}): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/attributes${objectToQueryString(params)}`);
  }
  
  async fetchByContentId(contentId: string, params: Record<string, any> = {}): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/attributes/${contentId}${objectToQueryString(params)}`);
  }

  async delete(contentIds: string[], params: Record<string, any> = {}): Promise<void> { 
    return this.httpClient.post(
      `/${config.pluginId}/admin/attributes/actions/delete${objectToQueryString(params)}`,
      { contentIds }
    );
  }
}

type FetchOutput = {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  contentId: string;
  contentModel: string;
  contentTitle: string;
  parentContentId: string;
  parentContentModel: string;
  templateId: string;
  templateTitle: string;
  locale: string;
}