import HttpClient from '../../core/http/httpClient';
import Registry from '../../core/di/registry';
import config from '../../core/config';
import type {
  ConnectionResult,
  EmailPreview,
  EmailTemplateSummary,
  EmailTemplateType,
  EmailTemplateVersionView,
  EmailTemplateView,
  IntegrationInput,
  IntegrationView,
  ManualMethod,
  ManualMethodInput,
  StoreSettings,
  TemplateContent,
} from '../settingsTypes';
import type { EcommerceLocales } from '../types';

export default interface EcommerceSettingsGateway {
  fetchLocales(): Promise<EcommerceLocales>;
  fetchStore(): Promise<StoreSettings>;
  updateStore(input: Partial<StoreSettings>): Promise<StoreSettings>;

  fetchIntegrations(): Promise<IntegrationView[]>;
  updateIntegration(id: string, input: IntegrationInput): Promise<IntegrationView>;
  setIntegrationActive(id: string, active: boolean): Promise<IntegrationView>;
  testIntegration(id: string): Promise<ConnectionResult>;

  fetchShippingMethods(): Promise<ManualMethod[]>;
  createShippingMethod(input: ManualMethodInput): Promise<ManualMethod>;
  updateShippingMethod(id: number, input: ManualMethodInput): Promise<ManualMethod>;
  deleteShippingMethod(id: number): Promise<void>;

  fetchEmailTemplates(): Promise<EmailTemplateSummary[]>;
  fetchEmailTemplate(type: EmailTemplateType, locale: string): Promise<EmailTemplateView>;
  saveEmailTemplate(
    type: EmailTemplateType,
    locale: string,
    content: TemplateContent
  ): Promise<EmailTemplateView>;
  previewEmailTemplate(type: EmailTemplateType, content: TemplateContent): Promise<EmailPreview>;
  sendTestEmail(type: EmailTemplateType, locale: string, to: string): Promise<{ id: string }>;
  restoreDefaultEmailTemplate(type: EmailTemplateType, locale: string): Promise<EmailTemplateView>;
  fetchEmailTemplateVersions(
    type: EmailTemplateType,
    locale: string
  ): Promise<EmailTemplateVersionView[]>;
  restoreEmailTemplateVersion(
    type: EmailTemplateType,
    locale: string,
    versionId: number
  ): Promise<EmailTemplateView>;
}

const seg = encodeURIComponent;

export class EcommerceSettingsGatewayHttp implements EcommerceSettingsGateway {
  httpClient: HttpClient;

  constructor() {
    this.httpClient = Registry.getInstance().inject('httpClient');
  }

  private base = `/${config.pluginId}/admin/ecommerce/settings`;

  private template(type: EmailTemplateType, locale: string): string {
    return `${this.base}/email-templates/${seg(type)}/${seg(locale)}`;
  }

  async fetchLocales(): Promise<EcommerceLocales> {
    return this.httpClient.get(`${this.base}/locales`);
  }

  async fetchStore(): Promise<StoreSettings> {
    return this.httpClient.get(`${this.base}/store`);
  }

  async updateStore(input: Partial<StoreSettings>): Promise<StoreSettings> {
    return this.httpClient.put(`${this.base}/store`, input);
  }

  async fetchIntegrations(): Promise<IntegrationView[]> {
    return this.httpClient.get(`${this.base}/integrations`);
  }

  async updateIntegration(id: string, input: IntegrationInput): Promise<IntegrationView> {
    return this.httpClient.put(`${this.base}/integrations/${seg(id)}`, input);
  }

  async setIntegrationActive(id: string, active: boolean): Promise<IntegrationView> {
    return this.httpClient.post(`${this.base}/integrations/${seg(id)}/activate`, { active });
  }

  async testIntegration(id: string): Promise<ConnectionResult> {
    return this.httpClient.post(`${this.base}/integrations/${seg(id)}/test`, {});
  }

  async fetchShippingMethods(): Promise<ManualMethod[]> {
    return this.httpClient.get(`${this.base}/shipping-methods`);
  }

  async createShippingMethod(input: ManualMethodInput): Promise<ManualMethod> {
    return this.httpClient.post(`${this.base}/shipping-methods`, input);
  }

  async updateShippingMethod(id: number, input: ManualMethodInput): Promise<ManualMethod> {
    return this.httpClient.put(`${this.base}/shipping-methods/${id}`, input);
  }

  async deleteShippingMethod(id: number): Promise<void> {
    await this.httpClient.delete(`${this.base}/shipping-methods/${id}`);
  }

  async fetchEmailTemplates(): Promise<EmailTemplateSummary[]> {
    return this.httpClient.get(`${this.base}/email-templates`);
  }

  async fetchEmailTemplate(type: EmailTemplateType, locale: string): Promise<EmailTemplateView> {
    return this.httpClient.get(this.template(type, locale));
  }

  async saveEmailTemplate(
    type: EmailTemplateType,
    locale: string,
    content: TemplateContent
  ): Promise<EmailTemplateView> {
    return this.httpClient.put(this.template(type, locale), content);
  }

  async previewEmailTemplate(
    type: EmailTemplateType,
    content: TemplateContent
  ): Promise<EmailPreview> {
    return this.httpClient.post(`${this.base}/email-templates/${seg(type)}/preview`, content);
  }

  async sendTestEmail(
    type: EmailTemplateType,
    locale: string,
    to: string
  ): Promise<{ id: string }> {
    return this.httpClient.post(`${this.template(type, locale)}/test`, { to });
  }

  async restoreDefaultEmailTemplate(
    type: EmailTemplateType,
    locale: string
  ): Promise<EmailTemplateView> {
    return this.httpClient.post(`${this.template(type, locale)}/restore-default`, {});
  }

  async fetchEmailTemplateVersions(
    type: EmailTemplateType,
    locale: string
  ): Promise<EmailTemplateVersionView[]> {
    return this.httpClient.get(`${this.template(type, locale)}/versions`);
  }

  async restoreEmailTemplateVersion(
    type: EmailTemplateType,
    locale: string,
    versionId: number
  ): Promise<EmailTemplateView> {
    return this.httpClient.post(
      `${this.template(type, locale)}/versions/${versionId}/restore`,
      {}
    );
  }
}
