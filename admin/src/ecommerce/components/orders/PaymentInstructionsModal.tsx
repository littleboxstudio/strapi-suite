import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Modal,
  Radio,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import CreatePaymentLink from '../../usecases/orders/createPaymentLink';
import SendPaymentInstructions from '../../usecases/orders/sendPaymentInstructions';
import FetchOrderNotifications from '../../usecases/orders/fetchOrderNotifications';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import {
  MAX_LONG_TEXT,
  MAX_SHORT_TEXT,
  defaultInstructionsText,
  findNewNotification,
} from '../../utils/refundForm';
import type { NotificationView, PaymentLink } from '../../orderTypes';

type Mode = 'MANUAL' | 'STRIPE';

type Props = {
  orderId: number;
  reference: number;
  /** Order locale: the example text shows the amount in it. */
  locale: string;
  /** Amount due, in cents. */
  due: number;
  /** Amounts shown above the amount due (the supplementary payment shows total and paid). */
  rows?: { label: string; amount: number }[];
  title?: string;
  /** Label of the dismiss button ("Cancel"; "Send later" after a modification). */
  dismissLabel?: string;
  onClose: () => void;
  /** Called on close after the instructions were sent (the order has new history). */
  onSent: () => void;
};

const INSTRUCTION_TYPES = ['PAYMENT_INSTRUCTIONS', 'SUPPLEMENTARY_PAYMENT'];
const POLL_ATTEMPTS = 4;
const POLL_INTERVAL_MS = 1000;

type ErrorMap = Partial<Record<'instructions' | 'methodLabel', string>>;

/**
 * Sends the customer how to pay the amount due (requirements 10.9 and 16.8): manual instructions
 * (free text and optional method name) or a Stripe payment link. After sending, shows whether the
 * e-mail went out (the notification is queued, so it polls the order's notifications briefly).
 */
