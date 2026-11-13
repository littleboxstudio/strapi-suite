import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { Pin } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { Address } from '../../orderTypes';

const countryName = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** The address lines, or "no address". */
const AddressLines = ({ address }: { address: Address | null }) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const lines = address
    ? [
        [address.firstName, address.lastName].filter(Boolean).join(' '),
        address.company,
        address.nif ? `${t('ecommerce.orders.address.nif')}: ${address.nif}` : undefined,
        address.line1,
        address.line2,
        [address.postalCode, address.city].filter(Boolean).join(' '),
        address.country ? countryName(address.country, uiLocale) : undefined,
        address.phone,
      ].filter((l): l is string => !!l && !!l.trim())
    : [];

  if (!lines.length) {
    return <Typography textColor="neutral600">{t('ecommerce.orders.detail.address.none')}</Typography>;
  }
  return (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      {lines.map((line, i) => (
        <Typography
          key={i}
          textColor={i === 0 ? 'neutral800' : 'neutral700'}
          fontWeight={i === 0 ? 'semiBold' : undefined}
        >
          {line}
        </Typography>
      ))}
    </Flex>
  );
};

/**
 * One address snapshot of the order (requirements 5.2–5.3): secondary information, so a button in
 * the section's header opens it in a modal.
 */
const AddressButton = ({ title, address }: { title: string; address: Address | null }) => {
  const { formatMessage } = useIntl();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="S" variant="tertiary" startIcon={<Pin />} onClick={() => setOpen(true)}>
        {title}
      </Button>
      {open && (
        <Modal.Root open onOpenChange={(next: boolean) => !next && setOpen(false)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>{title}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <AddressLines address={address} />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onClick={() => setOpen(false)}>
                {formatMessage({ id: getTranslation('ecommerce.orders.notifications.close') })}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </>
  );
};

export default AddressButton;
