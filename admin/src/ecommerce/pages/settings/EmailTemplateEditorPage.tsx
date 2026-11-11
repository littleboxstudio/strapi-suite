import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth, useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, ArrowsCounterClockwise, ClockCounterClockwise, Mail } from '@strapi/icons';
import ConfirmModal from '../../../components/ConfirmModal';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import { LocaleSwitcher } from '../../components/LocaleSwitcher';
import { HtmlCodeEditor, type HtmlCodeEditorHandle } from '../../components/settings/HtmlCodeEditor';
import { EmailPreview } from '../../components/settings/EmailPreview';
import { VariablesPanel } from '../../components/settings/VariablesPanel';
import { TestEmailModal } from '../../components/settings/TestEmailModal';
import { TemplateVersionsModal } from '../../components/settings/TemplateVersionsModal';
import FetchEmailTemplate from '../../usecases/settings/fetchEmailTemplate';
import SaveEmailTemplate from '../../usecases/settings/saveEmailTemplate';
import PreviewEmailTemplate from '../../usecases/settings/previewEmailTemplate';
import RestoreDefaultEmailTemplate from '../../usecases/settings/restoreDefaultEmailTemplate';
import FetchSettingsLocales from '../../usecases/settings/fetchSettingsLocales';
import { extractFieldErrors } from '../../utils/productForm';
import { insertAtCursor, isEmailTemplateType } from '../../utils/emailTemplateEditor';
import { useSettingsPermissions } from './useSettingsPermissions';
import type {
  EmailPreview as EmailPreviewData,
  EmailTemplateView,
  TemplateIssue,
} from '../../settingsTypes';

/** Delay between the last keystroke and the preview request. */
const PREVIEW_DEBOUNCE_MS = 400;

