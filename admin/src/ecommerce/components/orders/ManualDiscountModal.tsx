import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Button,
  Field,
  Flex,
  Modal,
  Radio,
  TextInput,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import AddManualDiscount from '../../usecases/orders/addManualDiscount';
import { formatCents } from '../../utils/money';
import { MAX_DISCOUNT_REASON, manualDiscountDraftToInput } from '../../utils/orderEditing';
import {
  apiErrorMessageId,
  type OrderActionPermissions,
  type ToolbarAction,
} from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, FieldError, Order } from '../../orderTypes';
import BalanceOutcome from './BalanceOutcome';

type Props = {
  order: Order;
  permissions: OrderActionPermissions;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
  onAction: (action: ToolbarAction) => void;
};

type Kind = 'FIXED' | 'PERCENT';
type ErrorKey = 'value' | 'reason' | 'form';

const errorMap = (errors: FieldError[]): Partial<Record<ErrorKey, string>> => {
  const map: Partial<Record<ErrorKey, string>> = {};
  errors.forEach(({ path, code }) => {
    const key: ErrorKey = path === 'value' || path === 'reason' ? path : 'form';
    if (!(key in map)) map[key] = code;
  });
  return map;
};

/**
 * Add a manual discount (spec 7.2): a fixed amount or a percentage of the products total, with a
 * required reason; then the balance when money is due or refundable. Mount it only while open:
 * each opening mints one operationId.
 */
const ManualDiscountModal = ({ order, permissions, onClose, onSaved, onAction }: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const [operationId] = useState(() => mintUuid());
  const [kind, setKind] = useState<Kind>('FIXED');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [saved, setSaved] = useState<EditResult | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const draft = manualDiscountDraftToInput({ kind, value, reason });
    if (!draft.input) {
      setErrors(errorMap(draft.errors));
      return;
    }
    setBusy(true);
    try {
      const result = await new AddManualDiscount().execute(order.id, {
        ...draft.input,
        operationId,
      });
      onSaved(result);
      if (result.outcome === 'NONE') {
        toggleNotification({ type: 'success', message: t('ecommerce.orders.discounts.saved') });
        onClose();
      } else {
        setSaved(result);
      }
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors?.length) {
        setErrors(errorMap(fieldErrors));
      } else {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.discounts.saveError')),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const body = () => {
    if (saved) {
      return (
        <BalanceOutcome
          order={saved.order}
          outcome={saved.outcome as 'DUE' | 'REFUNDABLE'}
          permissions={permissions}
          onAction={onAction}
        />
      );
    }
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Field.Root name="kind">
          <Field.Label>{t('ecommerce.orders.discounts.kindLabel')}</Field.Label>
          <Radio.Group
            value={kind}
            disabled={busy}
            aria-label={t('ecommerce.orders.discounts.kindLabel')}
            onValueChange={(next: string) => {
              setKind(next as Kind);
              setErrors({});
            }}
          >
            <Radio.Item value="FIXED">{t('ecommerce.orders.discounts.kind.FIXED')}</Radio.Item>
            <Radio.Item value="PERCENT">{t('ecommerce.orders.discounts.kind.PERCENT')}</Radio.Item>
          </Radio.Group>
        </Field.Root>
        <Field.Root
          name="value"
          required
          error={errors.value ? codeText(errors.value) : undefined}
          hint={
            kind === 'PERCENT'
              ? t('ecommerce.orders.discounts.percentHint', {
                  amount: formatCents(order.totals.subtotal, locale),
                })
              : undefined
          }
        >
          <Field.Label>{t('ecommerce.orders.discounts.value')}</Field.Label>
          <TextInput
            value={value}
            disabled={busy}
            inputMode="decimal"
            endAction={
              <Typography textColor="neutral600">{kind === 'PERCENT' ? '%' : '€'}</Typography>
            }
            onChange={(e: any) => {
              setValue(e.target.value);
              setErrors(({ value: _v, form: _f, ...rest }) => rest);
            }}
          />
          <Field.Hint />
          <Field.Error />
        </Field.Root>
        <Field.Root
          name="reason"
          required
          error={errors.reason ? codeText(errors.reason) : undefined}
          hint={`${reason.trim().length}/${MAX_DISCOUNT_REASON}`}
        >
          <Field.Label>{t('ecommerce.orders.discounts.reasonLabel')}</Field.Label>
          <Textarea
            value={reason}
            disabled={busy}
            maxLength={MAX_DISCOUNT_REASON}
            onChange={(e: any) => {
              setReason(e.target.value);
              setErrors(({ reason: _r, form: _f, ...rest }) => rest);
            }}
          />
          <Field.Hint />
          <Field.Error />
        </Field.Root>
        {errors.form && (
          <Typography variant="omega" textColor="danger600">
            {codeText(errors.form)}
          </Typography>
        )}
      </Flex>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.discounts.add')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.discounts.close')}
          </Button>
          {!saved && (
            <Button onClick={save} loading={busy}>
              {t('ecommerce.orders.discounts.save')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ManualDiscountModal;
