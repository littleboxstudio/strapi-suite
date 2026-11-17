import { Children, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Flex } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import DismissReviewFlag from '../../usecases/orders/dismissReviewFlag';
import { reviewAlertDate, reviewAlerts } from '../../utils/orderEditing';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, Order } from '../../orderTypes';
import NoticeBar from './NoticeBar';


type Props = {
  order: Order;
  /** `orders.manage`: only then can a flag be dismissed. */
  canManage: boolean;
  /** The server's answer to a dismissal (the updated order). */
  onResult: (result: EditResult) => void;
  /** Other notices of the page, shown after the review alerts in the same stack (12px apart). */
  children?: ReactNode;
};

/** One red alert per open review flag, at the top of the order page. */
const ReviewAlerts = ({ order, canManage, onResult, children }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const alerts = reviewAlerts(order);
  // Conditional notices arrive as `false` entries: with none to show, nothing is rendered (an
  // empty wrapper would add the page's gap twice).
  const notices = Children.toArray(children);
  if (alerts.length === 0 && notices.length === 0) return null;

  const dismiss = async (code: (typeof alerts)[number]['code']) => {
    if (dismissing) return;
    setDismissing(code);
    try {
      onResult(await new DismissReviewFlag().execute(order.id, code, { operationId: mintUuid() }));
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.review.dismissError')),
      });
    } finally {
      setDismissing(null);
    }
  };

  /** Title, reason and (when it can no longer be fixed) why, as sentences on one line. */
  const alertText = (alert: { messageKey: string; locked: boolean }, reason: string) =>
    [
      t(alert.messageKey),
      reason,
      alert.locked ? t('ecommerce.orders.review.locked') : null,
    ]
      .filter(Boolean)
      .join(' ');

  const goTo = (sectionId: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {alerts.map((alert) => {
        const date = reviewAlertDate(alert.raisedAt);
        const reason = date
          ? t(alert.reasonKey, { date: formatDate(date, { dateStyle: 'short', timeStyle: 'short' }) })
          : t(alert.reasonKey.replace('.review.reason.', '.review.reasonNoDate.'));
        return (
          <NoticeBar
            key={alert.code}
            text={alertText(alert, reason)}
            actions={
              <>
                {/* The shipping alert can be marked as seen while the order is still editable. */}
                {!alert.dismissable && alert.code === 'SHIPPING_REVIEW' && canManage && (
                  <Button
                    variant="tertiary"
                    size="S"
                    loading={dismissing === alert.code}
                    disabled={dismissing !== null}
                    onClick={() => dismiss(alert.code)}
                  >
                    {t('ecommerce.orders.shippingCharges.markSeen')}
                  </Button>
                )}
                {alert.dismissable && canManage && (
                  <Button
                    variant="tertiary"
                    size="S"
                    loading={dismissing === alert.code}
                    disabled={dismissing !== null}
                    onClick={() => dismiss(alert.code)}
                  >
                    {t('ecommerce.orders.review.dismiss')}
                  </Button>
                )}
                <Button variant="secondary" size="S" onClick={goTo(alert.sectionId)}>
                  {t('ecommerce.orders.review.goTo')}
                </Button>
              </>
            }
          />
        );
      })}
      {notices}
    </Flex>
  );
};

export default ReviewAlerts;
