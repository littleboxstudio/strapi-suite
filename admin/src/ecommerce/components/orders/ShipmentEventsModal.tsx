import { useIntl } from 'react-intl';
import { Button, Modal, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { ShipmentView } from '../../orderTypes';

type Props = {
  shipment: ShipmentView;
  onClose: () => void;
};

const COLUMNS = ['date', 'event', 'details', 'source'] as const;

/** Long carrier descriptions wrap inside their column. */
const WRAP = { whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' } as const;

/** The shipment's event history (oldest first), read-only. */
const ShipmentEventsModal = ({ shipment, onClose }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const date = (iso: string | null) => (iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content style={{ maxWidth: 860, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.shipments.events.title', { id: shipment.id })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Table colCount={COLUMNS.length} rowCount={shipment.events.length + 1}>
            <Thead>
              <Tr>
                {COLUMNS.map((c) => (
                  <Th key={c}>
                    <Typography variant="sigma">{t(`ecommerce.orders.shipments.events.columns.${c}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {shipment.events.map((e, idx) => (
                <Tr key={idx}>
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    <Typography textColor="neutral600">{date(e.occurredAt)}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800" fontWeight="semiBold">
                      {t(`ecommerce.orders.shipments.eventTypes.${e.type}`, undefined, e.type)}
                    </Typography>
                  </Td>
                  <Td style={{ maxWidth: 320 }}>
                    <Typography textColor="neutral700" style={WRAP}>
                      {e.description || '—'}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral600">
                      {e.source ? t(`ecommerce.orders.shipments.eventSources.${e.source}`, undefined, e.source) : '—'}
                    </Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.shipments.events.close')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ShipmentEventsModal;
