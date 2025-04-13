import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";
import { objectToQueryString } from "../utils/objectToQueryString";

export default interface MenuGateway {
  fetch(params: Record<string, any>): Promise<FetchOutput[]>;
  fetchByDocumentId(documentId: string): Promise<FetchWithChildrenOutput>;
  delete(documentIds: string[], params: Record<string, any>): Promise<void>;
  duplicate(documentId: string, locale: string): Promise<void>;
  create(params: { uid: string; title: string; locale: string; }): Promise<void>;
  edit(documentId: string, params: { uid: string; title: string; children: ChildrenInput[] }): Promise<void>;
}

export class MenuGatewayHttp implements MenuGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }

  async fetch(params: Record<string, any> = {}): Promise<FetchOutput[]> {
    return this.httpClient.get(`/${config.pluginId}/admin/menus${objectToQueryString(params)}`);
  }
  
  async fetchByDocumentId(documentId: string): Promise<FetchWithChildrenOutput> {
    return this.httpClient.get(`/${config.pluginId}/admin/menus/${documentId}`);
  }

  async delete(documentIds: string[], params: Record<string, any> = {}): Promise<void> { 
    return this.httpClient.post(
      `/${config.pluginId}/admin/menus/actions/delete`,
      { documentIds }
    );
  }

  async duplicate(documentId: string, locale: string): Promise<void> { 
    return this.httpClient.post(
      `/${config.pluginId}/admin/menus/actions/duplicate`,
      { documentId, locale }
    );
  }

  async create(params: { uid: string; title: string; locale: string; }): Promise<void> { 
    return this.httpClient.post(`/${config.pluginId}/admin/menus`, params);
  }

  async edit(documentId: string, params: { uid: string; title: string; children: ChildrenInput[] }): Promise<void> { 
    return this.httpClient.put(`/${config.pluginId}/admin/menus/${documentId}`, params);
  }
}

type FetchOutput = {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  title: string;
  uid: string;
  locale: string;
}

type FetchWithChildrenOutput = {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  title: string;
  uid: string;
  locale: string;
  children?: {
    id: number;
    documentId: string;
    createdAt: string;
    updatedAt: string;
    publishedAt: string;
    uid: string;
    parentId: string;
    title: string;
    url: string;
    target: string;
    order: number;
    contentId?: string;
    contentModel?: string;
    metadata?: Record<string, any>;
  }[];
}

interface ChildrenInput { 
  title: string;
  order: number;
  target: string;
  url?: string;
  contentId?: string;
  contentModel?: string;
  metadata?: Record<string, any>;
  children?: ChildrenInput[];
}