import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import DismissReviewFlag from '../../usecases/orders/dismissReviewFlag';
import { reviewAlertDate, reviewAlerts } from '../../utils/orderEditing';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, Order } from '../../orderTypes';

/** The review alert's colours: a fixed dark amber background with white text. */
const ALERT_BACKGROUND = '#43311a';
const ALERT_TEXT = '#ffffff';

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
        message: t(apiErrorMessageId(err, 'ecommerce.orders.review.dismissError')),
      });
    } finally {
      setDismissing(null);
    }
  };

  /** Title, reason and (when it can no longer be fixed) why, as sentences on one line. */
  const alertText = (alert: { code: string; dismissable: boolean }, reason: string) =>
    [
      t(`ecommerce.orders.review.${alert.code}`),
      reason,
      alert.dismissable ? t('ecommerce.orders.review.locked') : null,
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
          <Box
            key={alert.code}
            role="alert"
            hasRadius
            paddingTop={2}
            paddingBottom={2}
            paddingLeft={4}
            paddingRight={2}
            // Fixed warning colour, the same in light and dark mode; the text stays white on it.
            style={{ background: ALERT_BACKGROUND, color: ALERT_TEXT }}
          >
            <Flex gap={3} alignItems="center" justifyContent="space-between">
              {/* One line: what to review, why and since when; a long text ends in an ellipsis. */}
              <Typography
                variant="omega"
                ellipsis
                title={alertText(alert, reason)}
                style={{ color: ALERT_TEXT, fontWeight: 'normal', minWidth: 0, flex: 1 }}
              >
                {alertText(alert, reason)}
              </Typography>
              <Flex gap={2} alignItems="center" shrink={0}>
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
              </Flex>
            </Flex>
          </Box>
        );
      })}
    </Flex>
  );
};

export default ReviewAlerts;
