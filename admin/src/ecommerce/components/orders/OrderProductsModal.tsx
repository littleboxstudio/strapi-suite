import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import PreviewOrderLines from '../../usecases/orders/previewOrderLines';
import ApplyOrderLines from '../../usecases/orders/applyOrderLines';
import { formatCents } from '../../utils/money';
import {
  addModifyLine,
  buildLinesInput,
  countLines,
  linesDraftChanged,
  linesDraftFromOrder,
  removeModifyLine,
  restoreModifyLine,
  setModifyLineQuantity,
  toModificationErrorMap,
  validateLinesDraft,
  type ModificationErrorMap,
} from '../../utils/modification';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, LinesPreview, Order } from '../../orderTypes';
import VariantPicker from './VariantPicker';
import ModifyLinesEditor from './ModifyLinesEditor';

type Props = {
  order: Order;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
};

type Step = 'edit' | 'review';

/**
 * Adds products to the order and changes or removes its lines: edit, then Review (preview), then
 * Save, which closes it (the balance and its payment actions are on the page). Mount it only while open: each opening
 * mints one operationId, so a retried save is applied once.
 */
const OrderProductsModal = ({ order, onClose, onSaved }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [operationId] = useState(() => mintUuid());
  const [lines, setLines] = useState(() => linesDraftFromOrder(order));
  const [step, setStep] = useState<Step>('edit');
  const [preview, setPreview] = useState<LinesPreview | null>(null);
  const [errors, setErrors] = useState<ModificationErrorMap>({});
  const [busy, setBusy] = useState(false);

  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const edit = (next: typeof lines) => {
    setLines(next);
    setErrors({});
  };

  const review = async () => {
    if (busy) return;
    const local = validateLinesDraft(lines);
    if (local.length) {
      setErrors(toModificationErrorMap(lines, local));
      return;
    }
    setBusy(true);
    try {
      const result = await new PreviewOrderLines().execute(order.id, buildLinesInput(lines));
      if (result.errors.length) {
        setErrors(toModificationErrorMap(lines, result.errors));
      } else {
        setPreview(result);
        setErrors({});
        setStep('review');
      }
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.products.previewError')),
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await new ApplyOrderLines().execute(order.id, { ...buildLinesInput(lines), operationId });
      onSaved(result);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.products.saved') });
      onClose();
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors?.length) {
        // The lines changed under us (stock, shipped units): back to the editor with the errors.
        setErrors(toModificationErrorMap(lines, fieldErrors));
        setStep('edit');
      } else {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.products.saveError')),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const money = (cents: number) => formatCents(cents, uiLocale);
  const counts = preview ? countLines(preview.lineChanges) : null;
  const rows: { label: string; before: string; after: string }[] =
    preview && counts
      ? [
          {
            label: t('ecommerce.orders.products.items'),
            before: String(counts.before.products),
            after: String(counts.after.products),
          },
          {
            label: t('ecommerce.orders.products.units'),
            before: String(counts.before.units),
            after: String(counts.after.units),
          },
          {
            label: t('ecommerce.orders.products.subtotal'),
            before: money(preview.before.subtotal),
            after: money(preview.after.subtotal),
          },
          {
            label: t('ecommerce.orders.products.total'),
            before: money(preview.before.total),
            after: money(preview.after.total),
          },
        ]
      : [];

  const formError = errors.form ?? errors.lines;

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.products.title', { reference: order.reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {step === 'edit' && (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <VariantPicker
                locale={order.locale}
                disabled={busy}
                onAdd={(variant) => edit(addModifyLine(lines, variant))}
              />
              <ModifyLinesEditor
                lines={lines}
                disabled={busy}
                errorFor={(key) => (errors[`line.${key}`] ? codeText(errors[`line.${key}`]) : undefined)}
                onQuantityChange={(key, quantity) => edit(setModifyLineQuantity(lines, key, quantity))}
                onRemove={(key) => edit(removeModifyLine(lines, key))}
                onRestore={(key) => edit(restoreModifyLine(lines, key))}
              />
              {formError && (
                <Typography variant="omega" textColor="danger600">
                  {codeText(formError)}
                </Typography>
              )}
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.products.note')}
              </Typography>
            </Flex>
          )}
          {step === 'review' && preview && (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Box
                tag="table"
                style={{ width: '100%', borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr>
                    <th />
                    <th style={{ textAlign: 'right' }}>
                      <Typography variant="sigma">{t('ecommerce.orders.products.before')}</Typography>
                    </th>
                    <th style={{ textAlign: 'right' }}>
                      <Typography variant="sigma">{t('ecommerce.orders.products.after')}</Typography>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <td style={{ padding: '4px 0' }}>
                        <Typography>{row.label}</Typography>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Typography textColor="neutral600">{row.before}</Typography>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Typography fontWeight="semiBold">{row.after}</Typography>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Box>
              <Typography variant="omega" textColor="neutral700">
                {t(`ecommerce.orders.products.outcome.${preview.outcome}`, {
                  amount: money(Math.abs(preview.difference)),
                })}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.products.note')}
              </Typography>
            </Flex>
          )}
        </Modal.Body>
        <Modal.Footer>
          {step === 'edit' && (
            <>
              <Button variant="tertiary" onClick={onClose} disabled={busy}>
                {t('ecommerce.orders.products.close')}
              </Button>
              <Button onClick={review} loading={busy} disabled={!linesDraftChanged(lines)}>
                {t('ecommerce.orders.products.review')}
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button variant="tertiary" onClick={() => setStep('edit')} disabled={busy}>
                {t('ecommerce.orders.products.back')}
              </Button>
              <Button onClick={save} loading={busy}>
                {t('ecommerce.orders.products.save')}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default OrderProductsModal;
