import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../../config';
import {
  EMAIL_TEMPLATE_TYPES,
  EmailTemplateType,
  VariableDef,
  getSampleData,
  getVariableCatalog,
} from './catalog';
import { TemplateIssue, TemplateSyntaxError, renderTemplate, validateTemplate } from './templateEngine';
import { DEFAULT_TEMPLATES } from './defaults';
import { sendWithResend } from '../providers/email/resendSender';
import {
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommerceValidationError,
  ValidationIssue,
} from '../errors';
import type { AuditEntry } from '../audit';
import type { StoreSettings } from '../settings';
import type { ProviderRuntime } from '../providers/registry';

const AREA = 'email_templates';

export type TemplateContent = { subject: string; html: string };

export type EmailTemplateView = {
  type: EmailTemplateType;
  locale: string;
  subject: string;
  html: string;
  isCustom: boolean;
  version: number;
  variables: VariableDef[];
};

export type EmailTemplateVersionView = {
  id: number;
  version: number;
  subject: string;
  html: string;
  createdBy: string | null;
  createdAt: string | null;
};

type TemplateRow = {
  id: number;
  type: string;
  locale: string;
  subject: string | null;
  html: string | null;
  version: number | null;
  updatedBy: string | null;
};

type SettingsApi = {
  getStoreSettings(): Promise<StoreSettings>;
  getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
};

const isEmail = (v: unknown) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Maps the store settings to the `store.*` template variables. */
const storeVariables = (s: StoreSettings): Record<string, string> => ({
  name: s.storeName,
  logoUrl: s.logoUrl ?? '',
  brandColor: s.brandColor,
  url: s.storefrontUrl ?? '',
  supportEmail: s.supportEmail ?? '',
});

/** Subjects are plain text (not escaped); bodies are HTML (escaped). */
const renderPart = (part: 'subject' | 'html', source: string, data: Record<string, unknown>): string =>
  renderTemplate(source, data, { escape: part === 'html' });

/** Renders without throwing: a malformed part renders as an empty string (validation reports it). */
const safeRender = (part: 'subject' | 'html', source: string, data: Record<string, unknown>): string => {
  try {
    return renderPart(part, source, data);
  } catch (err) {
    if (err instanceof TemplateSyntaxError) return '';
    throw err;
  }
};

/** Renders for sending: a malformed part (e.g. a legacy row) becomes a validation error, never a raw one. */
const strictRender = (source: TemplateContent, data: Record<string, unknown>): TemplateContent => {
  const out: TemplateContent = { subject: '', html: '' };
  const errors: ValidationIssue[] = [];
  for (const part of ['subject', 'html'] as const) {
    try {
      out[part] = renderPart(part, source[part], data);
    } catch (err) {
      if (!(err instanceof TemplateSyntaxError)) throw err;
      errors.push({ path: part, code: 'SYNTAX', detail: err.message });
    }
  }
  if (errors.length) throw new EcommerceValidationError('Invalid template', errors);
  return out;
};

