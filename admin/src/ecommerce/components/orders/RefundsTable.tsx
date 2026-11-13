import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import ConfirmModal from '../../../components/ConfirmModal';
import FetchRefunds from '../../usecases/orders/fetchRefunds';
import ResumeRefund from '../../usecases/orders/resumeRefund';
import RefreshRefund from '../../usecases/orders/refreshRefund';
import MarkRefundFailed from '../../usecases/orders/markRefundFailed';
import { formatCents } from '../../utils/money';
import { actorLabel, apiErrorMessageId } from '../../utils/orderDetail';
import { MAX_LONG_TEXT, isRefreshableStripeRefund, isStuckStripeRefund } from '../../utils/refundForm';
import type { OrderRefund, RefundView } from '../../orderTypes';
import ColumnLabel from '../ColumnLabel';

type Props = {
  orderId: number;
  /** The order's refund summaries: they carry the failure reason. */
  summaries: OrderRefund[];
  /** Changes whenever the order was reloaded: the list is fetched again. */
  refreshKey: number;
  /** `refunds.manage`: resume / mark as failed / refresh status. */
  canRefund: boolean;
  /** After resume / mark as failed (the order changed). */
  onChanged: () => void;
};

const COLUMNS = ['reference', 'method', 'amount', 'date', 'status', 'externalId', 'actions'] as const;

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'neutral' | 'danger' | 'secondary'> = {
  PENDING: 'warning',
  PROCESSING: 'secondary',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

/** The order's refunds (requirement 15.11), with resume / mark-as-failed for stuck Stripe refunds. */
const RefundsTable = ({ orderId, summaries, refreshKey, canRefund, onChanged }: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const date = (iso: string | null) =>
    iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const [refunds, setRefunds] = useState<RefundView[] | null>(null);
  const [error, setError] = useState(false);
  const [viewing, setViewing] = useState<RefundView | null>(null);
  const [resuming, setResuming] = useState<RefundView | null>(null);
  const [marking, setMarking] = useState<RefundView | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    new FetchRefunds()
      .execute(orderId)
      .then((list) => {
        if (current !== request.current) return;
        setRefunds([...list].sort((a, b) => b.id - a.id));
        setError(false);
      })
      .catch(() => {
        if (current === request.current) setError(true);
      });
  }, [orderId, refreshKey]);

  const failureOf = (id: number): string | null => summaries.find((s) => s.id === id)?.failureReason ?? null;
  const failureText = (reason: string) =>
    t('ecommerce.orders.refunds.failure', {
      reason: t(`ecommerce.orders.refunds.failureReasons.${reason}`, undefined, reason),
    });

  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toggleNotification({ type: 'success', message: t(success) });
    } catch (err) {
      toggleNotification({ type: 'danger', message: t(apiErrorMessageId(err, fallback)) });
    } finally {
      setBusy(false);
      setResuming(null);
      setMarking(null);
      onChanged();
    }
  };

  const resume = (r: RefundView) =>
    run(
      () => new ResumeRefund().execute(r.id),
      'ecommerce.orders.refunds.stuck.resumed',
      'ecommerce.orders.refunds.stuck.resumeError'
    );

  const refreshStatus = (r: RefundView) =>
    run(
      () => new RefreshRefund().execute(r.id),
      'ecommerce.orders.refunds.refreshed',
      'ecommerce.orders.refunds.refreshError'
    );

  const markFailed = (r: RefundView) =>
    run(
      () => new MarkRefundFailed().execute(r.id, note.trim() || undefined),
      'ecommerce.orders.refunds.stuck.marked',
      'ecommerce.orders.refunds.stuck.markError'
    );

  if (error && !refunds) {
    return <Typography textColor="danger600">{t('ecommerce.orders.refunds.loadError')}</Typography>;
  }
  if (!refunds) {
    return (
      <Flex justifyContent="center" padding={4}>
        <Loader small />
      </Flex>
    );
  }
  if (!refunds.length) {
    return (
      <Box padding={4} background="neutral100" hasRadius>
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.orders.refunds.empty')}
        </Typography>
      </Box>
    );
  }

  const detailRows = (r: RefundView): [string, string][] => {
    const rows: [string, string][] = [
      [t('ecommerce.orders.refunds.columns.method'), t(`ecommerce.orders.refund.methods.${r.method}`, undefined, r.method)],
      [t('ecommerce.orders.refunds.columns.amount'), money(r.amount)],
      [
        t('ecommerce.orders.refunds.columns.status'),
        t(`ecommerce.orders.refunds.statuses.${r.status}`, undefined, r.status),
      ],
      [
        t('ecommerce.orders.refunds.details.reason'),
        r.reason ? t(`ecommerce.orders.refund.reasons.${r.reason}`, undefined, r.reason) : '—',
      ],
      [t('ecommerce.orders.refunds.details.description'), r.description || '—'],
      [t('ecommerce.orders.refunds.details.actor'), actorLabel(r.actor, (id, values) => t(id, values))],
    ];
    if (r.payment) {
      const method = t(`ecommerce.orders.detail.payments.methods.${r.payment.method}`, undefined, r.payment.method);
      const ref = r.payment.reference || r.payment.externalId;
      rows.push([
        t('ecommerce.orders.refunds.details.payment'),
        `${method} · ${money(r.payment.amount)}${ref ? ` · ${ref}` : ''}`,
      ]);
    }
    if (r.storeCredit) {
      rows.push([
        t('ecommerce.orders.refunds.details.storeCredit'),
        t('ecommerce.orders.refunds.details.storeCreditValue', { id: r.storeCredit.id }),
      ]);
    }
    if (r.reference) rows.push([t('ecommerce.orders.refunds.details.reference'), r.reference]);
    if (r.externalId) rows.push([t('ecommerce.orders.refunds.details.externalId'), r.externalId]);
    rows.push([t('ecommerce.orders.refunds.details.createdAt'), date(r.createdAt)]);
    if (r.completedAt) rows.push([t('ecommerce.orders.refunds.details.completedAt'), date(r.completedAt)]);
    const failure = r.status === 'FAILED' ? failureOf(r.id) : null;
    if (failure) {
      rows.push([
        t('ecommerce.orders.refunds.details.failure'),
        t(`ecommerce.orders.refunds.failureReasons.${failure}`, undefined, failure),
      ]);
    }
    return rows;
  };

  return (
    <>
      <Table colCount={COLUMNS.length} rowCount={refunds.length + 1}>
        <Thead>
          <Tr>
            {COLUMNS.map((column) => (
              <Th key={column}>
                <ColumnLabel column={column}>{t(`ecommerce.orders.refunds.columns.${column}`)}</ColumnLabel>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {refunds.map((r) => {
            const stuck = isStuckStripeRefund(r);
            const refreshable = isRefreshableStripeRefund(r);
            const failure = r.status === 'FAILED' ? failureOf(r.id) : null;
            return (
              <Tr key={r.id}>
                <Td>
                  <Typography textColor="neutral800" fontWeight="semiBold">
                    #{r.id}
                  </Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">
                    {t(`ecommerce.orders.refund.methods.${r.method}`, undefined, r.method)}
                  </Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{money(r.amount)}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{date(r.completedAt ?? r.createdAt)}</Typography>
                </Td>
                <Td>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'} size="S">
                      {t(`ecommerce.orders.refunds.statuses.${r.status}`, undefined, r.status)}
                    </Badge>
                    {failure && (
                      <Typography variant="pi" textColor="danger600">
                        {failureText(failure)}
                      </Typography>
                    )}
                    {stuck && (
                      <Typography variant="pi" textColor="warning600">
                        {t('ecommerce.orders.refunds.stuck.hint')}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td style={{ maxWidth: 200 }}>
                  <Typography textColor="neutral800" ellipsis>
                    {r.externalId || r.reference || '—'}
                  </Typography>
                </Td>
                <Td>
                  <Flex gap={1} justifyContent="flex-end" wrap="wrap">
                    {stuck && canRefund && (
                      <>
                        <Button size="S" variant="secondary" disabled={busy} onClick={() => setResuming(r)}>
                          {t('ecommerce.orders.refunds.resume')}
                        </Button>
                        <Button
                          size="S"
                          variant="danger-light"
                          disabled={busy}
                          onClick={() => {
                            setNote('');
                            setMarking(r);
                          }}
                        >
                          {t('ecommerce.orders.refunds.markFailed')}
                        </Button>
                      </>
                    )}
                    {refreshable && canRefund && (
                      <Button size="S" variant="secondary" disabled={busy} onClick={() => refreshStatus(r)}>
                        {t('ecommerce.orders.refunds.refresh')}
                      </Button>
                    )}
                    <Button size="S" variant="tertiary" onClick={() => setViewing(r)}>
                      {t('ecommerce.orders.refunds.view')}
                    </Button>
                  </Flex>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>

      {viewing && (
        <Modal.Root open onOpenChange={(next: boolean) => !next && setViewing(null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>{t('ecommerce.orders.refunds.details.title', { id: viewing.id })}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Flex direction="column" alignItems="stretch" gap={3}>
                {detailRows(viewing).map(([label, value]) => (
                  <Flex key={label} justifyContent="space-between" alignItems="flex-start" gap={4}>
                    <Typography textColor="neutral600">{label}</Typography>
                    <Typography
                      textColor="neutral800"
                      style={{ textAlign: 'right', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    >
                      {value}
                    </Typography>
                  </Flex>
                ))}
              </Flex>
            </Modal.Body>
            <Modal.Footer>
              <span />
              <Button onClick={() => setViewing(null)}>{t('ecommerce.orders.refunds.details.close')}</Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}

      <ConfirmModal
        key={`resume-${resuming?.id ?? 0}`}
        open={canRefund && !!resuming}
        title={t('ecommerce.orders.refunds.stuck.resumeTitle')}
        text={t('ecommerce.orders.refunds.stuck.warning')}
        confirm={{
          button: t('ecommerce.orders.refunds.stuck.resumeConfirm'),
          action: () => {
            const target = resuming;
            setResuming(null);
            if (target) resume(target);
          },
        }}
        cancel={{ button: t('ecommerce.orders.refunds.stuck.cancel'), action: () => setResuming(null) }}
      />

      {canRefund && marking && (
        <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && setMarking(null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>{t('ecommerce.orders.refunds.stuck.markTitle')}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Box padding={3} background="danger100" hasRadius>
                  <Typography variant="omega" textColor="danger700">
                    {t('ecommerce.orders.refunds.stuck.warning')}
                  </Typography>
                </Box>
                <Typography variant="omega" textColor="neutral800">
                  {t('ecommerce.orders.refunds.stuck.markText')}
                </Typography>
                {summaryLine(t, money, marking)}
                <Field.Root
                  name="note"
                  error={note.trim().length > MAX_LONG_TEXT ? t('ecommerce.orders.errors.too_long') : undefined}
                >
                  <Field.Label>{t('ecommerce.orders.refunds.stuck.note')}</Field.Label>
                  <Textarea value={note} onChange={(e: any) => setNote(e.target.value)} />
                  <Field.Error />
                </Field.Root>
              </Flex>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onClick={() => setMarking(null)} disabled={busy}>
                {t('ecommerce.orders.refunds.stuck.cancel')}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={note.trim().length > MAX_LONG_TEXT}
                onClick={() => markFailed(marking)}
              >
                {t('ecommerce.orders.refunds.stuck.markConfirm')}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </>
  );
};

/** "#12 · €10.00" — which refund the dialog is about. */
const summaryLine = (
  t: (id: string, values?: Record<string, any>, defaultMessage?: string) => string,
  money: (cents: number) => string,
  r: RefundView
) => (
  <Typography variant="pi" textColor="neutral600">
    #{r.id} · {t(`ecommerce.orders.refund.methods.${r.method}`, undefined, r.method)} · {money(r.amount)}
  </Typography>
);

export default RefundsTable;
