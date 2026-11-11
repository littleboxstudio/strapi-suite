import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Pencil, Plus, Trash } from '@strapi/icons';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyShipping from '../../illustrations/EmptyShipping';
import FetchShippingMethods from '../../usecases/settings/fetchShippingMethods';
import DeleteShippingMethod from '../../usecases/settings/deleteShippingMethod';
import FetchSettingsLocales from '../../usecases/settings/fetchSettingsLocales';
import { formatCents } from '../../utils/money';
import { ManualMethodModal } from './ManualMethodModal';
import type { EcommerceLocales } from '../../types';
import type { ManualMethod, ShippingZone } from '../../settingsTypes';

/** Countries listed in a row before collapsing the rest into "+N". */
const VISIBLE_COUNTRIES = 4;

type Editing = { method: ManualMethod | null };

type Props = {
  readOnly: boolean;
  /** Inside the "Manual shipping" card, which already has the title, switch and description. */
  embedded?: boolean;
  /** The shipping zones; a new list (a zone changed) refetches the methods. */
  zones: ShippingZone[];
};

const ManualMethodsTable = ({ readOnly, embedded = false, zones }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [methods, setMethods] = useState<ManualMethod[] | null>(null);
  const [locales, setLocales] = useState<EcommerceLocales | null>(null);
  // Editing needs the locales (the name is per locale).
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManualMethod | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Needs the products read permission; without it the table stays read-only.
    new FetchSettingsLocales()
      .execute()
      .then((info) => {
        if (!cancelled) setLocales(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Deleting a zone removes its prices from the methods, so reload them when the zones change.
  useEffect(() => {
    let cancelled = false;
    new FetchShippingMethods()
      .execute()
      .then((rows) => {
        if (!cancelled) setMethods(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [zones]);

  const remove = async (method: ManualMethod) => {
    try {
      await new DeleteShippingMethod().execute(method.id);
      setMethods((list) => list?.filter((m) => m.id !== method.id) ?? list);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.manualMethods.deleted') });
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('ecommerce.settings.manualMethods.deleteError'),
      });
    }
  };

  const onSaved = (saved: ManualMethod) => {
    setEditing(null);
    setMethods((list) => {
      if (!list) return [saved];
      return list.some((m) => m.id === saved.id)
        ? list.map((m) => (m.id === saved.id ? saved : m))
        : [...list, saved];
    });
  };

  const canEdit = !readOnly && locales !== null;

  const addButton = (variant: 'default' | 'secondary') =>
    !canEdit ? null : (
      <Button variant={variant} startIcon={<Plus />} onClick={() => setEditing({ method: null })}>
        {t('ecommerce.settings.manualMethods.add')}
      </Button>
    );

  const content = () => {
    if (loadError) {
      return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
    }
    if (!methods) {
      return (
        <Flex justifyContent="center" padding={6}>
          <Loader small />
        </Flex>
      );
    }
    if (methods.length === 0) {
      return (
        <Flex direction="column" alignItems="center" gap={3} padding={6}>
          <EmptyShipping />
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.settings.manualMethods.empty')}
          </Typography>
          {addButton('default')}
        </Flex>
      );
    }

    const nameOf = (m: ManualMethod) =>
      (locales && m.name[locales.defaultLocale]) || Object.values(m.name).find((n) => n) || '';
    const countriesOf = (m: ManualMethod) => {
      const shown = m.countries.slice(0, VISIBLE_COUNTRIES).join(', ');
      const rest = m.countries.length - VISIBLE_COUNTRIES;
      return rest > 0 ? `${shown} +${rest}` : shown;
    };

    return (
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Table colCount={6} rowCount={methods.length + 1}>
          <Thead>
            <Tr>
              {(['name', 'price', 'tax', 'countries', 'active'] as const).map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">
                    {t(`ecommerce.settings.manualMethods.table.${column}`)}
                  </Typography>
                </Th>
              ))}
              <Th>
                <VisuallyHidden>{t('ecommerce.settings.manualMethods.table.actions')}</VisuallyHidden>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {methods.map((m) => (
              <Tr key={m.id}>
                <Td>
                  <Typography textColor="neutral800">{nameOf(m)}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{formatCents(m.price, uiLocale)}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{`${m.tax}%`}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800" title={m.countries.join(', ')}>
                    {countriesOf(m)}
                  </Typography>
                </Td>
                <Td>
                  {m.active ? (
                    <Badge backgroundColor="success100" textColor="success700">
                      {t('ecommerce.settings.integrations.active')}
                    </Badge>
                  ) : (
                    <Badge>{t('ecommerce.settings.integrations.inactive')}</Badge>
                  )}
                </Td>
                <Td>
                  {canEdit && (
                    <Flex gap={1} justifyContent="flex-end">
                      <IconButton
                        label={t('ecommerce.settings.manualMethods.edit')}
                        variant="ghost"
                        onClick={() => setEditing({ method: m })}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={t('ecommerce.settings.manualMethods.delete')}
                        variant="ghost"
                        onClick={() => setConfirmDelete(m)}
                      >
                        <Trash />
                      </IconButton>
                    </Flex>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        <Flex justifyContent="flex-start">{addButton('secondary')}</Flex>
      </Flex>
    );
  };

  const modals = (
    <>

      {editing && locales && canEdit && (
        <ManualMethodModal
          method={editing.method}
          locales={locales.locales}
          defaultLocale={locales.defaultLocale}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title={t('ecommerce.settings.manualMethods.deleteConfirm.title')}
        text={t('ecommerce.settings.manualMethods.deleteConfirm.text')}
        confirm={{
          button: t('ecommerce.settings.manualMethods.delete'),
          action: () => {
            if (confirmDelete && canEdit) remove(confirmDelete);
            setConfirmDelete(null);
          },
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => setConfirmDelete(null),
        }}
      />
    </>
  );

  if (embedded) {
    return (
      <Box>
        {content()}
        {modals}
      </Box>
    );
  }
  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      {content()}
      {modals}
    </Box>
  );
};

export { ManualMethodsTable };
