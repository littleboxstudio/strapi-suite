import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
  Modal,
  Radio,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../core/utils/getTranslation';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from '../ecommerce/components/orders/NoticeBar';
import { ToneBadge } from '../ecommerce/components/orders/StatusBadges';
import FetchDuplicateLocales from './usecases/fetchDuplicateLocales';
import FetchDuplicateSummary from './usecases/fetchDuplicateSummary';
import StartDuplicateRun from './usecases/startDuplicateRun';
import FetchCurrentDuplicateRun from './usecases/fetchCurrentDuplicateRun';
import FetchDuplicateRuns from './usecases/fetchDuplicateRuns';
import type { DuplicateLocales, DuplicateRun, DuplicateStartInput, DuplicateSummary } from './gateway';
import {
  POLL_INTERVAL_MS,
  RUN_STATUS_VARIANT,
  currentLabel,
  defaultOptions,
  ecommerceRows,
  errorMessageKey,
  failureRows,
  localeName,
  namesFromSummary,
  progressPercent,
  reportCounts,
  startInput,
  summaryTotals,
  targetLocales,
  validateOptions,
} from './utils';

type Step = 'loading' | 'form' | 'review' | 'progress' | 'report' | 'loadError';

type Props = {
  /** The e-commerce module is on: the "Include e-commerce translations" choice is offered. */
  ecommerceActive: boolean;
  onClose: () => void;
};

/**
 * Duplicate content: the options, the summary to confirm, then the run's progress and report. A run
 * already in progress when the modal opens goes straight to its progress. Mount it only while open.
 */
