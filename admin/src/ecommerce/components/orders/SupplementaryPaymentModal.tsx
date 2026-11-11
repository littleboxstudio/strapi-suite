import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Field, Flex, Modal, Radio, Textarea, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';

type Props = {
  reference: number;
  /** Updated order total, in cents. */
  total: number;
  /** Already paid, in cents. */
  paid: number;
  /** Amount still due, in cents. */
  due: number;
  onClose: () => void;
};

type Option = 'manual' | 'stripe';

/**
 * Asks for the amount due after a modification (requirements 16.7/16.8). Sending manual
 * instructions or a Stripe payment link needs email/Stripe (plan 4): both are disabled for now,
 * and "Send later" keeps the amount due on the order.
 */
const SupplementaryPaymentModal = ({ reference, total, paid, due, onClose }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  const [option, setOption] = useState<Option>('manual');
  const [instructions, setInstructions] = useState('');

  const rows = [
    { key: 'total', amount: total },
    { key: 'paid', amount: paid },
    { key: 'due', amount: due },
  ];

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.supplementary.title', { reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Flex direction="column" alignItems="stretch" gap={2}>
              {rows.map((row) => (
                <Flex key={row.key} justifyContent="space-between" gap={4}>
                  <Typography
                    textColor={row.key === 'due' ? 'neutral800' : 'neutral600'}
                    fontWeight={row.key === 'due' ? 'bold' : undefined}
                  >
                    {t(`ecommerce.orders.supplementary.${row.key}`)}
                  </Typography>
                  <Typography
                    textColor="neutral800"
                    fontWeight={row.key === 'due' ? 'bold' : undefined}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {money(row.amount)}
                  </Typography>
                </Flex>
              ))}
            </Flex>

            <Radio.Group
              value={option}
              disabled
              aria-label={t('ecommerce.orders.supplementary.how')}
              onValueChange={(value: string) => setOption(value as Option)}
            >
              <Radio.Item value="manual">{t('ecommerce.orders.supplementary.manual')}</Radio.Item>
              <Radio.Item value="stripe">{t('ecommerce.orders.supplementary.stripe')}</Radio.Item>
            </Radio.Group>

            <Field.Root name="instructions">
              <Field.Label>{t('ecommerce.orders.supplementary.instructions')}</Field.Label>
              <Textarea
                value={instructions}
                disabled
                onChange={(e: any) => setInstructions(e.target.value)}
              />
            </Field.Root>

            <Box padding={3} background="neutral100" hasRadius>
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.supplementary.unavailable')}
              </Typography>
            </Box>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.supplementary.sendLater')}
          </Button>
          <Button disabled>{t('ecommerce.orders.supplementary.send')}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SupplementaryPaymentModal;
