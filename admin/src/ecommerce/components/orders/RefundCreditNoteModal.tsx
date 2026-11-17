import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Flex, Loader, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchRefundCreditNoteOptions from '../../usecases/orders/fetchRefundCreditNoteOptions';
import IssueRefundCreditNote from '../../usecases/orders/issueRefundCreditNote';
import { formatCents } from '../../utils/money';
import { apiErrorDetail, apiErrorMessageId, shouldRenewIdempotencyKey } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import { invoiceFailureMessageId, isFailedReplay, isUncertainResult, issuedWarnings } from '../../utils/invoiceForm';
import {
  canIssueRefundCredit,
  refundCreditItems,
  refundCreditSummary,
  refundCreditMode,
  refundCreditModeAfterError,
  refundOptionValue,
  selectionFromItems,
  selectionKey,
  storedCreditItems,
  type RefundCreditSelection,
} from '../../utils/refundCreditNote';
import type { InvoiceView, RefundCreditLineOption, RefundCreditNoteOptions, RefundView } from '../../orderTypes';
import { ActionConfirmModal } from '../ActionConfirmModal';
import InvoiceErrorModal from './InvoiceErrorModal';
import EmptyNote from './EmptyNote';
import NoticeBar from './NoticeBar';
import RefundElementsTable from './RefundElementsTable';
import { Tile, Tiles } from './SummaryTiles';

type Props = {
  refund: RefundView;
  /** The order's documents: the invoice lines value the chosen units as the server does. */
  invoices: InvoiceView[];
  onClose: () => void;
  /** After a credit note was recorded (issued or uncertain): the order is fetched again. */
  onIssued: () => void;
};

/** STORED: the refund's own elements, fixed. FREE / UNAVAILABLE: any elements adding up to the refund. */
type Mode = ReturnType<typeof refundCreditMode>;

/**
 * The credit note of an INVOICED refund (plan 15). It starts from the refund's own elements: they
 * are fixed, and Issue sends exactly them (the server uses their stored values). When one of them
 * is no longer creditable (absent from the options, or the server answers
 * `REFUND_ELEMENTS_UNAVAILABLE`), or for a legacy refund without elements, the admin picks any
 * invoiced elements not yet credited (whole units of products, whole shipping lines) adding up
 * exactly to the refund amount. One credit note is issued, even across invoices. Mount it only
 * while open: each opening mints one idempotency key.
 */
