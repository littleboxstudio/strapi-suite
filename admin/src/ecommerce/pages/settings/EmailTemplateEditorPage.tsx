import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth, useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import ConfirmModal from '../../../components/ConfirmModal';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import { LocaleSwitcher } from '../../components/LocaleSwitcher';
import { HtmlCodeEditor, type HtmlCodeEditorHandle } from '../../components/settings/HtmlCodeEditor';
import { EmailPreview, type EmailPreviewHandle } from '../../components/settings/EmailPreview';
import { VariablesModal } from '../../components/settings/VariablesModal';
import { TestEmailModal } from '../../components/settings/TestEmailModal';
import { TemplateVersionsModal } from '../../components/settings/TemplateVersionsModal';
import { HeaderActions } from '../../components/HeaderActions';
import FetchEmailTemplate from '../../usecases/settings/fetchEmailTemplate';
import SaveEmailTemplate from '../../usecases/settings/saveEmailTemplate';
import PreviewEmailTemplate from '../../usecases/settings/previewEmailTemplate';
import RestoreDefaultEmailTemplate from '../../usecases/settings/restoreDefaultEmailTemplate';
import FetchSettingsLocales from '../../usecases/settings/fetchSettingsLocales';
import { extractFieldErrors } from '../../utils/productForm';
import { isEmailTemplateType, shouldBlockNavigation } from '../../utils/emailTemplateEditor';
import {
  annotateTemplate,
  joinTemplate,
  replaceText,
  splitTemplate,
  textAt,
  textRange,
  type TemplatePart,
} from '../../utils/emailTextEditing';
import { useSettingsPermissions } from './useSettingsPermissions';
import type {
  EmailPreview as EmailPreviewData,
  EmailTemplateView,
  TemplateIssue,
} from '../../settingsTypes';
import { ToneBadge } from '../../components/orders/StatusBadges';

/** Delay between the last keystroke and the preview request. */
const PREVIEW_DEBOUNCE_MS = 400;

/** Side by side, the HTML and the preview fill the screen's height left below them (each scrolls inside). */
const MIN_PANE_HEIGHT = 480;
/** Below this width the columns stack and keep a fixed height (the page scrolls). */
const STACKED_WIDTH = 1100;
/** Space kept under the panes. */
const BOTTOM_GAP = 24;

