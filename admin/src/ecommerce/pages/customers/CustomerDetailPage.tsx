import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  IconButton,
  Loader,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import config from '../../../core/config';
import { HeaderActions } from '../../components/HeaderActions';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCustomer from '../../usecases/orders/fetchCustomer';
import UpdateCustomer from '../../usecases/orders/updateCustomer';
import FetchOrderLocales from '../../usecases/orders/fetchOrderLocales';
import { extractFieldErrors } from '../../utils/productForm';
import {
  buildCustomerInput,
  customerFormFromCustomer,
  customerLocaleLabel,
  customerName,
  toCustomerErrorMap,
  validateCustomerForm,
  type CustomerErrorMap,
  type CustomerField,
  type CustomerForm,
} from '../../utils/customerForm';
import { useCustomerPermissions } from '../../hooks/useCustomerPermissions';
import { useOrderPermissions } from '../../hooks/useOrderPermissions';
import { usePaymentPermissions } from '../../hooks/usePaymentPermissions';
import { BlockCustomerDialog } from '../../components/customers/BlockCustomerDialog';
import { ChangePasswordModal } from '../../components/customers/ChangePasswordModal';
import { ActionConfirmModal } from '../../components/ActionConfirmModal';
import { ToneBadge } from '../../components/orders/StatusBadges';
import BlockCustomer from '../../usecases/orders/blockCustomer';
import UnblockCustomer from '../../usecases/orders/unblockCustomer';
import { customerBadges, type CustomerBadge } from '../../utils/customerAccounts';
import CustomerStoreCredits from '../../components/customers/CustomerStoreCredits';
import type { Customer, FieldError, OrderLocales } from '../../orderTypes';
import CustomerOrdersSection from './CustomerOrdersSection';
import CustomerEventsSection from './CustomerEventsSection';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from '../../components/orders/NoticeBar';

const FIELDS: { field: CustomerField; required: boolean; type: string }[] = [
  { field: 'firstName', required: true, type: 'text' },
  { field: 'lastName', required: true, type: 'text' },
  { field: 'email', required: true, type: 'email' },
  { field: 'phone', required: false, type: 'tel' },
];

const CustomerDetailPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const params = useParams<{ id: string }>();
  const customerId = Number(params.id);
  const basePath = `/plugins/${config.pluginId}/ecommerce/customers`;
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const { canManage, canBlock, canSetPassword } = useCustomerPermissions();
  const { canManage: canManageOrders } = useOrderPermissions();
  const { canRefund } = usePaymentPermissions();

  const [form, setForm] = useState<CustomerForm | null>(null);
  const [title, setTitle] = useState('');
  // The saved e-mail: store credits are valid for it.
  const [email, setEmail] = useState('');
  // The customer's language (e-mails): set from the order that created it, editable here.
  const [locale, setLocale] = useState<string | null>(null);
  const [locales, setLocales] = useState<OrderLocales['locales']>([]);
  const [localeError, setLocaleError] = useState<string | null>(null);
  const [errors, setErrors] = useState<CustomerErrorMap>({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  // The account state (type, verification, block) of the saved customer.
  const [account, setAccount] = useState<Customer | null>(null);
  const [dialog, setDialog] = useState<'block' | 'unblock' | 'password' | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  /** Bumped after a change made here, so the activity log shows it (its write is in the background). */
  const [eventsRefresh, setEventsRefresh] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshEvents = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setEventsRefresh((n) => n + 1), 600);
  };
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!Number.isInteger(customerId) || customerId < 1) {
      setLoadError(true);
      return undefined;
    }
    let cancelled = false;
    setForm(null);
    setAccount(null);
    setLoadError(false);
    new FetchCustomer()
      .execute(customerId)
      .then((customer) => {
        if (cancelled) return;
        setForm(customerFormFromCustomer(customer));
        setTitle(customerName(customer));
        setEmail(customer.email);
        setLocale(customer.locale ?? null);
        setAccount(customer);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Locale names for the language field; without them (e.g. no orders permission) the code shows.
  useEffect(() => {
    let cancelled = false;
    new FetchOrderLocales()
      .execute()
      .then((res) => {
        if (!cancelled) setLocales(res.locales ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const backButton = (
    <IconButton label={t('ecommerce.customers.back')} onClick={() => navigate(basePath)}>
      <ArrowLeft />
    </IconButton>
  );

  if (loadError) {
    return (
      <Flex gap={3} alignItems="center">
        {backButton}
        <Typography textColor="danger600">{t('ecommerce.customers.loadError')}</Typography>
      </Flex>
    );
  }

  if (!form) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  const update = (field: CustomerField, value: string) => {
    setForm((f) => (f ? { ...f, [field]: value } : f));
    setErrors((map) => {
      if (!(field in map)) return map;
      const next = { ...map };
      delete next[field];
      return next;
    });
  };

  const errorText = (field: CustomerField) => {
    const code = errors[field];
    if (!code) return undefined;
    return formatMessage({
      id: getTranslation(`ecommerce.customers.errors.${code}`),
      defaultMessage: t('ecommerce.customers.errors.invalid'),
    });
  };

  const showErrors = (list: FieldError[]) => {
    setErrors(toCustomerErrorMap(list));
    toggleNotification({ type: 'warning', message: t('ecommerce.customers.errors.fix') });
  };

  const save = async () => {
    if (saving || !canManage) return;
    const local = validateCustomerForm(form);
    if (local.length) {
      showErrors(local);
      return;
    }
    setSaving(true);
    try {
      const saved = await new UpdateCustomer().execute(customerId, {
        ...buildCustomerInput(form),
        ...(locale ? { locale } : {}),
      });
      setForm(customerFormFromCustomer(saved));
      setTitle(customerName(saved));
      setEmail(saved.email);
      setLocale(saved.locale ?? null);
      setAccount(saved);
      setErrors({});
      setLocaleError(null);
      toggleNotification({ type: 'success', message: t('ecommerce.customers.saved') });
      refreshEvents();
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const localeIssue = fieldErrors?.find((e) => e.path === 'locale');
      setLocaleError(localeIssue ? (localeIssue.code as string) : null);
      if (fieldErrors) showErrors(fieldErrors);
      else toggleNotification({ type: 'danger', message: t('ecommerce.customers.saveError') });
    } finally {
      setSaving(false);
    }
  };

  const runBlock = async (action: () => Promise<Customer>, okId: string) => {
    if (blockBusy) return;
    setBlockBusy(true);
    try {
      const updated = await action();
      setAccount(updated);
      setDialog(null);
      toggleNotification({ type: 'success', message: t(okId) });
      refreshEvents();
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.customers.block.error') });
    } finally {
      setBlockBusy(false);
    }
  };

  const blocked = !!account?.blocked;
  const registered = account?.accountType === 'REGISTERED';
  const badges = account ? customerBadges(account) : [];
  const BADGE_VARIANT: Record<CustomerBadge, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
    guest: 'neutral',
    registered: 'primary',
    emailVerified: 'success',
    emailNotVerified: 'warning',
    blocked: 'danger',
  };
  const showBlock = canBlock && !blocked;
  const showUnblock = canBlock && blocked;
  const showPassword = canSetPassword && registered && !blocked;

  const textField = (field: CustomerField, required: boolean, type: string) => (
    <Field.Root name={field} required={required} error={errorText(field)}>
      <Field.Label>{t(`ecommerce.customers.fields.${field}`)}</Field.Label>
      <TextInput
        type={type}
        value={form[field]}
        disabled={!canManage}
        onChange={(e: any) => update(field, e.target.value)}
      />
      <Field.Error />
    </Field.Root>
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Flex gap={3} alignItems="center" style={{ minWidth: 0 }}>
          {backButton}
          <Typography variant="beta" tag="h1" ellipsis>
            {title || t('ecommerce.customers.untitled')}
          </Typography>
        </Flex>
        {(canManage || showBlock || showUnblock || showPassword) && (
          // In the page header, top right (as the other pages' save).
          <HeaderActions>
            {showPassword && (
              <Button variant="tertiary" onClick={() => setDialog('password')}>
                {t('ecommerce.customers.password.open')}
              </Button>
            )}
            {showBlock && (
              <Button variant="danger-light" onClick={() => setDialog('block')}>
                {t('ecommerce.customers.block.open')}
              </Button>
            )}
            {showUnblock && (
              <Button variant="tertiary" onClick={() => setDialog('unblock')}>
                {t('ecommerce.customers.unblock.open')}
              </Button>
            )}
            {canManage && (
              <Button variant="secondary" onClick={save} loading={saving}>
                {t('ecommerce.customers.save')}
              </Button>
            )}
          </HeaderActions>
        )}
      </Flex>

      {badges.length > 0 && (
        <Flex gap={2} wrap="wrap">
          {badges.map((badge) => (
            <ToneBadge key={badge} variant={BADGE_VARIANT[badge]}>
              {t(`ecommerce.customers.badges.${badge}`)}
            </ToneBadge>
          ))}
        </Flex>
      )}

      {blocked && (
        <Box hasRadius padding={4} style={{ background: NOTICE_BACKGROUND }}>
          <Flex direction="column" alignItems="stretch" gap={2}>
            <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
              <strong>{t('ecommerce.customers.block.banner')}</strong>
              {(account?.blockedBy || account?.blockedAt) && (
                <>
                  {' '}
                  {formatMessage(
                    { id: getTranslation('ecommerce.customers.block.bannerBy') },
                    {
                      admin: account?.blockedBy ?? '—',
                      date: account?.blockedAt
                        ? formatMessage(
                            { id: getTranslation('ecommerce.customers.block.dateValue') },
                            { date: new Date(account.blockedAt) }
                          )
                        : '—',
                    }
                  )}
                </>
              )}
            </Typography>
            <Typography variant="omega" style={{ color: NOTICE_TEXT, whiteSpace: 'pre-wrap' }}>
              {account?.blockedNote || t('ecommerce.customers.block.noNote')}
            </Typography>
          </Flex>
        </Box>
      )}

      <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
        <Flex direction="column" alignItems="stretch" gap={5}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.customers.details')}
          </Typography>
          <Grid.Root gap={5}>
            {FIELDS.filter((f) => f.field !== 'phone').map(({ field, required, type }) => (
              <Grid.Item key={field} col={6} s={12} direction="column" alignItems="stretch">
                {textField(field, required, type)}
              </Grid.Item>
            ))}
            {/* Phone and language share the column next to the e-mail, half each. */}
            <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
              <Grid.Root gap={5} style={{ width: '100%' }}>
                <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                  {textField('phone', false, 'tel')}
                </Grid.Item>
                <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                  <Field.Root
                    name="locale"
                    error={
                      localeError
                        ? formatMessage({
                            id: getTranslation(`ecommerce.customers.errors.${localeError}`),
                            defaultMessage: t('ecommerce.customers.errors.invalid'),
                          })
                        : undefined
                    }
                  >
                    <Field.Label>{t('ecommerce.customers.fields.locale')}</Field.Label>
                    {canManage && locales.length > 0 ? (
                      <SingleSelect
                        value={locale ?? undefined}
                        placeholder={t('ecommerce.customers.fields.localeEmpty')}
                        onChange={(value: string | number) => {
                          setLocale(String(value));
                          setLocaleError(null);
                        }}
                      >
                        {locales.map((l) => (
                          <SingleSelectOption key={l.code} value={l.code}>
                            {l.name}
                          </SingleSelectOption>
                        ))}
                      </SingleSelect>
                    ) : (
                      // Without the locales list (e.g. no orders permission) or rights, read-only.
                      <TextInput
                        value={
                          customerLocaleLabel(locale, locales) ??
                          t('ecommerce.customers.fields.localeEmpty')
                        }
                        disabled
                      />
                    )}
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
              </Grid.Root>
            </Grid.Item>
          </Grid.Root>
        </Flex>
      </Box>

      <BlockCustomerDialog
        open={dialog === 'block'}
        busy={blockBusy}
        onCancel={() => setDialog(null)}
        onConfirm={(note) =>
          runBlock(() => new BlockCustomer().execute(customerId, note), 'ecommerce.customers.block.done')
        }
      />
      <ActionConfirmModal
        open={dialog === 'unblock'}
        title={t('ecommerce.customers.unblock.title')}
        text={t('ecommerce.customers.unblock.text')}
        confirmLabel={t('ecommerce.customers.unblock.confirm')}
        cancelLabel={t('ecommerce.customers.unblock.cancel')}
        confirmVariant="default"
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          runBlock(() => new UnblockCustomer().execute(customerId), 'ecommerce.customers.unblock.done')
        }
      />
      {dialog === 'password' && (
        <ChangePasswordModal
          customerId={customerId}
          email={email}
          onClose={() => setDialog(null)}
          onSaved={refreshEvents}
        />
      )}

      <CustomerStoreCredits key={`credits-${customerId}`} customerId={customerId} email={email} canManage={canRefund} />

      <CustomerOrdersSection key={customerId} customerId={customerId} canCreateOrder={canManageOrders} />

      <CustomerEventsSection key={`events-${customerId}`} customerId={customerId} refreshKey={eventsRefresh} />
    </Flex>
  );
};

export { CustomerDetailPage };
