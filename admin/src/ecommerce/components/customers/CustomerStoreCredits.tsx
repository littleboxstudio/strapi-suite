import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Duplicate, Plus } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import ConfirmModal from '../../../components/ConfirmModal';
import FetchCustomerStoreCredits from '../../usecases/orders/fetchCustomerStoreCredits';
import IssueStoreCredit from '../../usecases/orders/issueStoreCredit';
import VoidStoreCredit from '../../usecases/orders/voidStoreCredit';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  emptyStoreCreditForm,
  storeCreditDisplayStatus,
  validateStoreCreditForm,
  type StoreCreditDisplayStatus,
  type StoreCreditForm,
} from '../../utils/refundForm';
import type { FieldError, StoreCredit } from '../../orderTypes';

type Props = {
  customerId: number;
  /** The customer's e-mail: a credit is valid only for it. */
  email: string;
  /** `refunds.manage`: issue and void. */
  canManage: boolean;
};

const COLUMNS = ['code', 'balance', 'expiresAt', 'status', 'actions'] as const;

const STATUS_VARIANT: Record<StoreCreditDisplayStatus, 'success' | 'neutral' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  USED: 'neutral',
  EXPIRED: 'warning',
  VOID: 'danger',
};

type FormErrors = Partial<Record<keyof StoreCreditForm | 'form', string>>;

