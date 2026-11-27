import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Flex,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCronRuns from '../../usecases/settings/fetchCronRuns';
import { ToneBadge } from '../../components/orders/StatusBadges';
import type { CronRun, CronRunStatus } from '../../settingsTypes';

const STATUS_VARIANT: Record<CronRunStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  RUNNING: 'primary',
  SUCCESS: 'success',
  FAILED: 'danger',
  TIMEOUT: 'warning',
  INTERRUPTED: 'neutral',
};

const TASKS = ['guestSessions', 'customerSessions', 'linkTokens'] as const;

/** `1.2 s`, `3 min 4 s`; empty while the run has not finished. */
export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '';
  const ms = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/** Settings → Cron: the log of the scheduled jobs (newest 50 runs). Read-only. */
const CronSection = () => {
  const { formatMessage, formatDate } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [runs, setRuns] = useState<CronRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      setRuns(await new FetchCronRuns().execute());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const when = (iso: string) => formatDate(iso, { dateStyle: 'medium', timeStyle: 'medium' });

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={4}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <Typography variant="delta" tag="h2">
              {t('ecommerce.settings.cron.title')}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {t('ecommerce.settings.cron.description')}
            </Typography>
          </Flex>
          <Button
            variant="tertiary"
            startIcon={<ArrowClockwise />}
            onClick={() => void load()}
            loading={loading && runs !== null}
          >
            {t('ecommerce.settings.cron.refresh')}
          </Button>
        </Flex>

        {error && (
          <Typography textColor="danger600" role="alert">
            {t('ecommerce.settings.cron.error')}
          </Typography>
        )}

        {loading && runs === null && (
          <Flex justifyContent="center" padding={8}>
            <Loader />
          </Flex>
        )}

        {runs !== null && runs.length === 0 && (
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.settings.cron.empty')}
          </Typography>
        )}

        {runs !== null && runs.length > 0 && (
          <Table colCount={8} rowCount={runs.length}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.settings.cron.table.startedAt')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.settings.cron.table.job')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.settings.cron.table.status')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.settings.cron.table.duration')}</Typography>
                </Th>
                {TASKS.map((task) => (
                  <Th key={task}>
                    <Typography variant="sigma">{t(`ecommerce.settings.cron.task.${task}`)}</Typography>
                  </Th>
                ))}
                <Th>
                  <Typography variant="sigma">{t('ecommerce.settings.cron.table.failures')}</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {runs.map((run) => (
                <Tr key={run.id}>
                  <Td>
                    <Typography textColor="neutral800">{run.startedAt ? when(run.startedAt) : '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {t(`ecommerce.settings.cron.job.${run.job}`)}
                    </Typography>
                  </Td>
                  <Td>
                    <ToneBadge variant={STATUS_VARIANT[run.status]}>
                      {t(`ecommerce.settings.cron.status.${run.status}`)}
                    </ToneBadge>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {formatDuration(run.startedAt, run.finishedAt) || '—'}
                    </Typography>
                  </Td>
                  {TASKS.map((task) => (
                    <Td key={task}>
                      <Typography textColor="neutral800">
                        {run.status === 'SUCCESS' || run.status === 'FAILED'
                          ? (run.results[task] ?? 0)
                          : '—'}
                      </Typography>
                    </Td>
                  ))}
                  <Td>
                    <Typography textColor={run.failures.length ? 'danger600' : 'neutral600'}>
                      {run.failures.length
                        ? run.failures
                            .map((f) =>
                              t('ecommerce.settings.cron.failure', {
                                task: t(`ecommerce.settings.cron.task.${f.task}`),
                                error: f.error,
                              })
                            )
                            .join('; ')
                        : '—'}
                    </Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Flex>
    </Box>
  );
};

export { CronSection };
