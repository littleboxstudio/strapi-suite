import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Box, Button, Flex, Loader, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { EmailPreview as EmailPreviewData } from '../../settingsTypes';
import { TEXT_ATTRIBUTE, VARIABLE_ATTRIBUTE } from '../../utils/emailTextEditing';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from '../orders/NoticeBar';

/** Editing the template's texts in the preview (its html carries the marked spans). */
type TextEditing = {
  active: boolean;
  onToggle: () => void;
  /** A text typed in the preview: its id and its plain text. */
  onChange: (id: number, text: string) => void;
  /** The caret left the texts: the preview may be refreshed. */
  onEnd: () => void;
};

type Props = {
  preview: EmailPreviewData | null;
  loading: boolean;
  error: boolean;
  /** Absent: the preview is read only (no Edit texts). */
  textEditing?: TextEditing;
};

/** Marks for the editable preview only; the e-mail itself never has them. */
const EDITING_STYLE = `
[${TEXT_ATTRIBUTE}] { outline: 1px dashed rgba(73, 69, 255, 0.45); outline-offset: 1px; cursor: text; border-radius: 2px; }
[${TEXT_ATTRIBUTE}]:hover { outline: 1px solid #4945ff; }
[${TEXT_ATTRIBUTE}]:focus { outline: 2px solid #4945ff; background: rgba(73, 69, 255, 0.06); }
[${VARIABLE_ATTRIBUTE}] { background: #fdf0d5; border-radius: 2px; cursor: not-allowed; }
`;

/**
 * Makes the preview's marked texts editable: typing updates every copy of the text (a text in a
 * list repeats per row) and reports it; Enter and links do nothing; leaving the texts ends the
 * edit. Scripts never run: the frame only gets same-origin access, no allow-scripts.
 */
function enableTextEditing(doc: Document, editing: TextEditing, editable: boolean) {
  const style = doc.createElement('style');
  style.textContent = EDITING_STYLE;
  doc.head?.appendChild(style);
  doc.querySelectorAll<HTMLElement>(`[${TEXT_ATTRIBUTE}]`).forEach((el) => {
    try {
      el.contentEditable = editable ? 'plaintext-only' : 'false';
    } catch {
      // Browsers without plaintext-only.
      el.contentEditable = editable ? 'true' : 'false';
    }
    el.spellcheck = false;
  });
  doc.addEventListener('input', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.(`[${TEXT_ATTRIBUTE}]`) as HTMLElement | null;
    if (!el) return;
    const id = el.getAttribute(TEXT_ATTRIBUTE)!;
    const text = (el.textContent ?? '').replace(/\n/g, ' ');
    doc.querySelectorAll<HTMLElement>(`[${TEXT_ATTRIBUTE}="${id}"]`).forEach((copy) => {
      if (copy !== el) copy.textContent = text;
    });
    editing.onChange(Number(id), text);
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  // In a link, a click places the caret instead of following it.
  doc.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('a')) e.preventDefault();
  });
  // Moving from one text to another keeps the edit going; leaving the texts ends it.
  doc.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!(doc.activeElement as HTMLElement | null)?.closest?.(`[${TEXT_ATTRIBUTE}]`)) editing.onEnd();
    }, 0);
  });
}

const Frame = styled.iframe`
  display: block;
  width: 100%;
  min-height: 480px;
  height: 100%;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  /* E-mails are designed on white; keep it in the dark admin theme too. */
  background: #ffffff;
`;

/**
 * The rendered e-mail in a sandboxed iframe (no scripts). With Edit texts on, its fixed texts are
 * typed in place (the frame then gets same-origin access, still without scripts).
 */
const EmailPreview = ({ preview, loading, error, textEditing }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const editing = !!textEditing?.active;
  const frame = useRef<HTMLIFrameElement>(null);
  // The latest callbacks, for the listeners added when the frame loads.
  const latest = useRef(textEditing);
  latest.current = textEditing;
  // Texts cannot be typed while a newer preview is on its way (its texts may differ).
  const editable = editing && !loading;

  const onFrameLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc || !editing) return;
    enableTextEditing(
      doc,
      {
        active: true,
        onToggle: () => latest.current?.onToggle(),
        onChange: (id, text) => latest.current?.onChange(id, text),
        onEnd: () => latest.current?.onEnd(),
      },
      editable
    );
  };

  // Loading starts or ends while the frame stays: follow it on the texts.
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || !editing) return;
    doc.querySelectorAll<HTMLElement>(`[${TEXT_ATTRIBUTE}]`).forEach((el) => {
      if (editable && el.contentEditable === 'false') {
        try {
          el.contentEditable = 'plaintext-only';
        } catch {
          el.contentEditable = 'true';
        }
      } else if (!editable && el.contentEditable !== 'false' && doc.activeElement !== el) {
        el.contentEditable = 'false';
      }
    });
  }, [editable, editing]);

  return (
    <Flex direction="column" alignItems="stretch" gap={3} style={{ height: '100%' }}>
      <Flex justifyContent="space-between" alignItems="center" gap={2}>
        <Typography variant="omega" textColor="neutral800">
          {t('ecommerce.settings.emailTemplates.preview.title')}
        </Typography>
        <Flex gap={2} alignItems="center">
          {loading && <Loader small />}
          {textEditing && (
            <Button size="S" variant={editing ? 'default' : 'secondary'} onClick={textEditing.onToggle}>
              {t(
                editing
                  ? 'ecommerce.settings.emailTemplates.preview.editTextsDone'
                  : 'ecommerce.settings.emailTemplates.preview.editTexts'
              )}
            </Button>
          )}
        </Flex>
      </Flex>

      {editing && (
        <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
          <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
            {t('ecommerce.settings.emailTemplates.preview.editTextsHint')}
          </Typography>
        </Box>
      )}

      {error && (
        <Typography variant="omega" textColor="danger600">
          {t('ecommerce.settings.emailTemplates.preview.error')}
        </Typography>
      )}

      {preview && preview.issues.length > 0 && (
        <Box
          background="warning100"
          borderColor="warning200"
          hasRadius
          padding={3}
          role="status"
        >
          <Flex direction="column" alignItems="stretch" gap={1}>
            <Typography variant="omega" fontWeight="semiBold" textColor="warning700">
              {t('ecommerce.settings.emailTemplates.preview.issues')}
            </Typography>
            {preview.issues.map((issue, i) => (
              <Typography key={`${issue.code}-${i}`} variant="pi" textColor="warning700">
                {`${t(`ecommerce.settings.emailTemplates.issues.${issue.code}`)}: ${issue.detail}`}
              </Typography>
            ))}
          </Flex>
        </Box>
      )}

      {preview && (
        <Box>
          <Typography variant="omega" textColor="neutral800">
            {t('ecommerce.settings.emailTemplates.preview.subject')}
          </Typography>{' '}
          <Typography variant="omega" fontWeight="semiBold">
            {preview.subject}
          </Typography>
        </Box>
      )}

      <Frame
        ref={frame}
        // Same-origin only while editing, so the texts can be typed; scripts never run.
        sandbox={editing ? 'allow-same-origin' : ''}
        srcDoc={preview?.html ?? ''}
        onLoad={onFrameLoad}
        title={t('ecommerce.settings.emailTemplates.preview.frameTitle')}
      />
    </Flex>
  );
};

export { EmailPreview };
