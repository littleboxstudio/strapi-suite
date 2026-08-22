import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import { objectToQueryString } from "../utils/objectToQueryString";

export default interface DocumentGateway {
  fetch(input: FetchInput): Promise<any>;
}

export class DocumentGatewayHttp implements DocumentGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }

  async fetch({ collectionType, model, documentId, params }: FetchInput): Promise<any> {
    const path = documentId
      ? `/content-manager/${collectionType}/${model}/${documentId}`
      : `/content-manager/${collectionType}/${model}`;
    const response = await this.httpClient.get(`${path}${objectToQueryString(params)}`);
    return response ? response.data : null;
  }
}

export type FetchInput = {
  collectionType: string;
  model: string;
  documentId?: string;
  params: Record<string, any>;
}