/** The nearest ancestor that scrolls (the admin's content area), else the document. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight >= node.clientHeight) return node;
  }
  return document.scrollingElement as HTMLElement;
}

type FieldIssues = { subject?: TemplateIssue[]; html?: TemplateIssue[] };
type Locales = { defaultLocale: string; locales: { code: string; name: string }[] };

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;

  @media (max-width: ${STACKED_WIDTH}px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

/** A column whose last box (the editor, the preview frame) takes the height left. */
const Pane = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  height: 100%;
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

  // The preview shows the template with its texts marked, and typing there rewrites
  // them in the HTML. While a text is being typed the preview is not refreshed (that would drop
  // the caret): `editSession` holds the parts being edited and the html the preview shows.
  // The preview's texts are always editable (read-only users excepted); Save keeps the changes.
  const editTexts = !readOnly;
  const [editSession, setEditSession] = useState<{ parts: TemplatePart[]; shown: string } | null>(null);
  const previewSource = editSession?.shown ?? (editTexts ? annotateTemplate(splitTemplate(html)) : html);
  const codeEditor = useRef<HtmlCodeEditorHandle>(null);
  const previewFrame = useRef<EmailPreviewHandle>(null);
  const currentParts = () => editSession?.parts ?? splitTemplate(html);

  // The panes' height: from their top to the screen's bottom, so the page itself never scrolls.
  const columnsRef = useRef<HTMLDivElement>(null);
  const [paneHeight, setPaneHeight] = useState<number | null>(null);

  const [testOpen, setTestOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

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
        // Without the locales only the current locale is offered.
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
        .execute(type, { subject, html: previewSource })
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
  }, [type, subject, previewSource, loaded]);

  const onPreviewText = (id: number, text: string) => {
    const parts = replaceText(editSession?.parts ?? splitTemplate(html), id, text);
    setEditSession((current) => ({ parts, shown: current?.shown ?? previewSource }));
    setHtml(joinTemplate(parts));
    setIssues((current) => ({ ...current, html: undefined }));
  };
  // Edit texts keeps both sides on the same text: the caret in the preview selects it in the HTML,
  // the caret in the HTML scrolls the preview to it.
  const revealInHtml = (id: number) => {
    const range = textRange(currentParts(), id);
    if (range) codeEditor.current?.reveal(range.from, range.to);
  };
  const revealInPreview = (offset: number) => {
    if (!editTexts) return;
    const id = textAt(currentParts(), offset);
    if (id !== null) previewFrame.current?.revealText(id);
  };
  // The caret left the texts: the preview catches up with the HTML.
  const endPreviewEdit = () => setEditSession(null);

  useEffect(
    () => () => {
      // Ignore any response that arrives after leaving the page.
      previewRequest.current += 1;
    },
    []
  );

  const showsEditor = !!template && !permissionsLoading && !loadError;
  useLayoutEffect(() => {
    if (!showsEditor) return undefined;
    let frame = 0;
    const measure = () => {
      const el = columnsRef.current;
      if (!el) return;
      if (window.innerWidth <= STACKED_WIDTH) {
        setPaneHeight(null);
        return;
      }
      const scroller = scrollParent(el);
      // Where the panes start on screen with the content area scrolled to the top.
      const top = el.getBoundingClientRect().top + scroller.scrollTop;
      const first = Math.max(MIN_PANE_HEIGHT, window.innerHeight - top - BOTTOM_GAP);
      setPaneHeight(first);
      // Whatever still overflows (the content area's own padding) comes off the panes.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overflow = scroller.scrollHeight - scroller.clientHeight;
        if (overflow > 0) setPaneHeight(Math.max(MIN_PANE_HEIGHT, first - overflow));
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(frame);
    };
  }, [showsEditor, readOnly, !!locales]);

  const dirty = !!template && (subject !== template.subject || html !== template.html);

  // The Strapi admin runs on a data router, so every in-app navigation (back button, settings tabs,
  // locale switch, menu) goes through this blocker and its confirmation.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldBlockNavigation(dirty, currentLocation, nextLocation)
  );

  // Reloading or closing the tab: the browser shows its own confirmation.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (!type) return <Navigate to={settingsPath} replace />;

  const onLocaleChange = (code: string) => {
    if (code === locale) return;
    navigate(`${settingsPath}/${type}/${encodeURIComponent(code)}`);
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
        (TemplateIssue & { path: string })[] | null;
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

  const issueText = (list: TemplateIssue[] | undefined) =>
    list?.map(
      (issue) => `${t(`ecommerce.settings.emailTemplates.issues.${issue.code}`)}: ${issue.detail}`
    );

  const title = t(`ecommerce.settings.emailTemplates.types.${type}.name`);

  const localeOptions =
    locales && locales.locales.length ? locales.locales : [{ code: locale, name: locale }];

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
            <ToneBadge variant="primary">
              {t('ecommerce.settings.emailTemplates.editor.customized')}
            </ToneBadge>
          ) : (
            <ToneBadge>{t('ecommerce.settings.emailTemplates.editor.default')}</ToneBadge>
          ))}
      </Flex>
      {/* The template's languages, on the title's row. */}
      {locales && (
        <LocaleSwitcher
          locales={localeOptions}
          defaultLocale={locales.defaultLocale}
          value={locale}
          onChange={onLocaleChange}
          label={t('ecommerce.settings.emailTemplates.editor.locale')}
        />
      )}
      {template && (
        <HeaderActions>
          <Button variant="secondary" onClick={() => setVariablesOpen(true)}>
            {t('ecommerce.settings.emailTemplates.editor.variables')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setVersionsOpen(true)}
          >
            {t('ecommerce.settings.emailTemplates.editor.versions')}
          </Button>
          {/* Sending a test needs the manage permission. */}
          {!readOnly && (
            <Button variant="secondary" onClick={() => setTestOpen(true)}>
              {t('ecommerce.settings.emailTemplates.editor.sendTest')}
            </Button>
          )}
          {!readOnly && template.isCustom && (
            <Button
              variant="danger-light"
              loading={restoring}
              onClick={() => setConfirmRestore(true)}
            >
              {t('ecommerce.settings.emailTemplates.editor.restoreDefault')}
            </Button>
          )}
          {!readOnly && (
            <Button variant="secondary" onClick={save} loading={saving} disabled={!dirty || restoring}>
              {t('ecommerce.settings.emailTemplates.editor.save')}
            </Button>
          )}
        </HeaderActions>
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

        <Columns ref={columnsRef} style={paneHeight ? { height: paneHeight } : undefined}>
          <Pane>
            <Field.Root name="subject" required error={issueText(issues.subject)?.join(' · ')}>
              <TextInput
                aria-label={t('ecommerce.settings.emailTemplates.editor.subject')}
                placeholder={t('ecommerce.settings.emailTemplates.editor.subject')}
                value={subject}
                disabled={readOnly}
                onChange={(e: any) => {
                  setSubject(e.target.value);
                  setIssues((current) => ({ ...current, subject: undefined }));
                }}
              />
              <Field.Error />
            </Field.Root>
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
            <div style={paneHeight ? { flex: 1, minHeight: 0 } : undefined}>
              <HtmlCodeEditor
                ref={codeEditor}
                height={paneHeight ? '100%' : `${MIN_PANE_HEIGHT}px`}
                onCursor={revealInPreview}
                value={html}
                readOnly={readOnly}
                label={t('ecommerce.settings.emailTemplates.editor.html')}
                onChange={(value) => {
                  setHtml(value);
                  setIssues((current) => ({ ...current, html: undefined }));
                }}
              />
            </div>
          </Pane>
          <Pane>
            <EmailPreview
              ref={previewFrame}
              fill={!!paneHeight}
              preview={preview}
              loading={previewLoading}
              error={previewError}
              textEditing={
                readOnly
                  ? undefined
                  : {
                      active: editTexts,
                      onChange: onPreviewText,
                      onEnd: endPreviewEdit,
                      onFocusText: revealInHtml,
                    }
              }
            />
          </Pane>
        </Columns>
      </Flex>
    );
  };


  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      {header}
      {body()}

      {testOpen && !readOnly && (
        <TestEmailModal
          type={type}
          locale={locale}
          defaultTo={userEmail}
          unsaved={dirty}
          onClose={() => setTestOpen(false)}
        />
      )}

      {variablesOpen && template && (
        <VariablesModal variables={template.variables} onClose={() => setVariablesOpen(false)} />
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
          variant: 'danger-light',
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
        open={blocker.state === 'blocked'}
        title={t('ecommerce.settings.emailTemplates.editor.discardConfirm.title')}
        text={t('ecommerce.settings.emailTemplates.editor.discardConfirm.text')}
        confirm={{
          variant: 'danger-light',
          button: t('ecommerce.settings.emailTemplates.editor.discardConfirm.confirm'),
          action: () => blocker.proceed?.(),
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => blocker.reset?.(),
        }}
      />
    </Flex>
  );
};

export { EmailTemplateEditorPage };
