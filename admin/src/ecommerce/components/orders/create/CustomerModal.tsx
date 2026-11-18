import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Loader,
  Modal,
  Popover,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Search } from '@strapi/icons';
import { getTranslation } from '../../../../core/utils/getTranslation';
import FetchCustomers from '../../../usecases/orders/fetchCustomers';
import FetchCustomer from '../../../usecases/orders/fetchCustomer';
import { customerFormErrors, pickedCustomerLocale } from '../../../utils/createOrder';
import type { OrderForm } from '../../../utils/orderForm';
import type { CustomerListItem, OrderLocales } from '../../../orderTypes';

const SEARCH_DEBOUNCE_MS = 300;

const FIELDS = [
  { field: 'firstName', required: true, type: 'text' },
  { field: 'lastName', required: true, type: 'text' },
  { field: 'email', required: true, type: 'email' },
  { field: 'phone', required: false, type: 'tel' },
] as const;

type Customer = OrderForm['customer'];

type Props = {
  /** Edit: the customer in the table; Add: empty. */
  initial: Customer;
  /** The server's errors of these fields (`email` → code). */
  errors?: Record<string, string>;
  codeText: (code: string) => string;
  /** The order's language now, the configured ones and the default (a picked customer without one). */
  locale: string;
  locales: OrderLocales['locales'];
  defaultLocale: string | null;
  /** The server's error of the language. */
  localeError?: string;
  onClose: () => void;
  /**
   * `customerId`: an existing customer was picked in the search (their addresses fill the tables).
   * `locale`: the order's language (a new customer is saved with it).
   */
  onSave: (customer: Customer, customerId: number | null, locale: string) => void;
};

/**
 * Create order's Add/Edit customer: a search of the existing customers by e-mail or name (the
 * matches drop down while typing; picking one fills the form), and the form below it.
 */
