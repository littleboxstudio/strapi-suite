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
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCustomer from '../../usecases/orders/fetchCustomer';
import UpdateCustomer from '../../usecases/orders/updateCustomer';
import { extractFieldErrors } from '../../utils/productForm';
import {
  buildCustomerInput,
  customerFormFromCustomer,
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
import type { FieldError } from '../../orderTypes';
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
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

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
      const saved = await new UpdateCustomer().execute(customerId, buildCustomerInput(form));
      setForm(customerFormFromCustomer(saved));
      setTitle(customerName(saved));
      setEmail(saved.email);
      setErrors({});
      toggleNotification({ type: 'success', message: t('ecommerce.customers.saved') });
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
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
          <Button onClick={save} loading={saving}>
            {t('ecommerce.customers.save')}
          </Button>
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
          </Grid.Root>
        </Flex>
      </Box>

      <CustomerStoreCredits key={`credits-${customerId}`} customerId={customerId} email={email} canManage={canRefund} />

      <CustomerOrdersSection key={customerId} customerId={customerId} canCreateOrder={canManageOrders} />
    </Flex>
  );
};

export { CustomerDetailPage };