type FieldIssues = { subject?: TemplateIssue[]; html?: TemplateIssue[] };
type Locales = { defaultLocale: string; locales: { code: string; name: string }[] };

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;

  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const EmailTemplateEditorPage = () => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const navigate = useNavigate();
  const params = useParams<{ type: string; locale: string }>();
  const { isLoading: permissionsLoading, canUpdate } = useSettingsPermissions();
  const userEmail = useAuth('EmailTemplateEditorPage', (state) => state.user?.email) ?? '';
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const settingsPath = `/plugins/${config.pluginId}/ecommerce/settings/email-templates`;
  const type = isEmailTemplateType(params.type) ? params.type : null;
  const locale = params.locale ?? '';
  const readOnly = !canUpdate;

  const [template, setTemplate] = useState<EmailTemplateView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [issues, setIssues] = useState<FieldIssues>({});
  const [saving, setSaving] = useState(false);
  const [locales, setLocales] = useState<Locales | null>(null);

  const [preview, setPreview] = useState<EmailPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const previewRequest = useRef(0);

  const [testOpen, setTestOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingLocale, setPendingLocale] = useState<string | null>(null);

  const editorRef = useRef<HtmlCodeEditorHandle>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  /** Where a clicked variable goes: the last focused field. */
  const insertTarget = useRef<'subject' | 'html'>('html');

  const applyTemplate = (view: EmailTemplateView) => {
    setTemplate(view);
    setSubject(view.subject);
    setHtml(view.html);
    setIssues({});
  };

  useEffect(() => {
    if (!type) return;
    let cancelled = false;
    setTemplate(null);
    setLoadError(false);
    new FetchEmailTemplate()
      .execute(type, locale)
      .then((view) => {
        if (!cancelled) applyTemplate(view);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [type, locale]);

  useEffect(() => {
    let cancelled = false;
    new FetchSettingsLocales()
      .execute()
      .then((info) => {
        if (!cancelled) setLocales(info);
      })
      .catch(() => {
        // Needs the products read permission; without it only the current locale is offered.
        if (!cancelled) setLocales({ defaultLocale: '', locales: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = template !== null;

  // Debounced preview; a newer request makes the older responses stale.
  useEffect(() => {
    if (!type || !loaded) return;
    const request = ++previewRequest.current;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      new PreviewEmailTemplate()
        .execute(type, { subject, html })
        .then((result) => {
          if (request !== previewRequest.current) return;
          setPreview(result);
          setPreviewError(false);
        })
        .catch(() => {
          if (request === previewRequest.current) setPreviewError(true);
        })
        .finally(() => {
          if (request === previewRequest.current) setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [type, subject, html, loaded]);

  useEffect(
    () => () => {
      // Ignore any response that arrives after leaving the page.
      previewRequest.current += 1;
    },
    []
  );

  if (!type) return <Navigate to={settingsPath} replace />;

  const dirty = !!template && (subject !== template.subject || html !== template.html);

  const goToLocale = (code: string) => navigate(`${settingsPath}/${type}/${encodeURIComponent(code)}`);

  const onLocaleChange = (code: string) => {
    if (code === locale) return;
    if (dirty) setPendingLocale(code);
    else goToLocale(code);
  };

  const save = async () => {
    if (readOnly) return;
    setSaving(true);
    setIssues({});
    try {
      const saved = await new SaveEmailTemplate().execute(type, locale, { subject, html });
      applyTemplate(saved);
      toggleNotification({
        type: 'success',
        message: t('ecommerce.settings.emailTemplates.editor.saved'),
      });
    } catch (err) {
      const fieldErrors = extractFieldErrors(err) as unknown as
        | (TemplateIssue & { path: string })[]
        | null;
      if (fieldErrors?.length) {
        const grouped: FieldIssues = {};
        fieldErrors.forEach(({ path, code, detail }) => {
          const key = path === 'subject' ? 'subject' : 'html';
          grouped[key] = [...(grouped[key] ?? []), { code, detail }];
        });
        setIssues(grouped);
        toggleNotification({
          type: 'warning',
          message: t('ecommerce.settings.emailTemplates.editor.fixErrors'),
        });
      } else {
        toggleNotification({
          type: 'danger',
          message: t('ecommerce.settings.emailTemplates.editor.saveError'),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const restoreDefault = async () => {
    setRestoring(true);
    try {
      applyTemplate(await new RestoreDefaultEmailTemplate().execute(type, locale));
      toggleNotification({
        type: 'success',
        message: t('ecommerce.settings.emailTemplates.editor.restored'),
      });
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('ecommerce.settings.emailTemplates.editor.restoreError'),
      });
    } finally {
      setRestoring(false);
    }
  };

  const insertVariable = (snippet: string) => {
    if (insertTarget.current === 'html') {
      editorRef.current?.insert(snippet);
      return;
    }
    // The subject is a single line.
    const inline = snippet.replace(/\s*\n\s*/g, ' ');
    const input = subjectRef.current;
    const result = insertAtCursor(subject, input?.selectionStart ?? Number.NaN, inline);
    setSubject(result.text);
    setIssues((current) => ({ ...current, subject: undefined }));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(result.cursor, result.cursor);
    });
  };

  const issueText = (list: TemplateIssue[] | undefined) =>
    list?.map(
      (issue) => `${t(`ecommerce.settings.emailTemplates.issues.${issue.code}`)}: ${issue.detail}`
    );

  const title = t(`ecommerce.settings.emailTemplates.types.${type}.name`);

  const header = (
    <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
      <Flex gap={3} alignItems="center" style={{ minWidth: 0 }}>
        <IconButton
          label={t('ecommerce.settings.emailTemplates.editor.back')}
          onClick={() => navigate(settingsPath)}
        >
          <ArrowLeft />
        </IconButton>
        <Typography variant="beta" tag="h1" ellipsis>
          {title}
        </Typography>
        {template &&
          (template.isCustom ? (
            <Badge backgroundColor="primary100" textColor="primary600">
              {t('ecommerce.settings.emailTemplates.editor.customized')}
            </Badge>
          ) : (
            <Badge>{t('ecommerce.settings.emailTemplates.editor.default')}</Badge>
          ))}
      </Flex>
      {template && (
        <Flex gap={2} alignItems="center" wrap="wrap">
          <Button
            variant="tertiary"
            startIcon={<ClockCounterClockwise />}
            onClick={() => setVersionsOpen(true)}
          >
            {t('ecommerce.settings.emailTemplates.editor.versions')}
          </Button>
          <Button variant="tertiary" startIcon={<Mail />} onClick={() => setTestOpen(true)}>
            {t('ecommerce.settings.emailTemplates.editor.sendTest')}
          </Button>
          {!readOnly && template.isCustom && (
            <Button
              variant="danger-light"
              startIcon={<ArrowsCounterClockwise />}
              loading={restoring}
              onClick={() => setConfirmRestore(true)}
            >
              {t('ecommerce.settings.emailTemplates.editor.restoreDefault')}
            </Button>
          )}
          {!readOnly && (
            <Button onClick={save} loading={saving} disabled={!dirty || restoring}>
              {t('ecommerce.settings.emailTemplates.editor.save')}
            </Button>
          )}
        </Flex>
      )}
    </Flex>
  );

  const body = () => {
    if (loadError) {
      return (
        <Typography textColor="danger600">
          {t('ecommerce.settings.emailTemplates.editor.loadError')}
        </Typography>
      );
    }
    if (!template || permissionsLoading) {
      return (
        <Flex justifyContent="center" padding={8}>
          <Loader />
        </Flex>
      );
    }
    const htmlIssues = issueText(issues.html);
    return (
      <Flex direction="column" alignItems="stretch" gap={6}>
        {readOnly && (
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.settings.readOnly')}
          </Typography>
        )}

        <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
          <Field.Root
            name="subject"
            required
            error={issueText(issues.subject)?.join(' · ')}
          >
            <Field.Label>{t('ecommerce.settings.emailTemplates.editor.subject')}</Field.Label>
            <TextInput
              ref={subjectRef}
              value={subject}
              disabled={readOnly}
              onFocus={() => {
                insertTarget.current = 'subject';
              }}
              onChange={(e: any) => {
                setSubject(e.target.value);
                setIssues((current) => ({ ...current, subject: undefined }));
              }}
            />
            <Field.Error />
          </Field.Root>
        </Box>

        <Columns>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="sigma" textColor="neutral600">
                {t('ecommerce.settings.emailTemplates.editor.html')}
              </Typography>
              {htmlIssues && (
                <Box background="danger100" hasRadius padding={3} role="alert">
                  <Flex direction="column" alignItems="stretch" gap={1}>
                    {htmlIssues.map((text, i) => (
                      <Typography key={i} variant="pi" textColor="danger700">
                        {text}
                      </Typography>
                    ))}
                  </Flex>
                </Box>
              )}
              <HtmlCodeEditor
                ref={editorRef}
                value={html}
                readOnly={readOnly}
                label={t('ecommerce.settings.emailTemplates.editor.html')}
                onFocus={() => {
                  insertTarget.current = 'html';
                }}
                onChange={(value) => {
                  setHtml(value);
                  setIssues((current) => ({ ...current, html: undefined }));
                }}
              />
            </Flex>
            <VariablesPanel
              variables={template.variables}
              onInsert={readOnly ? undefined : insertVariable}
            />
          </Flex>
          <EmailPreview preview={preview} loading={previewLoading} error={previewError} />
        </Columns>
      </Flex>
    );
  };

  const localeOptions =
    locales && locales.locales.length ? locales.locales : [{ code: locale, name: locale }];

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      {header}
      {locales && (
        <LocaleSwitcher
          locales={localeOptions}
          defaultLocale={locales.defaultLocale}
          value={locale}
          onChange={onLocaleChange}
          label={t('ecommerce.settings.emailTemplates.editor.locale')}
        />
      )}
      {body()}

      {testOpen && (
        <TestEmailModal
          type={type}
          locale={locale}
          defaultTo={userEmail}
          onClose={() => setTestOpen(false)}
        />
      )}

      {versionsOpen && (
        <TemplateVersionsModal
          type={type}
          locale={locale}
          readOnly={readOnly}
          onClose={() => setVersionsOpen(false)}
          onRestored={(view) => {
            setVersionsOpen(false);
            applyTemplate(view);
          }}
        />
      )}

      <ConfirmModal
        open={confirmRestore}
        title={t('ecommerce.settings.emailTemplates.editor.restoreConfirm.title')}
        text={t('ecommerce.settings.emailTemplates.editor.restoreConfirm.text')}
        confirm={{
          button: t('ecommerce.settings.emailTemplates.editor.restoreDefault'),
          action: () => {
            setConfirmRestore(false);
            if (!readOnly) restoreDefault();
          },
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => setConfirmRestore(false),
        }}
      />

      <ConfirmModal
        open={pendingLocale !== null}
        title={t('ecommerce.settings.emailTemplates.editor.discardConfirm.title')}
        text={t('ecommerce.settings.emailTemplates.editor.discardConfirm.text')}
        confirm={{
          button: t('ecommerce.settings.emailTemplates.editor.discardConfirm.confirm'),
          action: () => {
            if (pendingLocale !== null) goToLocale(pendingLocale);
            setPendingLocale(null);
          },
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => setPendingLocale(null),
        }}
      />
    </Flex>
  );
};

export { EmailTemplateEditorPage };