const CustomerModal = ({
  initial,
  errors: initialErrors = {},
  codeText,
  locale,
  locales,
  defaultLocale,
  localeError,
  onClose,
  onSave,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [form, setForm] = useState<Customer>(initial);
  const [errors, setErrors] = useState<Record<string, string>>(initialErrors);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [lang, setLang] = useState(locale);
  const [langError, setLangError] = useState(localeError);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<CustomerListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const requestId = useRef(0);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      requestId.current++;
      setResults([]);
      setSearching(false);
      setSearched(false);
      setSearchFailed(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      const current = ++requestId.current;
      setSearching(true);
      new FetchCustomers()
        .execute({ search: q })
        .then((page) => {
          if (current !== requestId.current) return;
          setResults(page.results);
          setSearchFailed(false);
          setSearched(true);
          setSearching(false);
        })
        .catch(() => {
          if (current !== requestId.current) return;
          setSearchFailed(true);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  /** The record has the phone the list leaves out; without it, the list's fields. */
  const pick = async (c: CustomerListItem) => {
    setOpen(false);
    setTerm('');
    setPicking(true);
    // Their saved language when the store has it, else the default.
    const languageOf = (saved: string | null | undefined) =>
      setLang(pickedCustomerLocale(saved, locales, defaultLocale || locale));
    try {
      const full = await new FetchCustomer().execute(c.id);
      languageOf(full.locale ?? c.locale);
      setForm({
        firstName: full.firstName ?? '',
        lastName: full.lastName ?? '',
        email: full.email ?? '',
        phone: full.phone ?? '',
      });
    } catch {
      languageOf(c.locale);
      setForm({
        firstName: c.firstName ?? '',
        lastName: c.lastName ?? '',
        email: c.email ?? '',
        phone: '',
      });
    } finally {
      setPicking(false);
    }
    setPickedId(c.id);
    setErrors({});
  };

  const save = () => {
    const found = customerFormErrors(form);
    if (Object.keys(found).length || !lang) {
      setErrors(found);
      if (!lang) setLangError(codeText('required'));
      return;
    }
    onSave(
      {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      },
      pickedId,
      lang
    );
    onClose();
  };

  const showList = open && !!term.trim() && (searching || searched || searchFailed);
  const name = (c: CustomerListItem) => [c.firstName, c.lastName].filter(Boolean).join(' ');

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {t(
              initial.email || initial.firstName
                ? 'ecommerce.orders.new.customerEdit'
                : 'ecommerce.orders.new.customerAdd'
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6}>
            <Popover.Root open={showList} onOpenChange={setOpen}>
              <Popover.Anchor ref={anchorRef}>
                <Field.Root
                  name="customer-search"
                  hint={t('ecommerce.orders.new.customerSearchHint')}
                >
                  <Field.Label>{t('ecommerce.orders.new.customerSearch')}</Field.Label>
                  <TextInput
                    startAction={<Search />}
                    value={term}
                    autoComplete="off"
                    aria-haspopup="listbox"
                    aria-expanded={showList}
                    onChange={(e: any) => {
                      setTerm(e.target.value);
                      setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                  />
                  <Field.Hint />
                </Field.Root>
              </Popover.Anchor>
              <Popover.Content
                align="start"
                sideOffset={4}
                onOpenAutoFocus={(e: Event) => e.preventDefault()}
                onInteractOutside={(e: any) => {
                  if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
                }}
                style={{
                  width: 'var(--radix-popover-trigger-width, var(--radix-popper-anchor-width))',
                  minWidth: 320,
                }}
              >
                <Box style={{ maxHeight: 280, overflowY: 'auto' }} role="listbox">
                  {searching && results.length === 0 && (
                    <Flex justifyContent="center" padding={3}>
                      <Loader small />
                    </Flex>
                  )}
                  {searchFailed && (
                    <Box padding={3}>
                      <Typography textColor="danger600">
                        {t('ecommerce.orders.new.customerSearchError')}
                      </Typography>
                    </Box>
                  )}
                  {!searching && searched && !searchFailed && results.length === 0 && (
                    <Box padding={3}>
                      <Typography variant="omega" textColor="neutral600">
                        {t('ecommerce.orders.new.customerSearchNone')}
                      </Typography>
                    </Box>
                  )}
                  {results.map((c, i) => (
                    <Box
                      key={c.id}
                      tag="button"
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => pick(c)}
                      paddingTop={2}
                      paddingBottom={2}
                      paddingLeft={3}
                      paddingRight={3}
                      borderColor="neutral150"
                      background="neutral0"
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderStyle: 'solid',
                        borderWidth: i > 0 ? '1px 0 0 0' : 0,
                        opacity: searching ? 0.5 : 1,
                      }}
                    >
                      <Flex direction="column" alignItems="flex-start">
                        <Typography textColor="neutral800" fontWeight="semiBold">
                          {name(c) || c.email}
                        </Typography>
                        <Typography variant="pi" textColor="neutral600">
                          {c.email}
                        </Typography>
                      </Flex>
                    </Box>
                  ))}
                </Box>
              </Popover.Content>
            </Popover.Root>

            <Box position="relative">
              {picking && (
                <Flex justifyContent="center" padding={2}>
                  <Loader small />
                </Flex>
              )}
              <Grid.Root gap={5}>
                {FIELDS.map(({ field, required, type }) => (
                  <Grid.Item key={field} col={6} s={12} direction="column" alignItems="stretch">
                    <Field.Root
                      name={`customer.${field}`}
                      required={required}
                      error={errors[field] ? codeText(errors[field]) : undefined}
                    >
                      <Field.Label>{t(`ecommerce.customers.fields.${field}`)}</Field.Label>
                      <TextInput
                        type={type}
                        value={form[field]}
                        disabled={picking}
                        onChange={(e: any) => {
                          const value = e.target.value;
                          setForm((f) => ({ ...f, [field]: value }));
                          setErrors(({ [field]: _gone, ...rest }) => rest);
                          // Another e-mail is another customer: no last addresses are filled.
                          if (field === 'email') setPickedId(null);
                        }}
                      />
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                ))}
                <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                  <Field.Root name="locale" required error={langError}>
                    <Field.Label>{t('ecommerce.orders.new.locale')}</Field.Label>
                    <SingleSelect
                      value={lang || null}
                      disabled={picking}
                      hasError={!!langError}
                      onChange={(value: string | number) => {
                        setLang(String(value));
                        setLangError(undefined);
                      }}
                    >
                      {locales.map((l) => (
                        <SingleSelectOption key={l.code} value={l.code}>
                          {l.name}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
              </Grid.Root>
            </Box>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.shippingCharges.close')}
          </Button>
          <Button variant="secondary" onClick={save} disabled={picking}>
            {t('ecommerce.orders.shippingCharges.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default CustomerModal;