const EcommerceEmailTemplateService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const audit = (entry: AuditEntry): Promise<void> =>
    strapi.plugin(PLUGIN_ID).service('EcommerceAuditService').log(entry);
  const settings = (): SettingsApi => strapi.plugin(PLUGIN_ID).service('EcommerceSettingsService');
  const locales = () => strapi.plugin('i18n').service('locales');
  const getDefaultLocale = async (): Promise<string> => locales().getDefaultLocale();

  const templates = () => strapi.db.query(uids().emailTemplate);
  const versions = () => strapi.db.query(uids().emailTemplateVersion);
  const userRef = (userId?: string | number) => (userId === undefined ? undefined : String(userId));

  const requireType = (type: string): EmailTemplateType => {
    if (!(EMAIL_TEMPLATE_TYPES as readonly string[]).includes(type)) {
      throw new EcommerceNotFoundError('Email template not found');
    }
    return type as EmailTemplateType;
  };

  const requireLocale = async (locale: string): Promise<string> => {
    const all: { code: string }[] = await locales().find();
    if (typeof locale !== 'string' || !all.some((l) => l.code === locale)) {
      throw new EcommerceValidationError('Invalid locale', [{ path: 'locale', code: 'invalid_locale' }]);
    }
    return locale;
  };

  const findCustom = (type: string, locale: string): Promise<TemplateRow | null> =>
    templates().findOne({ where: { type, locale } });

  /** Current version number: the customization's, else one past the newest stored version. */
  const currentVersion = async (type: string, locale: string, row: TemplateRow | null) => {
    if (row) return row.version ?? 1;
    const [latest] = await versions().findMany({
      where: { type, locale },
      orderBy: [{ version: 'desc' }],
      limit: 1,
      offset: 0,
    });
    return (latest?.version ?? 0) + 1;
  };

  const currentContent = (type: EmailTemplateType, row: TemplateRow | null): TemplateContent =>
    row ? { subject: row.subject ?? '', html: row.html ?? '' } : DEFAULT_TEMPLATES[type];

  const validateContent = (type: EmailTemplateType, input: TemplateContent): TemplateContent => {
    const subject = typeof input?.subject === 'string' ? input.subject : '';
    const html = typeof input?.html === 'string' ? input.html : '';
    const errors: ValidationIssue[] = [];
    if (subject.trim() === '') errors.push({ path: 'subject', code: 'required' });
    if (html.trim() === '') errors.push({ path: 'html', code: 'required' });
    for (const issue of validateTemplate(type, subject, html)) {
      errors.push({
        path: issue.detail.startsWith('subject:') ? 'subject' : 'html',
        code: issue.code,
        detail: issue.detail,
      });
    }
    if (errors.length) throw new EcommerceValidationError('Invalid template', errors);
    return { subject, html };
  };

  /** Snapshots the current content, then writes `content` as the next version (or deletes when null). */
  const replace = async (
    type: EmailTemplateType,
    locale: string,
    content: TemplateContent | null,
    userId?: string | number
  ): Promise<number> =>
    strapi.db.transaction(async () => {
      const row = await findCustom(type, locale);
      const version = await currentVersion(type, locale, row);
      const previous = currentContent(type, row);
      // The snapshot is attributed to whoever wrote that content (null for the built-in default).
      await versions().create({
        data: { type, locale, ...previous, version, createdBy: row?.updatedBy ?? null },
      });
      if (content === null) {
        if (row) await templates().delete({ where: { id: row.id } });
      } else if (row) {
        await templates().update({
          where: { id: row.id },
          data: { ...content, version: version + 1, updatedBy: userRef(userId) ?? null },
        });
      } else {
        await templates().create({
          data: { type, locale, ...content, version: version + 1, updatedBy: userRef(userId) ?? null },
        });
      }
      return version + 1;
    });

  const sampleData = async (type: EmailTemplateType): Promise<Record<string, unknown>> => ({
    ...getSampleData(type),
    store: storeVariables(await settings().getStoreSettings()),
  });

  return {
    async list(): Promise<{ type: EmailTemplateType; customLocales: string[] }[]> {
      const rows: TemplateRow[] = await templates().findMany({});
      return EMAIL_TEMPLATE_TYPES.map((type) => ({
        type,
        customLocales: rows
          .filter((r) => r.type === type)
          .map((r) => r.locale)
          .sort(),
      }));
    },

    async get(type: EmailTemplateType, locale: string): Promise<EmailTemplateView> {
      const t = requireType(type);
      await requireLocale(locale);
      const row = await findCustom(t, locale);
      return {
        type: t,
        locale,
        ...currentContent(t, row),
        isCustom: row !== null,
        version: await currentVersion(t, locale, row),
        variables: getVariableCatalog(t),
      };
    },

    async save(
      type: EmailTemplateType,
      locale: string,
      input: TemplateContent,
      userId?: string | number
    ): Promise<EmailTemplateView> {
      const t = requireType(type);
      await requireLocale(locale);
      const content = validateContent(t, input);
      const version = await replace(t, locale, content, userId);
      await audit({
        area: AREA,
        action: 'email_template.save',
        targetId: `${t}:${locale}`,
        userId: userRef(userId),
        details: { version },
      });
      return this.get(t, locale);
    },

    async listVersions(type: EmailTemplateType, locale: string): Promise<EmailTemplateVersionView[]> {
      const t = requireType(type);
      await requireLocale(locale);
      const rows = await versions().findMany({
        where: { type: t, locale },
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
      });
      return rows.map((r: any) => ({
        id: r.id,
        version: r.version,
        subject: r.subject ?? '',
        html: r.html ?? '',
        createdBy: r.createdBy ?? null,
        createdAt: r.createdAt ?? null,
      }));
    },

    async restoreVersion(
      type: EmailTemplateType,
      locale: string,
      versionId: number,
      userId?: string | number
    ): Promise<EmailTemplateView> {
      const t = requireType(type);
      await requireLocale(locale);
      const stored = await versions().findOne({ where: { id: versionId, type: t, locale } });
      if (!stored) throw new EcommerceNotFoundError('Template version not found');
      const content = validateContent(t, { subject: stored.subject ?? '', html: stored.html ?? '' });
      const version = await replace(t, locale, content, userId);
      await audit({
        area: AREA,
        action: 'email_template.restore_version',
        targetId: `${t}:${locale}`,
        userId: userRef(userId),
        details: { restoredVersion: stored.version, version },
      });
      return this.get(t, locale);
    },

    async restoreDefault(
      type: EmailTemplateType,
      locale: string,
      userId?: string | number
    ): Promise<EmailTemplateView> {
      const t = requireType(type);
      await requireLocale(locale);
      if (await findCustom(t, locale)) {
        await replace(t, locale, null, userId);
        await audit({
          area: AREA,
          action: 'email_template.restore_default',
          targetId: `${t}:${locale}`,
          userId: userRef(userId),
        });
      }
      return this.get(t, locale);
    },

    async preview(
      type: EmailTemplateType,
      input: TemplateContent
    ): Promise<{ subject: string; html: string; issues: TemplateIssue[] }> {
      const t = requireType(type);
      const subject = typeof input?.subject === 'string' ? input.subject : '';
      const html = typeof input?.html === 'string' ? input.html : '';
      const data = await sampleData(t);
      return {
        subject: safeRender('subject', subject, data),
        html: safeRender('html', html, data),
        issues: validateTemplate(t, subject, html),
      };
    },

    /**
     * Locale customization → default-locale customization → built-in default. `store` always comes
     * from the store settings. The subject is plain text; a malformed stored template throws
     * EcommerceValidationError (code SYNTAX).
     */
    async render(
      type: EmailTemplateType,
      locale: string,
      data: Record<string, unknown>
    ): Promise<TemplateContent> {
      const t = requireType(type);
      const defaultLocale = await getDefaultLocale();
      const row = (await findCustom(t, locale)) ?? (await findCustom(t, defaultLocale));
      const source = currentContent(t, row);
      const full = { ...data, store: storeVariables(await settings().getStoreSettings()) };
      return strictRender(source, full);
    },

    async sendTest(
      type: EmailTemplateType,
      locale: string,
      to: string,
      userId?: string | number
    ): Promise<{ id: string }> {
      const t = requireType(type);
      await requireLocale(locale);
      if (!isEmail(to)) {
        throw new EcommerceValidationError('Invalid recipient', [{ path: 'to', code: 'invalid_email' }]);
      }
      const rt = await settings().getRuntime('resend');
      if (!rt || !rt.active) {
        throw new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'Resend is not active.');
      }
      const message = await this.render(t, locale, getSampleData(t));
      const result = await sendWithResend(rt, { to, ...message });
      await audit({
        area: AREA,
        action: 'email_template.send_test',
        targetId: `${t}:${locale}`,
        userId: userRef(userId),
      });
      return result;
    },
  };
};

export default EcommerceEmailTemplateService;
