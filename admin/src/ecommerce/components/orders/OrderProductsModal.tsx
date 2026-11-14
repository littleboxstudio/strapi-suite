import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Dialog, Flex, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import PreviewOrderLines from '../../usecases/orders/previewOrderLines';
import ApplyOrderLines from '../../usecases/orders/applyOrderLines';
import { formatCents } from '../../utils/money';
import {
  addModifyLine,
  buildLinesInput,
  linesDraftChanged,
  linesDraftFromOrder,
  removeModifyLine,
  restoreModifyLine,
  setModifyLineDiscount,
  setModifyLineQuantity,
  toModificationErrorMap,
  validateLinesDraft,
  type ModificationErrorMap,
} from '../../utils/modification';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { balanceAfter } from '../../utils/orderEditing';
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


/**
 * Adds products to the order and changes or removes its lines: edit, then Save, which previews
 * the change and asks to confirm it with what the customer will still owe (or be refunded) in total; confirming
 * saves and closes it (the balance and its payment actions are on the page). Mount it only while open: each opening
 * mints one operationId, so a retried save is applied once.
 */
const OrderProductsModal = ({ order, onClose, onSaved }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [operationId] = useState(() => mintUuid());
  const [lines, setLines] = useState(() => linesDraftFromOrder(order, uiLocale));
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
        setPreview(null);
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
  /** What the customer will owe (or be owed) in total once the change is saved. */
  const after = preview ? balanceAfter(preview.after) : null;

  const formError = errors.form ?? errors.lines;

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.products.title', { reference: order.reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
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
              discountErrorFor={(key) =>
                errors[`discount.${key}`] ? codeText(errors[`discount.${key}`]) : undefined
              }
              onQuantityChange={(key, quantity) => edit(setModifyLineQuantity(lines, key, quantity))}
              onDiscountChange={(key, discount) => edit(setModifyLineDiscount(lines, key, discount))}
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
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.products.close')}
          </Button>
          <Button onClick={review} loading={busy && !preview} disabled={!linesDraftChanged(lines)}>
            {t('ecommerce.orders.products.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      {preview && after && (
        // A short confirmation with what the customer will have to pay (or get back).
        <Dialog.Root open onOpenChange={(next: boolean) => !next && !busy && setPreview(null)}>
          <Dialog.Content>
            <Dialog.Header>{t('ecommerce.orders.products.confirm.title')}</Dialog.Header>
            <Dialog.Body>
              <Typography
                variant="omega"
                textColor={after.outcome === 'DUE' ? 'warning600' : 'neutral800'}
                fontWeight={after.outcome === 'NONE' ? undefined : 'semiBold'}
                style={{ textAlign: 'center' }}
              >
                {t(`ecommerce.orders.edit.balance.${after.outcome}`, { amount: money(after.amount) })}
              </Typography>
            </Dialog.Body>
            <Dialog.Footer>
              <Flex style={{ width: '100%' }} gap={2}>
                <Button fullWidth variant="tertiary" disabled={busy} onClick={() => setPreview(null)}>
                  {t('ecommerce.orders.products.confirm.cancel')}
                </Button>
                <Button fullWidth loading={busy} onClick={save}>
                  {t('ecommerce.orders.products.save')}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </Modal.Root>
  );
};

export default OrderProductsModal;
