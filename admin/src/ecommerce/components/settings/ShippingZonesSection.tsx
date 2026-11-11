import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Flex,
  IconButton,
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
import EmptySection from '../../illustrations/EmptySection';
import DeleteShippingZone from '../../usecases/settings/deleteShippingZone';
import { zoneCountriesSummary } from '../../utils/shippingZoneForm';
import { ShippingZoneModal } from './ShippingZoneModal';
import type { ShippingZone } from '../../settingsTypes';

type Props = {
  zones: ShippingZone[];
  markets: string[];
  readOnly: boolean;
  /** Called with the full list after a zone is created, edited or deleted. */
  onChange: (zones: ShippingZone[]) => void;
};

const ShippingZonesSection = ({ zones, markets, readOnly, onChange }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [editing, setEditing] = useState<{ zone: ShippingZone | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ShippingZone | null>(null);

  const remove = async (zone: ShippingZone) => {
    try {
      await new DeleteShippingZone().execute(zone.id);
      onChange(zones.filter((z) => z.id !== zone.id));
      toggleNotification({ type: 'success', message: t('ecommerce.settings.zones.deleted') });
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.settings.zones.deleteError') });
    }
  };

  const onSaved = (saved: ShippingZone) => {
    setEditing(null);
    onChange(
      zones.some((z) => z.id === saved.id)
        ? zones.map((z) => (z.id === saved.id ? saved : z))
        : [...zones, saved]
    );
  };

  const addButton = (variant: 'default' | 'secondary') =>
    readOnly ? null : (
      <Button variant={variant} startIcon={<Plus />} onClick={() => setEditing({ zone: null })}>
        {t('ecommerce.settings.zones.add')}
      </Button>
    );

  const content = () => {
    if (zones.length === 0) {
      return (
        <Flex direction="column" alignItems="center" gap={3} padding={6}>
          <EmptySection />
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.settings.zones.empty')}
          </Typography>
          {addButton('default')}
        </Flex>
      );
    }
    return (
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Table colCount={3} rowCount={zones.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">{t('ecommerce.settings.zones.table.name')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {t('ecommerce.settings.zones.table.countries')}
                </Typography>
              </Th>
              <Th>
                <VisuallyHidden>{t('ecommerce.settings.zones.table.actions')}</VisuallyHidden>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {zones.map((zone) => (
              <Tr key={zone.id}>
                <Td>
                  <Typography textColor="neutral800">{zone.name}</Typography>
                </Td>
                <Td style={{ whiteSpace: 'normal' }}>
                  <Typography textColor="neutral800">
                    {zoneCountriesSummary(zone, uiLocale)}
                  </Typography>
                </Td>
                <Td>
                  {!readOnly && (
                    <Flex gap={1} justifyContent="flex-end">
                      <IconButton
                        label={t('ecommerce.settings.zones.edit')}
                        variant="ghost"
                        onClick={() => setEditing({ zone })}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={t('ecommerce.settings.zones.delete')}
                        variant="ghost"
                        onClick={() => setConfirmDelete(zone)}
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

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.settings.zones.title')}
          </Typography>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.settings.zones.description')}
          </Typography>
        </Flex>
        {content()}
      </Flex>

      {editing && !readOnly && (
        <ShippingZoneModal
          zone={editing.zone}
          markets={markets}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title={t('ecommerce.settings.zones.deleteConfirm.title')}
        text={t('ecommerce.settings.zones.deleteConfirm.text')}
        confirm={{
          button: t('ecommerce.settings.zones.delete'),
          action: () => {
            if (confirmDelete && !readOnly) remove(confirmDelete);
            setConfirmDelete(null);
          },
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => setConfirmDelete(null),
        }}
      />
    </Box>
  );
};

export { ShippingZonesSection };
