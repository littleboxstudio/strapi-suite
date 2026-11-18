import { useEffect, useState } from 'react';
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
import CustomerStoreCredits from '../../components/customers/CustomerStoreCredits';
import type { FieldError, OrderLocales } from '../../orderTypes';
import CustomerOrdersSection from './CustomerOrdersSection';

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

  const { canManage } = useCustomerPermissions();
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

  useEffect(() => {
    if (!Number.isInteger(customerId) || customerId < 1) {
      setLoadError(true);
      return undefined;
    }
    let cancelled = false;
    setForm(null);
    setLoadError(false);
    new FetchCustomer()
      .execute(customerId)
      .then((customer) => {
        if (cancelled) return;
        setForm(customerFormFromCustomer(customer));
        setTitle(customerName(customer));
        setEmail(customer.email);
        setLocale(customer.locale ?? null);
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
      setErrors({});
      setLocaleError(null);
      toggleNotification({ type: 'success', message: t('ecommerce.customers.saved') });
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

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Flex gap={3} alignItems="center" style={{ minWidth: 0 }}>
          {backButton}
          <Typography variant="beta" tag="h1" ellipsis>
            {title || t('ecommerce.customers.untitled')}
          </Typography>
        </Flex>
        {canManage && (
          // In the page header, top right (as the other pages' save).
          <HeaderActions>
            <Button variant="secondary" onClick={save} loading={saving}>
              {t('ecommerce.customers.save')}
            </Button>
          </HeaderActions>
        )}
      </Flex>

      <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
        <Flex direction="column" alignItems="stretch" gap={5}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.customers.details')}
          </Typography>
          <Grid.Root gap={5}>
            {FIELDS.map(({ field, required, type }) => (
              <Grid.Item key={field} col={6} s={12} direction="column" alignItems="stretch">
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
              </Grid.Item>
            ))}
            <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
              <Field.Root
                name="locale"
                hint={t('ecommerce.customers.fields.localeHint')}
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
                <Field.Hint />
                <Field.Error />
              </Field.Root>
            </Grid.Item>
          </Grid.Root>
        </Flex>
      </Box>

      <CustomerStoreCredits key={`credits-${customerId}`} customerId={customerId} email={email} canManage={canRefund} />

      <CustomerOrdersSection key={customerId} customerId={customerId} canCreateOrder={canManageOrders} />
    </Flex>
  );
};

export { CustomerDetailPage };
