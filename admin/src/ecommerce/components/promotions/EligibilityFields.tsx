import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Flex,
  Loader,
  Popover,
  Radio,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  TextInput,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCustomers from '../../usecases/orders/fetchCustomers';
import EmptyNote from '../orders/EmptyNote';
import type { PromotionErrors } from '../../utils/promotionForm';
import type { EligibilityCustomer } from '../../promotionTypes';
import type { CustomerListItem } from '../../orderTypes';

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  mode: 'ALL' | 'CUSTOMERS';
  customers: EligibilityCustomer[];
  onChange: (patch: { eligibilityMode?: 'ALL' | 'CUSTOMERS'; customers?: EligibilityCustomer[] }) => void;
  errors: PromotionErrors;
  disabled?: boolean;
};

const fullName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ');

/**
 * Who the promotion is for: every customer, or specific customers. Specific customers are picked
 * with a search (by name or e-mail) and listed in a table, each with Remove.
 */
const EligibilityFields = ({ mode, customers, onChange, errors, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.promotions.form';

  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CustomerListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
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

  // Customers already in the table are not offered again.
  const chosen = new Set(customers.map((c) => c.id));
  const offered = results.filter((c) => !chosen.has(c.id));
  const showList = open && term.trim() !== '';

  const add = (c: CustomerListItem) => {
    onChange({
      customers: [...customers, { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email }],
    });
    setTerm('');
    setOpen(false);
  };
  const remove = (id: number) => onChange({ customers: customers.filter((c) => c.id !== id) });

  const listError = errors['eligibility.customerIds'] ?? errors.eligibility;
  const lineError = Object.keys(errors).find((k) => /^eligibility\.customerIds\.\d+$/.test(k));
  let error: string | undefined;
  if (listError === 'required') error = t(`${p}.customers.required`);
  else if (listError === 'too_many') error = t(`${p}.customers.tooMany`);
  else if (listError) error = t(`${p}.errors.${listError}`);
  else if (lineError) error = t(`${p}.customers.unknown`);

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Radio.Group
        value={mode}
        disabled={disabled}
        aria-label={t(`${p}.sections.eligibility`)}
        onValueChange={(value: string) => onChange({ eligibilityMode: value as 'ALL' | 'CUSTOMERS' })}
      >
        <Radio.Item value="ALL">{t(`${p}.eligibility.ALL`)}</Radio.Item>
        <Radio.Item value="CUSTOMERS">{t(`${p}.eligibility.CUSTOMERS`)}</Radio.Item>
      </Radio.Group>

      {mode === 'CUSTOMERS' && (
        <Flex direction="column" alignItems="stretch" gap={3}>
          {!disabled && (
            <Popover.Root open={showList} onOpenChange={setOpen}>
              <Popover.Anchor ref={anchorRef}>
                {/* 38px tall, as the other search bars. */}
                <TextInput
                  aria-label={t(`${p}.customers.search`)}
                  placeholder={t(`${p}.customers.search`)}
                  startAction={<Search />}
                  value={term}
                  autoComplete="off"
                  aria-haspopup="listbox"
                  aria-expanded={showList}
                  style={{ height: 38 }}
                  onChange={(e: any) => {
                    setTerm(e.target.value);
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                />
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
                  {searching && offered.length === 0 && (
                    <Flex justifyContent="center" padding={3}>
                      <Loader small />
                    </Flex>
                  )}
                  {searchFailed && (
                    <Box padding={3}>
                      <Typography textColor="danger600">{t(`${p}.customers.searchError`)}</Typography>
                    </Box>
                  )}
                  {!searching && searched && !searchFailed && offered.length === 0 && (
                    <Box padding={3}>
                      <Typography variant="omega" textColor="neutral600">
                        {t(`${p}.customers.searchNone`)}
                      </Typography>
                    </Box>
                  )}
                  {offered.map((c, i) => (
                    <Box
                      key={c.id}
                      tag="button"
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => add(c)}
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
                          {fullName(c) || c.email}
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
          )}

          {customers.length === 0 ? (
            <EmptyNote>{t(`${p}.customers.empty`)}</EmptyNote>
          ) : (
            <Table colCount={disabled ? 2 : 3} rowCount={customers.length + 1}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">{t(`${p}.customers.columns.name`)}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t(`${p}.customers.columns.email`)}</Typography>
                  </Th>
                  {!disabled && (
                    <Th>
                      <Flex justifyContent="flex-end" style={{ width: '100%' }}>
                        <Typography variant="sigma">{t(`${p}.customers.columns.actions`)}</Typography>
                      </Flex>
                    </Th>
                  )}
                </Tr>
              </Thead>
              <Tbody>
                {customers.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Typography textColor="neutral800">{fullName(c) || '—'}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{c.email ?? '—'}</Typography>
                    </Td>
                    {!disabled && (
                      <Td>
                        <Flex justifyContent="flex-end">
                          <Button size="S" variant="danger-light" onClick={() => remove(c.id)}>
                            {t(`${p}.customers.remove`)}
                          </Button>
                        </Flex>
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}

          {error && (
            <Typography variant="pi" textColor="danger600" role="alert">
              {error}
            </Typography>
          )}
        </Flex>
      )}
    </Flex>
  );
};

export default EligibilityFields;