const RefundCreditNoteModal = ({ refund, invoices, onClose, onIssued }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.orders.refunds.creditNote';
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const money = (cents: number) => formatCents(cents, uiLocale);

  const [idempotencyKey, setIdempotencyKey] = useState(() => mintUuid());
  const [options, setOptions] = useState<RefundCreditNoteOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<RefundCreditSelection>({});
  const [mode, setMode] = useState<Mode>('FREE');
  /** False once unmounted: a late answer must not set state. */
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );
  /** Per element key: the server's code for it. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [failure, setFailure] = useState<{ message: string; detail: string | null; refused: boolean } | null>(
    null
  );

  useEffect(() => {
    let alive = true;
    new FetchRefundCreditNoteOptions()
      .execute(refund.id)
      .then((o) => {
        if (!alive) return;
        setOptions(o);
        setMode(refundCreditMode(o));
        setSelection(selectionFromItems(o.selected));
      })
      .catch((err) => alive && setLoadError(t(apiErrorMessageId(err, `${p}.loadError`))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refund.id]);

  const lineOf = (invoiceId: number, index: number) => invoices.find((i) => i.id === invoiceId)?.lines[index];
  const locked = saving || uncertain;
  const stored = mode === 'STORED';
  /** STORED: the value kept with the refund; otherwise the server's rule. */
  const storedValue = (invoiceId: number, index: number): number =>
    options?.selected?.find((i) => i.invoiceId === invoiceId && i.index === index)?.value ?? 0;
  const valueOf = (invoiceId: number) => (option: RefundCreditLineOption, quantity: number) =>
    stored ? storedValue(invoiceId, option.index) : refundOptionValue(option, quantity, lineOf(invoiceId, option.index));

  const choose = (invoiceId: number, index: number, quantity: number) => {
    const key = selectionKey(invoiceId, index);
    setSelection((s) => ({ ...s, [key]: quantity }));
    setFormError(null);
    setErrors((map) => {
      if (!map[key]) return map;
      const next = { ...map };
      delete next[key];
      return next;
    });
  };

  /** Server field errors back on their element: `items.<j>.*` by request position. */
  const showServerErrors = (err: unknown, sent: { invoiceId: number; index: number }[]) => {
    const map: Record<string, string> = {};
    let other: string | null = null;
    for (const e of extractFieldErrors(err) ?? []) {
      const item = /^items\.(\d+)(\.|$)/.exec(e.path);
      const target = item ? sent[Number(item[1])] : undefined;
      if (target) map[selectionKey(target.invoiceId, target.index)] = e.code;
      else other = other ?? e.code;
    }
    setErrors(map);
    setFormError(other ? codeText(other) : Object.keys(map).length ? null : t(apiErrorMessageId(err, `${p}.error`)));
  };

  const submit = async () => {
    setConfirming(false);
    if (!options || saving || uncertain) return;
    if (!stored && !canIssueRefundCredit(options, selection, lineOf)) return;
    // STORED: exactly the refund's elements (their stored values); otherwise the selection.
    const items = stored ? storedCreditItems(options) : refundCreditItems(options, selection);
    setSaving(true);
    setFormError(null);
    try {
      const note = await new IssueRefundCreditNote().execute(refund.id, { items, idempotencyKey });
      if (isFailedReplay(note)) {
        const id = note.error ? invoiceFailureMessageId(note.error) : null;
        setFailure({ message: t(id ?? `${p}.error`), detail: note.errorDetail, refused: true });
        return;
      }
      if (isUncertainResult(note)) {
        setUncertain(true);
        return;
      }
      const warnings = issuedWarnings(note);
      toggleNotification(
        warnings.length
          ? {
              type: 'warning',
              message: t('ecommerce.orders.invoices.issue.warnings', {
                warnings: warnings.map((w) => t(`ecommerce.orders.invoices.warnings.${w}`)).join(' '),
              }),
            }
          : { type: 'success', message: t(`${p}.success`) }
      );
      onIssued();
    } catch (err) {
      // Only a 4xx allows a new key: on a 5xx or without an answer a retry must replay this request.
      if (shouldRenewIdempotencyKey(err)) setIdempotencyKey(mintUuid());
      const fieldErrors = extractFieldErrors(err) ?? [];
      const next = refundCreditModeAfterError(mode, fieldErrors);
      if (next !== mode) {
        // An element of the refund is no longer creditable: free selection, from fresh options.
        setMode(next);
        setErrors({});
        setFormError(null);
        new FetchRefundCreditNoteOptions()
          .execute(refund.id)
          .then((o) => {
            if (mounted.current) setOptions(o);
          })
          .catch((reloadErr) => {
            if (mounted.current) setLoadError(t(apiErrorMessageId(reloadErr, `${p}.loadError`)));
          });
      } else if (fieldErrors.length) {
        showServerErrors(err, items);
      } else {
        setFailure({
          message: t(apiErrorMessageId(err, `${p}.error`)),
          detail: apiErrorDetail(err),
          refused: shouldRenewIdempotencyKey(err),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving) return;
    if (uncertain || failure) onIssued();
    else onClose();
  };

  if (failure) {
    return (
      <InvoiceErrorModal {...failure} titleId="ecommerce.orders.invoices.creditNote.errorTitle" onClose={close} />
    );
  }

  const storedTotal = (options?.selected ?? []).reduce((sum, i) => sum + i.value, 0);
  const summary = !options
    ? null
    : stored
      ? { selected: storedTotal, refund: options.refund.amount, difference: options.refund.amount - storedTotal }
      : refundCreditSummary(options, selection, lineOf);
  const canIssue =
    !!options && !locked && (stored ? options.creditable : canIssueRefundCredit(options, selection, lineOf));

  const invoiceTable = (invoice: RefundCreditNoteOptions['invoices'][number]) => (
    <RefundElementsTable
      key={invoice.invoiceId}
      invoice={invoice}
      selection={selection}
      errors={errors}
      quantityLabel={t(`${p}.columns.quantity`)}
      valueOf={valueOf(invoice.invoiceId)}
      disabled={locked}
      readOnly={stored}
      selectedOnly={stored}
      onChoose={choose}
    />
  );

  const body = (o: RefundCreditNoteOptions) => {
    if (!o.creditable) {
      return <EmptyNote>{codeText(o.reason ?? 'REFUND_NOT_CREDITABLE')}</EmptyNote>;
    }
    if (!o.invoices.length) return <EmptyNote>{t(`${p}.nothing`)}</EmptyNote>;
    const figures = summary
      ? [
          { key: 'selected', amount: summary.selected },
          { key: 'refund', amount: summary.refund },
          { key: 'difference', amount: summary.difference, tone: summary.difference === 0 ? 'success' : 'warning' },
        ]
      : [];
    return (
      <>
        {mode === 'UNAVAILABLE' && <NoticeBar wrap text={t(`${p}.unavailableNotice`)} />}
        <Typography variant="omega" textColor="neutral700">
          {t(stored ? `${p}.storedNote` : `${p}.intro`)}
        </Typography>
        {o.invoices.map(invoiceTable)}
        <Tiles $columns={figures.length}>
          {figures.map((f) => (
            <Tile key={f.key} $tone={f.tone as 'success' | 'warning' | undefined} style={{ justifyContent: 'space-between' }}>
              <Typography variant="sigma" textColor="neutral600">
                {t(`${p}.totals.${f.key}`)}
              </Typography>
              <Typography variant="beta" tag="p" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                {money(f.amount)}
              </Typography>
            </Tile>
          ))}
        </Tiles>
        {summary && summary.difference !== 0 && (
          <Typography variant="pi" textColor="neutral600">
            {t(`${p}.issueHint`)}
          </Typography>
        )}
      </>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && close()}>
      <Modal.Content
        style={{ maxWidth: 1000, width: '100%' }}
        onPointerDownOutside={(e: Event) => {
          if (confirming || saving) e.preventDefault();
        }}
      >
        <Modal.Header>
          <Modal.Title>{t(`${p}.title`, { id: refund.id })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {loadError && <Typography textColor="danger600">{loadError}</Typography>}
            {!loadError && !options && (
              <Flex justifyContent="center" padding={6}>
                <Loader small />
              </Flex>
            )}
            {options && body(options)}
            {uncertain && (
              <Box padding={3} background="warning100" hasRadius>
                <Typography variant="omega" textColor="warning700">
                  {t('ecommerce.orders.invoices.creditNote.uncertain')}
                </Typography>
              </Box>
            )}
            {formError && (
              <Typography variant="omega" textColor="danger600">
                {formError}
              </Typography>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={close} disabled={saving}>
            {t(uncertain ? 'ecommerce.orders.invoices.close' : 'ecommerce.orders.invoices.back')}
          </Button>
          {!uncertain && (
            <Button variant="secondary" onClick={() => setConfirming(true)} loading={saving} disabled={!canIssue}>
              {t(`${p}.issue`)}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirming}
        title={t(`${p}.confirmTitle`)}
        text={t(`${p}.confirmText`, { amount: money(refund.amount) })}
        confirmLabel={t(`${p}.confirm`)}
        cancelLabel={t(`${p}.cancel`)}
        confirmVariant="default"
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </Modal.Root>
  );
};

export default RefundCreditNoteModal;
