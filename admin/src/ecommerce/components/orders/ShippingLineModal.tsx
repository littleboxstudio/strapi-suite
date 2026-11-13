import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Loader, Modal, Radio, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchShippingOptions from '../../usecases/orders/fetchShippingOptions';
import EditShippingLine from '../../usecases/orders/editShippingLine';
import AddShippingLine from '../../usecases/orders/addShippingLine';
import { formatAmountInput, formatCents } from '../../utils/money';
import {
  currentShippingMethod,
  defaultShippingOptionKey,
  shippingLineDraftToInput,
  shippingLineEditUnchanged,
  shippingLineErrorKey,
  shippingOptionKey,
} from '../../utils/orderEditing';
import { apiErrorMessageId, type OrderActionPermissions, type ToolbarAction } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, FieldError, Order, ShippingLineView, ShippingOption, ShippingQuote } from '../../orderTypes';
import BalanceOutcome from './BalanceOutcome';
import EmptyNote from './EmptyNote';

type Props = {
  order: Order;
  /** EDIT changes `line` (spec 6.2); ADD always creates a new line. */
  mode: 'EDIT' | 'ADD';
  line?: ShippingLineView;
  permissions: OrderActionPermissions;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
  onAction: (action: ToolbarAction) => void;
};

type ErrorKey = ReturnType<typeof shippingLineErrorKey>;

const errorMap = (errors: FieldError[]): Partial<Record<ErrorKey, string>> => {
  const map: Partial<Record<ErrorKey, string>> = {};
  errors.forEach(({ path, code }) => {
    const key = shippingLineErrorKey(path);
    if (!(key in map)) map[key] = code;
  });
  return map;
};

/**
 * Edit or add a shipping charge: the methods that serve the address and weight, each with its
 * suggested price, and an editable price; then the balance when money is due or refundable.
 * Mount it only while open: each opening mints one operationId.
 */
const ShippingLineModal = ({ order, mode, line, permissions, onClose, onSaved, onAction }: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const money = (cents: number) => formatCents(cents, locale);

  const [operationId] = useState(() => mintUuid());
  const [options, setOptions] = useState<ShippingOption[] | null>(null);
  const [failures, setFailures] = useState<ShippingQuote['failures']>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [saved, setSaved] = useState<EditResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    new FetchShippingOptions()
      .execute(order.id)
      .then(({ options: offered, failures: failed }) => {
        if (cancelled) return;
        const preferred = line
          ? { providerId: line.providerId, serviceId: line.serviceId }
          : currentShippingMethod(order.shippingLines);
        const key = defaultShippingOptionKey(offered, preferred, failed);
        setOptions(offered);
        setFailures(failed);
        setSelected(key);
        const option = offered.find((o) => shippingOptionKey(o) === key);
        if (option) setPrice(formatAmountInput(option.price, locale));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadFailed(true);
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.optionsError')),
        });
      });
    return () => {
      cancelled = true;
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const option = options?.find((o) => shippingOptionKey(o) === selected) ?? null;
  const draft = shippingLineDraftToInput(option, price);
  // Edit: nothing to save while the line would keep charging the same method and amount.
  const unchanged =
    mode === 'EDIT' && !!line && !!draft.input && shippingLineEditUnchanged(order.shippingLines, line, draft.input);

  const choose = (key: string) => {
    const next = options?.find((o) => shippingOptionKey(o) === key);
    setSelected(key);
    // A new method starts from its suggested price.
    if (next) setPrice(formatAmountInput(next.price, locale));
    setErrors({});
  };

  const save = async () => {
    if (busy || unchanged) return;
    if (!draft.input) {
      setErrors(errorMap(draft.errors));
      return;
    }
    setBusy(true);
    try {
      const body = { ...draft.input, operationId };
      const result =
        mode === 'EDIT' && line
          ? await new EditShippingLine().execute(order.id, line.id, body)
          : await new AddShippingLine().execute(order.id, body);
      onSaved(result);
      if (result.outcome === 'NONE') {
        toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.saved') });
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
          message: t(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.saveError')),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const title = t(mode === 'EDIT' ? 'ecommerce.orders.shippingCharges.editTitle' : 'ecommerce.orders.shippingCharges.add');

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
    if (loadFailed) {
      return (
        <Typography variant="omega" textColor="danger600">
          {t('ecommerce.orders.shippingCharges.optionsError')}
        </Typography>
      );
    }
    if (!options) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    const failureNote = failures.length > 0 && (
      <Box padding={3} background="warning100" borderColor="warning200" hasRadius>
        <Typography textColor="warning700" variant="pi">
          {t('ecommerce.orders.shipping.failures', {
            providers: failures.map((f) => f.providerId).join(', '),
          })}
        </Typography>
      </Box>
    );
    if (!options.length) {
      return failureNote || <EmptyNote>{t('ecommerce.orders.shippingCharges.noMethods')}</EmptyNote>;
    }
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {failureNote}
        <Field.Root name="method" error={errors.method ? codeText(errors.method) : undefined}>
          <Field.Label>{t('ecommerce.orders.shippingCharges.method')}</Field.Label>
          <Radio.Group
            value={selected ?? undefined}
            disabled={busy}
            aria-label={t('ecommerce.orders.shippingCharges.method')}
            onValueChange={choose}
          >
            {options.map((o) => (
              <Radio.Item key={shippingOptionKey(o)} value={shippingOptionKey(o)}>
                {o.name} · {money(o.price)}
              </Radio.Item>
            ))}
          </Radio.Group>
          <Field.Error />
        </Field.Root>
        <Field.Root
          name="amount"
          error={errors.amount ? codeText(errors.amount) : undefined}
          hint={option ? t('ecommerce.orders.shippingCharges.suggested', { amount: money(option.price) }) : undefined}
        >
          <Field.Label>{t('ecommerce.orders.shippingCharges.price')}</Field.Label>
          <TextInput
            value={price}
            disabled={busy}
            inputMode="decimal"
            onChange={(e: any) => {
              setPrice(e.target.value);
              setErrors({});
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
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.shippingCharges.close')}
          </Button>
          {!saved && (
            <Button onClick={save} loading={busy} disabled={!option || unchanged}>
              {t('ecommerce.orders.shippingCharges.save')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ShippingLineModal;
