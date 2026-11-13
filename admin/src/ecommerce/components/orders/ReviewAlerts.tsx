import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Alert, Button, Flex, Link, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import DismissReviewFlag from '../../usecases/orders/dismissReviewFlag';
import { reviewAlerts } from '../../utils/orderEditing';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, Order } from '../../orderTypes';

type Props = {
  order: Order;
  /** `orders.manage`: only then can a flag be dismissed. */
  canManage: boolean;
  /** The server's answer to a dismissal (the updated order). */
  onResult: (result: EditResult) => void;
};

/** One red alert per open review flag, at the top of the order page. */
const ReviewAlerts = ({ order, canManage, onResult }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const alerts = reviewAlerts(order);
  if (alerts.length === 0) return null;

  const dismiss = async (code: (typeof alerts)[number]['code']) => {
    if (dismissing) return;
    setDismissing(code);
    try {
      onResult(await new DismissReviewFlag().execute(order.id, code, { operationId: mintUuid() }));
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.errors.ORDER_CHANGED')),
      });
    } finally {
      setDismissing(null);
    }
  };

  const goTo = (sectionId: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {alerts.map((alert) => (
        <Alert
          key={alert.code}
          variant="danger"
          title={t(`ecommerce.orders.review.${alert.code}`)}
          closeLabel={t('ecommerce.orders.review.dismiss')}
        >
          <Flex direction="column" alignItems="flex-start" gap={2}>
            <Typography>
              {t(alert.reasonKey, {
                date: formatDate(alert.raisedAt, { dateStyle: 'short', timeStyle: 'short' }),
              })}
            </Typography>
            {alert.dismissable && (
              <Typography variant="pi">{t('ecommerce.orders.review.locked')}</Typography>
            )}
            <Flex gap={3} alignItems="center">
              <Link href={`#${alert.sectionId}`} onClick={goTo(alert.sectionId)}>
                {t('ecommerce.orders.review.goTo')}
              </Link>
              {alert.dismissable && canManage && (
                <Button
                  variant="secondary"
                  size="S"
                  loading={dismissing === alert.code}
                  disabled={dismissing !== null}
                  onClick={() => dismiss(alert.code)}
                >
                  {t('ecommerce.orders.review.dismiss')}
                </Button>
              )}
            </Flex>
          </Flex>
        </Alert>
      ))}
    </Flex>
  );
};

export default ReviewAlerts;
