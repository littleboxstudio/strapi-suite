import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../core/utils/getTranslation';
import Card from '../components/Card';
import { ToneBadge } from '../ecommerce/components/orders/StatusBadges';
import FetchDuplicateRuns from './usecases/fetchDuplicateRuns';
import FetchDuplicateLocales from './usecases/fetchDuplicateLocales';
import { DuplicateModal } from './DuplicateModal';
import type { DuplicateLocales, DuplicateRun } from './gateway';
import { RUN_STATUS_VARIANT, latestRun, localeName } from './utils';

const CARD_REFRESH_MS = 5000;

type Props = {
  /** The e-commerce module is on (the modal then offers the e-commerce translations). */
  ecommerceActive: boolean;
};

/**
 * The dashboard card of Duplicate content: no on / off state, a one-line summary of the latest
 * run and the Duplicate button that opens the modal. Shown only with the duplicate.run permission.
 */
const DuplicateCard = ({ ecommerceActive }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);

  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<DuplicateRun | null>(null);
  const [locales, setLocales] = useState<DuplicateLocales | null>(null);

  const load = async () => {
    try {
      const [runs, data] = await Promise.all([
        new FetchDuplicateRuns().execute(),
        new FetchDuplicateLocales().execute(),
      ]);
      setLast(latestRun(runs));
      setLocales(data);
    } catch {
      // The line is optional: without it the card still opens the modal.
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // While the latest run is still going and the modal is closed, refresh the line now and then.
  const running = last?.status === 'RUNNING';
  useEffect(() => {
    if (!running || open) return undefined;
    const timer = setInterval(() => void load(), CARD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, open]);

  return (
    <>
      <Card
        title={t('duplicate.card.title')}
        subtitle={t('duplicate.card.description')}
        badge={t('app.free')}
        showStatus={false}
      >
        {last && (
          <Flex gap={2} alignItems="center" wrap="wrap" paddingBottom={3}>
            <ToneBadge variant={RUN_STATUS_VARIANT[last.status]}>{t(`duplicate.status.${last.status}`)}</ToneBadge>
            <Typography variant="pi" textColor="neutral600">
              {t('duplicate.card.lastRun', {
                date: formatDate(last.startedAt, { dateStyle: 'medium', timeStyle: 'short' }),
                target: localeName(locales?.locales, last.targetLocale),
              })}
            </Typography>
          </Flex>
        )}
        <Button size="L" variant="default" style={{ marginBottom: '8px' }} onClick={() => setOpen(true)}>
          {t('duplicate.card.button')}
        </Button>
      </Card>
      {open && (
        <DuplicateModal
          ecommerceActive={ecommerceActive}
          onClose={() => {
            setOpen(false);
            void load();
          }}
        />
      )}
    </>
  );
};

export { DuplicateCard };
