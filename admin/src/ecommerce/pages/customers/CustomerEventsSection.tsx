import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Flex,
  IconButton,
  Link,
  Loader,
  Searchbar,
  SearchForm,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ChevronLeft, ChevronRight } from '@strapi/icons';
import styled from 'styled-components';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCustomerEvents from '../../usecases/orders/fetchCustomerEvents';
import SearchFieldHeight from '../../components/SearchFieldHeight';
import { ToneBadge } from '../../components/orders/StatusBadges';
import { describeUserAgent } from '../../utils/userAgent';
import {
  CUSTOMER_EVENT_TYPES,
  type CustomerEvent,
  type CustomerEventType,
} from '../../orderTypes';

const SEARCH_DEBOUNCE_MS = 300;

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
const EVENT_TONE: Partial<Record<CustomerEventType, Tone>> = {
  LOGIN: 'success',
  LOGIN_FAILED: 'danger',
  ORDER_PLACED: 'primary',
  BLOCKED: 'danger',
  UNBLOCKED: 'success',
  PASSWORD_RESET: 'warning',
  PASSWORD_CHANGED: 'warning',
  EMAIL_CHANGED: 'warning',
};

/** The type filter is 38px tall, like the search field beside it. */
const SelectHeight = styled.div`
  min-width: 240px;
  [role='combobox'] {
    min-height: 38px;
    height: 38px;
  }
`;

type Props = { customerId: number };

/** The customer event log: last section of the record, 50 per page, newest first. */
const CustomerEventsSection = ({ customerId }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [items, setItems] = useState<CustomerEvent[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<CustomerEventType | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (searchTerm === search) return undefined;
    const timer = setTimeout(() => {
      setSearch(searchTerm);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm, search]);

  useEffect(() => {
    const current = ++requestId.current;
    setLoading(true);
    new FetchCustomerEvents()
      .execute(customerId, { page, search: search.trim() || undefined, type: type || undefined })
      .then((data) => {
        if (current !== requestId.current) return;
        setItems(data.results);
        setPageCount(Math.max(1, data.pagination?.pageCount ?? 1));
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setError(true);
        setLoading(false);
      });
  }, [customerId, page, search, type]);

  const fieldLabel = (field: string) => t(`ecommerce.customers.events.field.${field}`);
  const empty = t('ecommerce.customers.events.emptyValue');

  const details = (e: CustomerEvent) => {
    const d = e.details ?? {};
    if (d.changes?.length) {
      return (
        <Flex direction="column" alignItems="flex-start" gap={1}>
          {d.changes.map((c) => (
            <Typography key={c.field} variant="pi" textColor="neutral800">
              {fieldLabel(c.field)}: {c.from ?? empty} → {c.to ?? empty}
            </Typography>
          ))}
        </Flex>
      );
    }
    if (d.reason) return t(`ecommerce.customers.events.reason.${d.reason}`);
    if (d.scope) return t(`ecommerce.customers.events.scope.${d.scope}`);
    if (d.newEmail) return t('ecommerce.customers.events.newEmail', { email: d.newEmail });
    if (d.note) return t('ecommerce.customers.events.note', { note: d.note });
    if (d.orderId && d.reference) {
      return (
        <Link tag={RouterLink} to={`/plugins/${config.pluginId}/ecommerce/orders/${d.orderId}`}>
          #{d.reference}
        </Link>
      );
    }
    return '—';
  };

  const who = (e: CustomerEvent) => {
    const kind = t(`ecommerce.customers.events.actor.${e.actor.type}`);
    return e.actor.name ? `${kind}: ${e.actor.name}` : kind;
  };

  const noFilters = search === '' && searchTerm === '' && type === '';

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Typography variant="delta" tag="h2">
          {t('ecommerce.customers.events.title')}
        </Typography>

        <Flex gap={3} alignItems="flex-start" wrap="wrap">
          <Box style={{ flex: 1, minWidth: 260 }}>
            <SearchFieldHeight>
              <SearchForm onSubmit={(e: FormEvent) => e.preventDefault()}>
                <Searchbar
                  name="events-search"
                  value={searchTerm}
                  onClear={() => {
                    setSearchTerm('');
                    setSearch('');
                    setPage(1);
                  }}
                  onChange={(e: any) => setSearchTerm(e.target.value)}
                  clearLabel={t('ecommerce.customers.events.search.clear')}
                  placeholder={t('ecommerce.customers.events.search.placeholder')}
                >
                  {t('ecommerce.customers.events.search.label')}
                </Searchbar>
              </SearchForm>
            </SearchFieldHeight>
          </Box>
          <SelectHeight>
            <SingleSelect
              aria-label={t('ecommerce.customers.events.filter.label')}
              value={type || 'all'}
              onChange={(value: string | number) => {
                setType(value === 'all' ? '' : (String(value) as CustomerEventType));
                setPage(1);
              }}
            >
              <SingleSelectOption value="all">{t('ecommerce.customers.events.filter.all')}</SingleSelectOption>
              {CUSTOMER_EVENT_TYPES.map((key) => (
                <SingleSelectOption key={key} value={key}>
                  {t(`ecommerce.customers.events.type.${key}`)}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </SelectHeight>
        </Flex>

        {error && <Typography textColor="danger600">{t('ecommerce.customers.events.error')}</Typography>}

        {loading && items.length === 0 && !error && (
          <Flex justifyContent="center" padding={6}>
            <Loader small />
          </Flex>
        )}

        {!loading && !error && items.length === 0 && (
          <Flex justifyContent="center" padding={6}>
            <Typography variant="omega" textColor="neutral600">
              {noFilters ? t('ecommerce.customers.events.empty') : t('ecommerce.customers.noResults')}
            </Typography>
          </Flex>
        )}

        {items.length > 0 && (
          <>
            <Table colCount={6} rowCount={items.length}>
              <Thead>
                <Tr>
                  {['date', 'event', 'details', 'actor', 'ip', 'device'].map((col) => (
                    <Th key={col}>
                      <Typography variant="sigma">{t(`ecommerce.customers.events.table.${col}`)}</Typography>
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {items.map((e) => (
                  <Tr key={e.id} style={{ opacity: loading ? 0.5 : 1 }}>
                    <Td>
                      <Typography textColor="neutral800">
                        {e.createdAt ? formatDate(e.createdAt, { dateStyle: 'medium', timeStyle: 'medium' }) : '—'}
                      </Typography>
                    </Td>
                    <Td>
                      <ToneBadge variant={EVENT_TONE[e.type] ?? 'neutral'}>
                        {t(`ecommerce.customers.events.type.${e.type}`)}
                      </ToneBadge>
                    </Td>
                    <Td style={{ whiteSpace: 'normal' }}>
                      <Typography variant="pi" textColor="neutral800">
                        {details(e)}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral800">
                        {who(e)}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral800">
                        {e.ip ?? '—'}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral800" title={e.userAgent ?? undefined}>
                        {describeUserAgent(e.userAgent) ?? (e.userAgent ? t('ecommerce.customers.events.unknownDevice') : '—')}
                      </Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>

            <Flex justifyContent="flex-end" alignItems="center" gap={2}>
              <IconButton
                label={t('ecommerce.pagination.previous')}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft />
              </IconButton>
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.customers.events.page', { page, pageCount })}
              </Typography>
              <IconButton
                label={t('ecommerce.pagination.next')}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount || loading}
              >
                <ChevronRight />
              </IconButton>
            </Flex>
          </>
        )}
      </Flex>
    </Box>
  );
};

export default CustomerEventsSection;
