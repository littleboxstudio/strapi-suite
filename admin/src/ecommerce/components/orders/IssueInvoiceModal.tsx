import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchInvoicePreview from '../../usecases/orders/fetchInvoicePreview';
import IssueInvoice from '../../usecases/orders/issueInvoice';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { invoiceFailureMessageId, isFailedReplay, isUncertainResult, issuedWarnings } from '../../utils/invoiceForm';
import { mintUuid } from '../../utils/variantDraft';
import type { InvoicePreview, InvoiceScopeInput } from '../../orderTypes';

type Props = {
  orderId: number;
  /** One payment, or every payment with something left to invoice. */
  scope: InvoiceScopeInput;
  onClose: () => void;
  /** After a document was recorded (issued or uncertain): the order is fetched again. */
  onIssued: () => void;
};

const COLUMNS = ['name', 'quantity', 'total', 'tax'] as const;

/**
 * Previews and issues the invoice of one payment or of the whole order (design 4.4).
 * Mount it only while open: each opening mints a new idempotency key.
 */
const IssueInvoiceModal = ({ orderId, scope, onClose, onIssued }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  // One key per opening: after an attempt the modal can only be closed, so there is no second one.
  const [idempotencyKey] = useState(() => mintUuid());
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The provider did not answer: the outcome is unknown until the invoice is reconciled.
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    let alive = true;
    new FetchInvoicePreview()
      .execute(orderId, scope)
      .then((p) => alive && setPreview(p))
      .catch((err) => alive && setLoadError(t(apiErrorMessageId(err, 'ecommerce.orders.invoices.issue.previewError'))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, scope.scope, scope.scope === 'PAYMENT' ? scope.paymentId : null]);

  const failureText = (code: string | null) => {
    const id = code ? invoiceFailureMessageId(code) : null;
    return t(id ?? 'ecommerce.orders.invoices.issue.error');
  };

  const submit = async () => {
    if (saving || !preview) return;
    setSaving(true);
    setError(null);
    try {
      const invoice = await new IssueInvoice().execute(orderId, { ...scope, idempotencyKey });
      if (isFailedReplay(invoice)) {
        // The provider refused it: say why; the attempt is in the invoices list.
        setError(failureText(invoice.error));
        return;
      }
      if (isUncertainResult(invoice)) {
        setUncertain(true);
        return;
      }
      const warnings = issuedWarnings(invoice);
      toggleNotification(
        warnings.length
          ? {
              type: 'warning',
              message: t('ecommerce.orders.invoices.issue.warnings', {
                warnings: warnings.map((w) => t(`ecommerce.orders.invoices.warnings.${w}`)).join(' '),
              }),
            }
          : { type: 'success', message: t('ecommerce.orders.invoices.issue.success') }
      );
      onIssued();
    } catch (err) {
      // No retry from here: retrying blindly piles up failed attempts. The modal is closed and the
      // invoices list (refreshed on close) shows what was recorded, with the provider's message.
      setError(t(apiErrorMessageId(err, 'ecommerce.orders.invoices.issue.error')));
    } finally {
      setSaving(false);
    }
  };

  /** An attempt was made and did not end in an issued invoice: only Close remains. */
  const attempted = uncertain || error !== null;

  const close = () => {
    if (saving) return;
    // After an attempt the order is fetched again, so the list shows the recorded row.
    if (attempted) onIssued();
    else onClose();
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && close()}>
      <Modal.Content style={{ maxWidth: 820, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>
            {t(scope.scope === 'TOTAL' ? 'ecommerce.orders.invoices.issue.titleTotal' : 'ecommerce.orders.invoices.issue.title')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {loadError && <Typography textColor="danger600">{loadError}</Typography>}
            {!loadError && !preview && (
              <Flex justifyContent="center" padding={6}>
                <Loader small />
              </Flex>
            )}
            {preview && (
              <>
                <Table colCount={COLUMNS.length} rowCount={preview.lines.length + 1}>
                  <Thead>
                    <Tr>
                      {COLUMNS.map((c) => (
                        <Th key={c}>
                          <Typography variant="sigma">{t(`ecommerce.orders.invoices.lines.${c}`)}</Typography>
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {preview.lines.map((line, i) => (
                      <Tr key={i}>
                        <Td style={{ maxWidth: 320 }}>
                          <Flex gap={2} alignItems="center">
                            <Typography textColor="neutral800" ellipsis>
                              {line.kind === 'SHIPPING' ? t('ecommerce.orders.invoices.lines.shipping', { name: line.name }) : line.name}
                            </Typography>
                            {line.partial && (
                              <Badge size="S" variant="secondary">
                                {t('ecommerce.orders.invoices.lines.partial')}
                              </Badge>
                            )}
                          </Flex>
                          {line.sku && line.kind === 'ITEM' && (
                            <Typography variant="pi" textColor="neutral600">
                              {line.sku}
                            </Typography>
                          )}
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.quantity}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{money(line.total)}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.tax}%</Typography>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Flex justifyContent="flex-end" gap={2}>
                  <Typography fontWeight="bold">{t('ecommerce.orders.invoices.total')}</Typography>
                  <Typography fontWeight="bold">{money(preview.total)}</Typography>
                </Flex>
                {preview.lines.some((l) => l.partial) && (
                  <Typography variant="pi" textColor="neutral600">
                    {t('ecommerce.orders.invoices.lines.partialHint')}
                  </Typography>
                )}
              </>
            )}
            {uncertain && (
              <Box padding={3} background="warning100" hasRadius>
                <Typography variant="omega" textColor="warning700">
                  {t('ecommerce.orders.invoices.issue.uncertain')}
                </Typography>
              </Box>
            )}
            {error && (
              <Box padding={3} background="danger100" hasRadius role="alert">
                <Flex direction="column" alignItems="stretch" gap={1}>
                  <Typography variant="omega" fontWeight="bold" textColor="danger700">
                    {error}
                  </Typography>
                  <Typography variant="omega" textColor="danger700">
                    {t('ecommerce.orders.invoices.issue.errorNext')}
                  </Typography>
                </Flex>
              </Box>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={close} disabled={saving}>
            {t(attempted ? 'ecommerce.orders.invoices.close' : 'ecommerce.orders.invoices.back')}
          </Button>
          {!attempted && (
            <Button onClick={submit} loading={saving} disabled={!preview || saving}>
              {t('ecommerce.orders.invoices.issue.confirm')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default IssueInvoiceModal;
