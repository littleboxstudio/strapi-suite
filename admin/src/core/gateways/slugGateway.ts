import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";
import { objectToQueryString } from "../utils/objectToQueryString";

export default interface SlugGateway {
  fetch(params: Record<string, any>): Promise<FetchOutput[]>;
  delete(data: string[], params: Record<string, any>): Promise<void>;
}

export class SlugGatewayHttp implements SlugGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }
  
  async fetch(params: Record<string, any> = {}): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/slugs${objectToQueryString(params)}`);
  }

  async delete(contentIds: string[], params: Record<string, any> = {}): Promise<void> { 
    return this.httpClient.post(
      `/${config.pluginId}/admin/slugs/actions/delete${objectToQueryString(params)}`,
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
  slug: string;
  contentId: string;
  contentTitle: string;
  contentModel: string;
  parentContentId: string;
  parentContentModel: string;
  locale: string;
}