/** Issues a store credit for the customer. Mount only while open: one idempotency key per opening. */
const IssueStoreCreditModal = ({
  customerId,
  email,
  onClose,
  onIssued,
}: {
  customerId: number;
  email: string;
  onClose: () => void;
  onIssued: (credit: StoreCredit) => void;
}) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [idempotencyKey] = useState(() => mintUuid());
  const [form, setForm] = useState<StoreCreditForm>(() => emptyStoreCreditForm());
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const errorText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const toMap = (list: FieldError[]): FormErrors => {
    const map: FormErrors = {};
    list.forEach((e) => {
      const key = e.path === 'amount' || e.path === 'expiresAt' || e.path === 'conditions' ? e.path : 'form';
      if (!map[key]) map[key] = errorText(e.code);
    });
    return map;
  };

  const update = (field: keyof StoreCreditForm, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  const submit = async () => {
    if (saving) return;
    const result = validateStoreCreditForm(form);
    if (!result.input) {
      setErrors(toMap(result.errors));
      return;
    }
    setSaving(true);
    try {
      const credit = await new IssueStoreCredit().execute({ customerId, ...result.input, idempotencyKey });
      toggleNotification({
        type: 'success',
        message: t('ecommerce.customers.storeCredits.issued', { code: credit.code }),
      });
      onIssued(credit);
    } catch (err) {
      const map = toMap(extractFieldErrors(err) ?? []);
      setErrors(map);
      if (!map.amount && !map.expiresAt && !map.conditions) {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.customers.storeCredits.issueError')),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.customers.storeCredits.modal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.customers.storeCredits.modal.hint', { email })}
            </Typography>
            <Field.Root name="amount" required error={errors.amount}>
              <Field.Label>{t('ecommerce.customers.storeCredits.modal.amount')}</Field.Label>
              <TextInput
                value={form.amount}
                inputMode="decimal"
                endAction={<span>€</span>}
                onChange={(e: any) => update('amount', e.target.value)}
              />
              <Field.Error />
            </Field.Root>
            <Field.Root name="expiresAt" required error={errors.expiresAt}>
              <Field.Label>{t('ecommerce.customers.storeCredits.modal.expiresAt')}</Field.Label>
              <TextInput type="date" value={form.expiresAt} onChange={(e: any) => update('expiresAt', e.target.value)} />
              <Field.Error />
            </Field.Root>
            <Field.Root name="conditions" error={errors.conditions}>
              <Field.Label>{t('ecommerce.customers.storeCredits.modal.conditions')}</Field.Label>
              <Textarea value={form.conditions} onChange={(e: any) => update('conditions', e.target.value)} />
              <Field.Error />
            </Field.Root>
            {errors.form && <Typography textColor="danger600">{errors.form}</Typography>}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.customers.storeCredits.modal.cancel')}
          </Button>
          <Button onClick={submit} loading={saving}>
            {t('ecommerce.customers.storeCredits.modal.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/**
 * The customer's store credits (design 4.7): full code (customers.read), balance, validity and
 * status; "Issue store credit" and "Void" with `refunds.manage`.
 */
const CustomerStoreCredits = ({ customerId, email, canManage }: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  const [credits, setCredits] = useState<StoreCredit[] | null>(null);
  const [error, setError] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [voiding, setVoiding] = useState<StoreCredit | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const list = await new FetchCustomerStoreCredits().execute(customerId);
      if (current !== request.current) return;
      setCredits(list);
      setError(false);
    } catch {
      if (current === request.current) setError(true);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toggleNotification({ type: 'success', message: t('ecommerce.customers.storeCredits.copied') });
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.customers.storeCredits.copyError') });
    }
  };

  const voidCredit = async (credit: StoreCredit) => {
    if (busy) return;
    setVoiding(null);
    setBusy(true);
    try {
      await new VoidStoreCredit().execute(credit.id);
      toggleNotification({ type: 'success', message: t('ecommerce.customers.storeCredits.voided') });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.customers.storeCredits.voidError')),
      });
    } finally {
      setBusy(false);
      load();
    }
  };

  const content = () => {
    if (error && !credits) {
      return <Typography textColor="danger600">{t('ecommerce.customers.storeCredits.loadError')}</Typography>;
    }
    if (!credits) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    if (!credits.length) {
      return (
        <Box padding={4} background="neutral100" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.customers.storeCredits.empty')}
          </Typography>
        </Box>
      );
    }
    return (
      <Table colCount={COLUMNS.length} rowCount={credits.length + 1}>
        <Thead>
          <Tr>
            {COLUMNS.map((column) => (
              <Th key={column}>
                <Typography variant="sigma">{t(`ecommerce.customers.storeCredits.columns.${column}`)}</Typography>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {credits.map((credit) => {
            const status = storeCreditDisplayStatus(credit);
            return (
              <Tr key={credit.id}>
                <Td>
                  <Flex gap={1} alignItems="center">
                    <Typography textColor="neutral800" fontWeight="semiBold" style={{ fontFamily: 'monospace' }}>
                      {credit.code}
                    </Typography>
                    <IconButton
                      label={t('ecommerce.customers.storeCredits.copy')}
                      variant="ghost"
                      size="S"
                      onClick={() => copy(credit.code)}
                    >
                      <Duplicate />
                    </IconButton>
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral800">
                    {t('ecommerce.customers.storeCredits.balanceOf', {
                      balance: money(credit.balance),
                      initial: money(credit.initialAmount),
                    })}
                  </Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">
                    {credit.expiresAt
                      ? formatDate(credit.expiresAt, { dateStyle: 'medium' })
                      : t('ecommerce.customers.storeCredits.noExpiry')}
                  </Typography>
                </Td>
                <Td>
                  <Badge variant={STATUS_VARIANT[status]} size="S">
                    {t(`ecommerce.customers.storeCredits.statuses.${status}`)}
                  </Badge>
                </Td>
                <Td>
                  {canManage && credit.status === 'ACTIVE' && (
                    <Flex justifyContent="flex-end">
                      <Button size="S" variant="danger-light" disabled={busy} onClick={() => setVoiding(credit)}>
                        {t('ecommerce.customers.storeCredits.void')}
                      </Button>
                    </Flex>
                  )}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    );
  };

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Flex justifyContent="space-between" alignItems="center" gap={4}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.customers.storeCredits.title')}
          </Typography>
          {canManage && (
            <Button size="S" startIcon={<Plus />} onClick={() => setIssuing(true)}>
              {t('ecommerce.customers.storeCredits.issue')}
            </Button>
          )}
        </Flex>
        {content()}
      </Flex>

      {canManage && issuing && (
        <IssueStoreCreditModal
          customerId={customerId}
          email={email}
          onClose={() => setIssuing(false)}
          onIssued={() => {
            setIssuing(false);
            load();
          }}
        />
      )}

      <ConfirmModal
        key={`void-${voiding?.id ?? 0}`}
        open={canManage && !!voiding}
        title={t('ecommerce.customers.storeCredits.voidTitle', { code: voiding?.code ?? '' })}
        text={t('ecommerce.customers.storeCredits.voidText', { balance: money(voiding?.balance ?? 0) })}
        confirm={{
          button: t('ecommerce.customers.storeCredits.voidConfirm'),
          action: () => voiding && voidCredit(voiding),
        }}
        cancel={{ button: t('ecommerce.customers.storeCredits.voidCancel'), action: () => setVoiding(null) }}
      />
    </Box>
  );
};

export default CustomerStoreCredits;
