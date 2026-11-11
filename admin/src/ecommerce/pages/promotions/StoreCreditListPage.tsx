import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Flex,
  Loader,
  Modal,
  Searchbar,
  SearchForm,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import ConfirmModal from '../../../components/ConfirmModal';
import FetchStoreCredit from '../../usecases/promotions/fetchStoreCredit';
import FetchStoreCredits from '../../usecases/promotions/fetchStoreCredits';
import VoidStoreCredit from '../../usecases/orders/voidStoreCredit';
import EmptySection from '../../illustrations/EmptySection';
import ListPagination from '../../components/ListPagination';
import PromotionTabs from '../../components/promotions/PromotionTabs';
import { usePromotionPermissions } from '../../hooks/usePromotionPermissions';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { storeCreditDisplayStatus, type StoreCreditDisplayStatus } from '../../utils/refundForm';
import type { StoreCredit } from '../../orderTypes';
import type { StoreCreditMovement } from '../../promotionTypes';

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_VARIANT: Record<StoreCreditDisplayStatus, 'success' | 'neutral' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  USED: 'neutral',
  EXPIRED: 'warning',
  VOID: 'danger',
};

const COLUMNS = ['code', 'email', 'balance', 'expiresAt', 'status'] as const;

/** The credit's ledger of movements (read only: the only edits are registered adjustments). */
const MovementsModal = ({ credit, onClose }: { credit: StoreCredit; onClose: () => void }) => {
  const { formatMessage, formatDate, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const [movements, setMovements] = useState<StoreCreditMovement[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    new FetchStoreCredit()
      .execute(credit.id)
      .then((data) => alive && setMovements(data.movements))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [credit.id]);

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.promotions.storeCredits.movements.title', { code: credit.code })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && (
            <Typography textColor="danger600">{t('ecommerce.promotions.storeCredits.movements.error')}</Typography>
          )}
          {!error && !movements && (
            <Flex justifyContent="center" padding={4}>
              <Loader small />
            </Flex>
          )}
          {movements && movements.length === 0 && (
            <Typography textColor="neutral600">{t('ecommerce.promotions.storeCredits.movements.empty')}</Typography>
          )}
          {movements && movements.length > 0 && (
            <Table colCount={4} rowCount={movements.length}>
              <Thead>
                <Tr>
                  {(['date', 'type', 'amount', 'actor'] as const).map((column) => (
                    <Th key={column}>
                      <Typography variant="sigma">
                        {t(`ecommerce.promotions.storeCredits.movements.columns.${column}`)}
                      </Typography>
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {movements.map((m) => (
                  <Tr key={m.id}>
                    <Td>
                      <Typography textColor="neutral800">
                        {m.createdAt ? formatDate(m.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {t(`ecommerce.promotions.storeCredits.movements.types.${m.type}`)}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{formatCents(m.amount, locale)}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{m.actor ?? '—'}</Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.promotions.storeCredits.movements.close')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/** Store credit tab (design 4.7): look-up and registered adjustments only; "Void" needs `refunds.manage`. */
const StoreCreditListPage = () => {
  const { formatMessage, formatDate, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const { canReadCredits, canVoidCredits, isLoading: permissionsLoading } = usePromotionPermissions();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);

  const [items, setItems] = useState<StoreCredit[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageCount: 1 });
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [opened, setOpened] = useState<StoreCredit | null>(null);
  const [voiding, setVoiding] = useState<StoreCredit | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (searchTerm === search) return undefined;
    const timer = setTimeout(() => {
      setSearch(searchTerm);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm, search]);

  const load = useCallback(() => {
    const current = ++requestId.current;
    setLoading(true);
    new FetchStoreCredits()
      .execute({ page, search: search.trim() || undefined })
      .then((data) => {
        if (current !== requestId.current) return;
        setItems(data.results);
        setPagination({
          page: data.pagination?.page ?? page,
          pageCount: data.pagination?.pageCount ?? 1,
        });
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setError(true);
        setLoading(false);
      });
  }, [page, search]);

  useEffect(() => {
    if (canReadCredits) load();
  }, [canReadCredits, load]);

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

  if (permissionsLoading) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  if (!canReadCredits) {
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        <PromotionTabs />
        <Typography textColor="neutral600">{t('ecommerce.promotions.storeCredits.forbidden')}</Typography>
      </Flex>
    );
  }

  const isEmpty = !loading && !error && items.length === 0;
  const noSearch = search === '' && searchTerm === '';

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <PromotionTabs />

      <SearchForm onSubmit={(e: FormEvent) => e.preventDefault()}>
        <Searchbar
          name="searchbar"
          value={searchTerm}
          onClear={() => {
            setSearchTerm('');
            setSearch('');
            setPage(1);
          }}
          onChange={(e: any) => setSearchTerm(e.target.value)}
          clearLabel={t('ecommerce.promotions.storeCredits.search.clear')}
          placeholder={t('ecommerce.promotions.storeCredits.search.placeholder')}
        >
          {t('ecommerce.promotions.storeCredits.search.label')}
        </Searchbar>
      </SearchForm>

      {error && (
        <Typography textColor="danger600">{t('ecommerce.promotions.storeCredits.error')}</Typography>
      )}

      {loading && items.length === 0 && !error && (
        <Flex justifyContent="center" padding={8}>
          <Loader />
        </Flex>
      )}

      {isEmpty && noSearch && (
        <Flex
          direction="column"
          alignItems="center"
          gap={3}
          padding={10}
          background="neutral0"
          shadow="tableShadow"
          hasRadius
        >
          <EmptySection />
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.promotions.storeCredits.empty')}
          </Typography>
        </Flex>
      )}

      {isEmpty && !noSearch && (
        <Flex justifyContent="center" padding={8} background="neutral0" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.promotions.storeCredits.noResults')}
          </Typography>
        </Flex>
      )}

      {items.length > 0 && (
        <>
          <Table colCount={COLUMNS.length + 1} rowCount={items.length}>
            <Thead>
              <Tr>
                {COLUMNS.map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">
                      {t(`ecommerce.promotions.storeCredits.columns.${column}`)}
                    </Typography>
                  </Th>
                ))}
                <Th>
                  <VisuallyHidden>{t('ecommerce.promotions.storeCredits.columns.actions')}</VisuallyHidden>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((credit) => {
                const status = storeCreditDisplayStatus(credit);
                return (
                  <Tr key={credit.id} style={{ opacity: loading ? 0.5 : 1 }}>
                    <Td>
                      <Typography textColor="neutral800" fontWeight="semiBold" style={{ fontFamily: 'monospace' }}>
                        {credit.code}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{credit.email ?? '—'}</Typography>
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
                      <Box style={{ textAlign: 'right' }}>
                        <Flex gap={2} justifyContent="flex-end">
                          <Button variant="tertiary" size="S" onClick={() => setOpened(credit)}>
                            {t('ecommerce.promotions.storeCredits.open')}
                          </Button>
                          {canVoidCredits && status === 'ACTIVE' && (
                            <Button size="S" variant="danger-light" disabled={busy} onClick={() => setVoiding(credit)}>
                              {t('ecommerce.customers.storeCredits.void')}
                            </Button>
                          )}
                        </Flex>
                      </Box>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>

          <ListPagination page={pagination.page} pageCount={pagination.pageCount} onChange={setPage} />
        </>
      )}

      {opened && <MovementsModal credit={opened} onClose={() => setOpened(null)} />}

      <ConfirmModal
        key={`void-${voiding?.id ?? 0}`}
        open={canVoidCredits && !!voiding}
        title={t('ecommerce.customers.storeCredits.voidTitle', { code: voiding?.code ?? '' })}
        text={t('ecommerce.customers.storeCredits.voidText', { balance: money(voiding?.balance ?? 0) })}
        confirm={{
          button: t('ecommerce.customers.storeCredits.voidConfirm'),
          action: () => voiding && voidCredit(voiding),
        }}
        cancel={{ button: t('ecommerce.customers.storeCredits.voidCancel'), action: () => setVoiding(null) }}
      />
    </Flex>
  );
};

export { StoreCreditListPage };
