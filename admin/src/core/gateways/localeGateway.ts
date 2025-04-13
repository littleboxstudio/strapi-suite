import HttpClient from "../http/httpClient";
import Registry from '../di/registry';


export default interface LocalesGateway {
  fetch(): Promise<FetchOutput[]>;
}

export class LocaleGatewayHttp implements LocalesGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }
  
  async fetch(): Promise<FetchOutput[]> {
    return this.httpClient.get('/i18n/locales');
  }
}

type FetchOutput = {
  id: number;
  documentId: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  isDefault: boolean;
}