const DuplicateModal = ({ ecommerceActive, onClose }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);

  const [step, setStep] = useState<Step>('loading');
  const [locales, setLocales] = useState<DuplicateLocales | null>(null);
  const [options, setOptions] = useState<DuplicateStartInput>(() => defaultOptions(null));
  const [summary, setSummary] = useState<DuplicateSummary | null>(null);
  const [run, setRun] = useState<DuplicateRun | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Shows the given run: its progress while running, its report once finished. */
  const showRun = (next: DuplicateRun) => {
    setRun(next);
    setRunId(next.id);
    setStep(next.status === 'RUNNING' ? 'progress' : 'report');
  };

  // Opening: a run in progress first, then the locales for the form.
  useEffect(() => {
    const open = async () => {
      try {
        const [current, data] = await Promise.all([
          new FetchCurrentDuplicateRun().execute(),
          new FetchDuplicateLocales().execute(),
        ]);
        if (!mounted.current) return;
        setLocales(data);
        setOptions(defaultOptions(data));
        if (current) showRun(current);
        else setStep('form');
      } catch (err) {
        if (!mounted.current) return;
        setError(errorMessageKey(err));
        setStep('loadError');
      }
    };
    void open();
  }, []);

  // Progress: asks for the running run every 2 s; once none runs, shows the report of ours.
  useEffect(() => {
    if (step !== 'progress') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const current = await new FetchCurrentDuplicateRun().execute();
        if (stopped || !mounted.current) return;
        if (current) {
          setRun(current);
          setRunId(current.id);
        } else {
          const runs = await new FetchDuplicateRuns().execute();
          if (stopped || !mounted.current) return;
          const finished = runs.find((r) => r.id === runId) ?? runs[0] ?? null;
          if (finished) {
            setRun(finished);
            setStep('report');
            return;
          }
        }
        setError(null);
      } catch (err) {
        if (stopped || !mounted.current) return;
        setError(errorMessageKey(err));
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, run ? POLL_INTERVAL_MS : 0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // Restarted only when the step changes; `runId` is read when the run ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const update = <K extends keyof DuplicateStartInput>(key: K, value: DuplicateStartInput[K]) => {
    setOptions((o) => ({ ...o, [key]: value }));
    setError(null);
  };

  const review = async () => {
    const invalid = validateOptions(options, locales);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = startInput(options, ecommerceActive);
      const result = await new FetchDuplicateSummary().execute(input.targetLocale, input.ecommerce);
      if (!mounted.current) return;
      setSummary(result);
      setStep('review');
    } catch (err) {
      if (mounted.current) setError(errorMessageKey(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const { runId: id } = await new StartDuplicateRun().execute(startInput(options, ecommerceActive));
      if (!mounted.current) return;
      setRun(null);
      setRunId(id);
      setStep('progress');
    } catch (err) {
      if (!mounted.current) return;
      const key = errorMessageKey(err);
      setError(key);
      // Another run started meanwhile: follow it.
      if (key === 'duplicate.errors.runInProgress') {
        try {
          const current = await new FetchCurrentDuplicateRun().execute();
          if (current && mounted.current) showRun(current);
        } catch {
          // The message stays; the user can close and reopen.
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const names = namesFromSummary(summary);
  const allLocales = locales?.locales ?? [];
  const sourceName = locales ? localeName(allLocales, locales.defaultLocale) : '';
  const when = (iso: string | null) =>
    iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const errorLine = error && (
    <Typography variant="pi" textColor="danger600" role="alert">
      {t(error)}
    </Typography>
  );

  const notice = (text: string) => (
    <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
      <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
        {text}
      </Typography>
    </Box>
  );

  const radioGroup = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    items: { value: string; label: string }[]
  ) => (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Typography variant="pi" fontWeight="bold" textColor="neutral800">
        {label}
      </Typography>
      <Radio.Group value={value} aria-label={label} onValueChange={onChange}>
        <Flex gap={6} wrap="wrap">
          {items.map((item) => (
            <Radio.Item key={item.value} value={item.value}>
              {item.label}
            </Radio.Item>
          ))}
        </Flex>
      </Radio.Group>
    </Flex>
  );

  const targets = targetLocales(locales);

  const form = (
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Flex gap={4} alignItems="flex-start" wrap="wrap">
        <Box style={{ flex: 1, minWidth: 200 }}>
          <Field.Root name="sourceLocale">
            <Field.Label>{t('duplicate.form.source')}</Field.Label>
            <TextInput value={sourceName} disabled aria-label={t('duplicate.form.source')} />
          </Field.Root>
        </Box>
        <Box style={{ flex: 1, minWidth: 200 }}>
          <Field.Root name="targetLocale" required>
            <Field.Label>{t('duplicate.form.target')}</Field.Label>
            <SingleSelect
              value={options.targetLocale || undefined}
              placeholder={t('duplicate.form.target.placeholder')}
              disabled={targets.length === 0}
              onChange={(value: string | number) => update('targetLocale', String(value))}
            >
              {targets.map((l) => (
                <SingleSelectOption key={l.code} value={l.code}>
                  {l.name}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>
      </Flex>
      {targets.length === 0 && (
        <Typography variant="pi" textColor="neutral600">
          {t('duplicate.form.noTargets')}
        </Typography>
      )}
      {radioGroup(
        t('duplicate.form.existing'),
        options.existing,
        (v) => update('existing', v === 'replace' ? 'replace' : 'skip'),
        [
          { value: 'skip', label: t('duplicate.form.existing.skip') },
          { value: 'replace', label: t('duplicate.form.existing.replace') },
        ]
      )}
      {radioGroup(
        t('duplicate.form.status'),
        options.status,
        (v) => update('status', v === 'draft' ? 'draft' : 'follow'),
        [
          { value: 'follow', label: t('duplicate.form.status.follow') },
          { value: 'draft', label: t('duplicate.form.status.draft') },
        ]
      )}
      {ecommerceActive && (
        <Checkbox
          checked={options.ecommerce}
          onCheckedChange={(checked: boolean | 'indeterminate') => update('ecommerce', checked === true)}
        >
          {t('duplicate.form.ecommerce')}
        </Checkbox>
      )}
      {errorLine}
    </Flex>
  );

  const countTable = (rows: { key: string; label: string; count: number }[], heading: string) => (
    <Table colCount={2} rowCount={rows.length}>
      <Thead>
        <Tr>
          <Th>
            <Typography variant="sigma">{heading}</Typography>
          </Th>
          <Th>
            <Typography variant="sigma">{t('duplicate.summary.count')}</Typography>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td>
              <Typography textColor="neutral800">{row.label}</Typography>
            </Td>
            <Td>
              <Typography textColor="neutral800">{row.count}</Typography>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );

  const reviewView = summary && (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Typography variant="omega" textColor="neutral800">
        {t('duplicate.summary.intro', {
          source: localeName(allLocales, summary.sourceLocale),
          target: localeName(allLocales, summary.targetLocale),
        })}
      </Typography>
      {summary.contentTypes.length === 0 ? (
        <Typography variant="omega" textColor="neutral600">
          {t('duplicate.summary.empty')}
        </Typography>
      ) : (
        countTable(
          summary.contentTypes.map((c) => ({ key: c.uid, label: c.displayName, count: c.count })),
          t('duplicate.summary.contentType')
        )
      )}
      {summary.ecommerce &&
        countTable(
          ecommerceRows(summary.ecommerce).map((r) => ({ key: r.key, label: t(r.labelKey), count: r.count })),
          t('duplicate.summary.ecommerce')
        )}
      <Typography variant="omega" fontWeight="bold" textColor="neutral800">
        {t('duplicate.summary.total', summaryTotals(summary))}
      </Typography>
      {summary.aiAvailable ? (
        <Typography variant="pi" textColor="neutral600">
          {t('duplicate.summary.ai')}
        </Typography>
      ) : (
        notice(t('duplicate.summary.noAi'))
      )}
      {errorLine}
    </Flex>
  );

  const runHeader = (r: DuplicateRun) => (
    <Flex gap={2} alignItems="center" wrap="wrap">
      <ToneBadge variant={RUN_STATUS_VARIANT[r.status]}>{t(`duplicate.status.${r.status}`)}</ToneBadge>
      <Typography variant="omega" textColor="neutral800">
        {t('duplicate.run.locales', {
          source: localeName(allLocales, r.sourceLocale),
          target: localeName(allLocales, r.targetLocale),
        })}
      </Typography>
    </Flex>
  );

  const progressView = (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {run ? runHeader(run) : null}
      {!run || run.progress.total === 0 ? (
        <Flex gap={3} alignItems="center">
          <Loader small />
          <Typography variant="omega" textColor="neutral600">
            {t('duplicate.progress.preparing')}
          </Typography>
        </Flex>
      ) : (
        <>
          <Typography variant="omega" textColor="neutral800">
            {t('duplicate.progress.done', {
              done: run.progress.done,
              total: run.progress.total,
              percent: progressPercent(run.progress),
            })}
          </Typography>
          {run.progress.current && (
            <Typography variant="pi" textColor="neutral600" ellipsis>
              {t('duplicate.progress.current', { document: currentLabel(run.progress.current, names) })}
            </Typography>
          )}
          {run.counts.failed > 0 && (
            <Typography variant="pi" textColor="danger600">
              {t('duplicate.progress.failed', { count: run.counts.failed })}
            </Typography>
          )}
        </>
      )}
      <Typography variant="pi" textColor="neutral600">
        {t('duplicate.progress.background')}
      </Typography>
      {errorLine}
    </Flex>
  );

  const failures = failureRows(run?.failures, names);

  const reportView = run && (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {runHeader(run)}
      <Typography variant="pi" textColor="neutral600">
        {t('duplicate.report.when', { started: when(run.startedAt), finished: when(run.finishedAt) })}
      </Typography>
      {(run.aiErrors?.length ?? 0) > 0 && (
        <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }} role="alert">
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <Typography variant="omega" fontWeight="bold" style={{ color: NOTICE_TEXT }}>
              {t('duplicate.report.aiErrors')}
            </Typography>
            {run.aiErrors!.map((message) => (
              <Typography key={message} variant="omega" style={{ color: NOTICE_TEXT }}>
                {message}
              </Typography>
            ))}
          </Flex>
        </Box>
      )}
      <Table colCount={2} rowCount={5}>
        <Tbody>
          {reportCounts(run.counts).map((row) => (
            <Tr key={row.key}>
              <Td>
                <Typography textColor="neutral800">{t(row.labelKey)}</Typography>
              </Td>
              <Td>
                <Typography
                  textColor={row.key === 'failed' && row.value > 0 ? 'danger600' : 'neutral800'}
                  fontWeight="bold"
                >
                  {row.value}
                </Typography>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      {failures.length > 0 && (
        <Flex direction="column" alignItems="stretch" gap={2}>
          <Typography variant="delta" tag="h3">
            {t('duplicate.report.failures')}
          </Typography>
          <Table colCount={3} rowCount={failures.length}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t('duplicate.report.table.contentType')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('duplicate.report.table.document')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('duplicate.report.table.reason')}</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {failures.map((f) => (
                <Tr key={f.key}>
                  <Td>
                    <Typography textColor="neutral800">{f.contentType || '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{f.document || '—'}</Typography>
                  </Td>
                  <Td style={{ whiteSpace: 'normal' }}>
                    <Typography textColor={f.note ? 'neutral600' : 'danger600'}>
                      {f.note ? t('duplicate.report.note', { reason: f.reason }) : f.reason}
                    </Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Flex>
      )}
    </Flex>
  );

  const close = (
    <Button variant="tertiary" onClick={onClose}>
      {t(step === 'form' || step === 'review' ? 'duplicate.cancel' : 'duplicate.close')}
    </Button>
  );

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content style={{ maxWidth: 760, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{t('duplicate.modal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {step === 'loading' && (
            <Flex justifyContent="center" padding={8}>
              <Loader />
            </Flex>
          )}
          {step === 'loadError' && errorLine}
          {step === 'form' && form}
          {step === 'review' && reviewView}
          {step === 'progress' && progressView}
          {step === 'report' && reportView}
        </Modal.Body>
        <Modal.Footer>
          {close}
          {step === 'form' && (
            <Button variant="secondary" onClick={() => void review()} loading={busy} disabled={targets.length === 0}>
              {t('duplicate.review')}
            </Button>
          )}
          {step === 'review' && (
            <Flex gap={2}>
              <Button
                variant="tertiary"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStep('form');
                }}
              >
                {t('duplicate.back')}
              </Button>
              <Button variant="secondary" onClick={() => void confirm()} loading={busy}>
                {t('duplicate.confirm')}
              </Button>
            </Flex>
          )}
          {step === 'report' && (
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setSummary(null);
                setRun(null);
                setRunId(null);
                setStep('form');
              }}
            >
              {t('duplicate.again')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { DuplicateModal };
