import { useIntl } from 'react-intl';
import { getTranslation } from '../../../core/utils/getTranslation';
import PaymentInstructionsModal from './PaymentInstructionsModal';

type Props = {
  orderId: number;
  reference: number;
  /** Order locale (example instructions). */
  locale: string;
  /** Updated order total, in cents. */
  total: number;
  /** Already paid, in cents. */
  paid: number;
  /** Amount still due, in cents. */
  due: number;
  onClose: () => void;
  onSent: () => void;
};

/**
 * Asks for the amount due after a modification (requirements 16.7/16.8): manual instructions or
 * a Stripe payment link, sent with the supplementary payment e-mail. "Send later" keeps the
 * amount due on the order.
 */
const SupplementaryPaymentModal = ({ orderId, reference, locale, total, paid, due, onClose, onSent }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  return (
    <PaymentInstructionsModal
      orderId={orderId}
      reference={reference}
      locale={locale}
      due={due}
      title={t('ecommerce.orders.supplementary.title', { reference })}
      rows={[
        { label: t('ecommerce.orders.supplementary.total'), amount: total },
        { label: t('ecommerce.orders.supplementary.paid'), amount: paid },
      ]}
      dismissLabel={t('ecommerce.orders.supplementary.sendLater')}
      onClose={onClose}
      onSent={onSent}
    />
  );
};

export default SupplementaryPaymentModal;
