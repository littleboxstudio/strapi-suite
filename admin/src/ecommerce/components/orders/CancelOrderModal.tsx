import { useIntl } from 'react-intl';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';

type Props = {
  open: boolean;
  reference: number;
  onConfirm: () => void;
  onClose: () => void;
};

/** Confirms a cancellation; explains that no refund is made automatically (requirement 10.6). */
const CancelOrderModal = ({ open, reference, onConfirm, onClose }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  return (
    <ConfirmModal
      open={open}
      title={t('ecommerce.orders.detail.cancel.title')}
      text={t('ecommerce.orders.detail.cancel.text', { reference })}
      confirm={{ button: t('ecommerce.orders.detail.cancel.confirm'), action: onConfirm }}
      cancel={{ button: t('ecommerce.orders.detail.cancel.back'), action: onClose }}
    />
  );
};

export default CancelOrderModal;
