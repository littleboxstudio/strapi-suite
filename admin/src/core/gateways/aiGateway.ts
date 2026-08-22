import HttpClient from "../http/httpClient";
import Registry from '../di/registry';
import config from "../config";

export default interface AiGateway {
  translateStrings(input: TranslateStringsInput): Promise<TranslateStringsOutput>;
}

export class AiGatewayHttp implements AiGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject("httpClient");
  }

  async translateStrings(input: TranslateStringsInput): Promise<TranslateStringsOutput> {
    return this.httpClient.post(`/${config.pluginId}/admin/ai/strings`, input);
  }
}

export type TranslateStringsInput = {
  sourceLocale: string;
  targetLocale: string;
  strings: Record<string, string>;
}

export type TranslateStringsOutput = {
  translations: Record<string, string>;
  failed: number;
  errors: string[];
}
