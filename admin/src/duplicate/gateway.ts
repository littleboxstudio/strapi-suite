import HttpClient from '../core/http/httpClient';
import Registry from '../core/di/registry';
import config from '../core/config';

export type DuplicateExisting = 'skip' | 'replace';
export type DuplicateStatusOption = 'follow' | 'draft';
export type DuplicateRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'INTERRUPTED';

export type DuplicateLocales = {
  defaultLocale: string;
  /** Every configured locale, the default included. */
  locales: { code: string; name: string }[];
};

export type DuplicateEcommerceCounts = {
  products: number;
  variants: number;
  categories: number;
  collections: number;
  tags: number;
  emailTemplates: number;
};

export type DuplicateSummary = {
  sourceLocale: string;
  targetLocale: string;
  /** False without AI credentials: the contents are copied untranslated. */
  aiAvailable: boolean;
  contentTypes: { uid: string; displayName: string; count: number }[];
  /** Present only when e-commerce was asked for and the module is on. */
  ecommerce?: DuplicateEcommerceCounts;
};

export type DuplicateStartInput = {
  targetLocale: string;
  existing: DuplicateExisting;
  status: DuplicateStatusOption;
  ecommerce: boolean;
};

export type DuplicateCurrent = { uid: string; documentId: string; title?: string };

export type DuplicateCounts = {
  duplicated: number;
  replaced: number;
  skipped: number;
  untranslated: number;
  failed: number;
};

/** A report line: a failure, or (`kind: 'note'`) a relation left empty. */
export type DuplicateFailure = { uid: string; documentId: string; title?: string; reason: string; kind?: 'note' };

export type DuplicateRun = {
  id: number;
  status: DuplicateRunStatus;
  sourceLocale: string;
  targetLocale: string;
  options: { existing?: DuplicateExisting; status?: DuplicateStatusOption; ecommerce?: boolean };
  startedAt: string;
  finishedAt: string | null;
  userId: string | null;
  userName: string | null;
  progress: { total: number; done: number; current: DuplicateCurrent | null };
  counts: DuplicateCounts;
  failures: DuplicateFailure[];
};

export default interface DuplicateGateway {
  fetchLocales(): Promise<DuplicateLocales>;
  fetchSummary(targetLocale: string, ecommerce: boolean): Promise<DuplicateSummary>;
  startRun(input: DuplicateStartInput): Promise<{ runId: number }>;
  fetchCurrentRun(): Promise<DuplicateRun | null>;
  fetchRuns(): Promise<DuplicateRun[]>;
}

export class DuplicateGatewayHttp implements DuplicateGateway {
  httpClient: HttpClient;
  private base = `/${config.pluginId}/admin/duplicate`;

  constructor() {
    this.httpClient = Registry.getInstance().inject('httpClient');
  }

  async fetchLocales(): Promise<DuplicateLocales> {
    return this.httpClient.get(`${this.base}/locales`);
  }

  async fetchSummary(targetLocale: string, ecommerce: boolean): Promise<DuplicateSummary> {
    return this.httpClient.post(`${this.base}/summary`, { targetLocale, ecommerce });
  }

  async startRun(input: DuplicateStartInput): Promise<{ runId: number }> {
    return this.httpClient.post(`${this.base}/runs`, input);
  }

  /** The server wraps the answer (`{ run }`) so that "no run" is not an empty 204. */
  async fetchCurrentRun(): Promise<DuplicateRun | null> {
    const body = await this.httpClient.get(`${this.base}/runs/current`);
    return body?.run ?? null;
  }

  async fetchRuns(): Promise<DuplicateRun[]> {
    const body = await this.httpClient.get(`${this.base}/runs`);
    return Array.isArray(body) ? body : [];
  }
}