const PaymentInstructionsModal = ({
  orderId,
  reference,
  locale,
  due,
  rows = [],
  title,
  dismissLabel,
  onClose,
  onSent,
}: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  const [mode, setMode] = useState<Mode>('MANUAL');
  const [instructions, setInstructions] = useState(() =>
    defaultInstructionsText(t, { reference, due, locale: locale || uiLocale })
  );
  const [methodLabel, setMethodLabel] = useState('');
  const [errors, setErrors] = useState<ErrorMap>({});
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ url?: string } | null>(null);
  const [notification, setNotification] = useState<NotificationView | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const close = () => (sent ? onSent() : onClose());

  const errorText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.instructions.copied') });
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.orders.instructions.copyError') });
    }
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const created = await new CreatePaymentLink().execute(orderId);
      if (mounted.current) setLink(created);
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.instructions.linkError')),
      });
    } finally {
      if (mounted.current) setGenerating(false);
    }
  };

  const latestNotificationId = async (): Promise<number | null> => {
    try {
      const list = await new FetchOrderNotifications().execute(orderId);
      return list.reduce((max, n) => Math.max(max, n.id), 0);
    } catch {
      return null;
    }
  };

  /** The notification is sent from an in-memory queue: look for it for a few seconds. */
  const watchNotification = async (afterId: number) => {
    for (let i = 0; i < POLL_ATTEMPTS && mounted.current; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (!mounted.current) return;
      try {
        const list = await new FetchOrderNotifications().execute(orderId);
        const found = findNewNotification(list, afterId, INSTRUCTION_TYPES);
        if (found && mounted.current) {
          setNotification(found);
          return;
        }
      } catch {
        return;
      }
    }
  };

  const send = async () => {
    if (sending) return;
    const local: ErrorMap = {};
    if (mode === 'MANUAL') {
      if (!instructions.trim()) local.instructions = errorText('required');
      else if (instructions.trim().length > MAX_LONG_TEXT) local.instructions = errorText('too_long');
      if (methodLabel.trim().length > MAX_SHORT_TEXT) local.methodLabel = errorText('too_long');
    }
    setErrors(local);
    if (Object.keys(local).length) return;

    setSending(true);
    const afterId = await latestNotificationId();
    try {
      const label = methodLabel.trim();
      const result = await new SendPaymentInstructions().execute(
        orderId,
        mode === 'STRIPE'
          ? { mode: 'STRIPE' }
          : { mode: 'MANUAL', instructions: instructions.trim(), ...(label ? { methodLabel: label } : {}) }
      );
      if (!mounted.current) return;
      setSent({ url: result?.url });
      toggleNotification({ type: 'success', message: t('ecommerce.orders.instructions.sent') });
      if (afterId !== null) watchNotification(afterId);
    } catch (err) {
      const map: ErrorMap = {};
      (extractFieldErrors(err) ?? []).forEach((e) => {
        if ((e.path === 'instructions' || e.path === 'methodLabel') && !map[e.path]) {
          map[e.path] = errorText(e.code);
        }
      });
      setErrors(map);
      if (!map.instructions && !map.methodLabel) {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.instructions.error')),
        });
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const amounts = [...rows, { label: t('ecommerce.orders.instructions.due'), amount: due, strong: true }];

  const linkBox = (url: string) => (
    <Flex gap={2} alignItems="flex-end">
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Field.Root name="paymentLink">
          <Field.Label>{t('ecommerce.orders.instructions.link')}</Field.Label>
          <TextInput value={url} readOnly onFocus={(e: any) => e.target.select()} />
        </Field.Root>
      </Box>
      <Button variant="secondary" onClick={() => copy(url)}>
        {t('ecommerce.orders.instructions.copy')}
      </Button>
    </Flex>
  );

  const resultText = () => {
    if (!notification) return t('ecommerce.orders.instructions.result.queued');
    if (notification.status === 'SENT') {
      return t('ecommerce.orders.instructions.result.SENT', { recipient: notification.recipient ?? '' });
    }
    if (notification.status === 'SKIPPED') {
      return t('ecommerce.orders.instructions.result.SKIPPED', {
        reason: formatMessage({
          id: getTranslation(`ecommerce.orders.notifications.errors.${notification.error}`),
          defaultMessage: t('ecommerce.orders.notifications.errors.unknown'),
        }),
      });
    }
    return t('ecommerce.orders.instructions.result.FAILED');
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && close()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{title ?? t('ecommerce.orders.instructions.title', { reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Flex direction="column" alignItems="stretch" gap={2}>
              {amounts.map((row) => {
                const strong = 'strong' in row && row.strong;
                return (
                  <Flex key={row.label} justifyContent="space-between" gap={4}>
                    <Typography
                      textColor={strong ? 'neutral800' : 'neutral600'}
                      fontWeight={strong ? 'bold' : undefined}
                    >
                      {row.label}
                    </Typography>
                    <Typography
                      textColor="neutral800"
                      fontWeight={strong ? 'bold' : undefined}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {money(row.amount)}
                    </Typography>
                  </Flex>
                );
              })}
            </Flex>

            {sent ? (
              <Flex direction="column" alignItems="stretch" gap={4}>
                {sent.url && linkBox(sent.url)}
                <Box padding={3} background={notification?.status === 'SENT' ? 'success100' : 'neutral100'} hasRadius>
                  <Typography variant="omega" textColor="neutral800">
                    {resultText()}
                  </Typography>
                </Box>
              </Flex>
            ) : (
              <>
                <Radio.Group
                  value={mode}
                  aria-label={t('ecommerce.orders.instructions.how')}
                  onValueChange={(value: string) => setMode(value as Mode)}
                >
                  <Radio.Item value="MANUAL">{t('ecommerce.orders.instructions.manual')}</Radio.Item>
                  <Radio.Item value="STRIPE">{t('ecommerce.orders.instructions.stripe')}</Radio.Item>
                </Radio.Group>

                {mode === 'MANUAL' ? (
                  <Flex direction="column" alignItems="stretch" gap={4}>
                    <Field.Root
                      name="methodLabel"
                      error={errors.methodLabel}
                      hint={t('ecommerce.orders.instructions.methodLabelHint')}
                    >
                      <Field.Label>{t('ecommerce.orders.instructions.methodLabel')}</Field.Label>
                      <TextInput
                        value={methodLabel}
                        list="ecommerce-instruction-methods"
                        placeholder={t('ecommerce.orders.instructions.methods.transfer')}
                        onChange={(e: any) => {
                          setMethodLabel(e.target.value);
                          setErrors(({ methodLabel: _m, ...rest }) => rest);
                        }}
                      />
                      <datalist id="ecommerce-instruction-methods">
                        {['transfer', 'mbway', 'multibanco'].map((key) => (
                          <option key={key} value={t(`ecommerce.orders.instructions.methods.${key}`)} />
                        ))}
                      </datalist>
                      <Field.Hint />
                      <Field.Error />
                    </Field.Root>
                    <Field.Root name="instructions" required error={errors.instructions}>
                      <Field.Label>{t('ecommerce.orders.instructions.text')}</Field.Label>
                      <Textarea
                        value={instructions}
                        rows={8}
                        onChange={(e: any) => {
                          setInstructions(e.target.value);
                          setErrors(({ instructions: _i, ...rest }) => rest);
                        }}
                      />
                      <Field.Error />
                    </Field.Root>
                  </Flex>
                ) : (
                  <Flex direction="column" alignItems="stretch" gap={3}>
                    <Typography variant="omega" textColor="neutral600">
                      {t('ecommerce.orders.instructions.stripeHint')}
                    </Typography>
                    {link ? (
                      <>
                        {linkBox(link.url)}
                        <Typography variant="pi" textColor="neutral600">
                          {t('ecommerce.orders.instructions.linkDetails', {
                            amount: money(link.amount),
                            date: formatDate(link.expiresAt, { dateStyle: 'medium', timeStyle: 'short' }),
                          })}
                          {link.reused ? ` · ${t('ecommerce.orders.instructions.linkReused')}` : ''}
                        </Typography>
                      </>
                    ) : (
                      <Box>
                        <Button variant="secondary" onClick={generate} loading={generating}>
                          {t('ecommerce.orders.instructions.generate')}
                        </Button>
                      </Box>
                    )}
                  </Flex>
                )}
              </>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          {sent ? (
            <>
              <span />
              <Button onClick={close}>{t('ecommerce.orders.instructions.close')}</Button>
            </>
          ) : (
            <>
              <Button variant="tertiary" onClick={onClose} disabled={sending}>
                {dismissLabel ?? t('ecommerce.orders.instructions.cancel')}
              </Button>
              <Button onClick={send} loading={sending} disabled={generating}>
                {t('ecommerce.orders.instructions.send')}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default PaymentInstructionsModal;
