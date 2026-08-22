import * as React from 'react';
import { Box, Button } from '@strapi/design-system';
import { Sparkle } from '@strapi/icons';
import { unstable_useContentManagerContext as useContentManagerContext } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import config from '../core/config';
import { getTranslation } from '../core/utils/getTranslation';
import FetchModuleSettings from '../core/usecases/fetchModuleSettings';
import FetchLocales, { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import TranslateDocument, { Output, Result } from '../core/usecases/translateDocument';
import DocumentTranslateModal from './DocumentTranslateModal';

const DocumentTranslateBox = ({ document }: any) => {
  const { formatMessage } = useIntl();
  const context: any = useContentManagerContext();
  const [appSettings, setAppSettings] = React.useState<Record<string, any>>();
  const [i18nLocales, setI18nLocales] = React.useState<OutputFetchLocales[]>([]);
  const [showModal, setShowModal] = React.useState(false);
  const module = config.uuid.modules.translation;

  function getCurrentLocale() {
    const queryString = window.location.search.split('?')[1];
    const searchParams = new URLSearchParams(queryString);
    return searchParams.get('plugins[i18n][locale]');
  }

  function getCurrentStatus() {
    const queryString = window.location.search.split('?')[1];
    const searchParams = new URLSearchParams(queryString);
    return searchParams.get('status') || undefined;
  }

  async function fetchSettings() {
    const fetchModuleSettings = new FetchModuleSettings();
    setAppSettings(await fetchModuleSettings.execute(module));
  }

  async function fetchLocales() {
    const fetchLocales = new FetchLocales();
    setI18nLocales(await fetchLocales.execute());
  }

  function applyResults(results: Result[]) {
    results.forEach((result: Result) => {
      context.form.onChange(result.path, result.value);
      if (result.kind === 'slug') {
        context.form.onChange('ltb_slug', result.value);
      }
    });
  }

  function getDocumentId() {
    const documentId = document?.documentId || context.id;
    return documentId && documentId !== 'create' ? documentId : undefined;
  }

  async function translate(sourceLocale: string, overwrite: boolean): Promise<Output> {
    const translateDocument = new TranslateDocument();
    const output = await translateDocument.execute({
      collectionType: context.collectionType,
      model: context.model,
      documentId: context.isSingleType ? undefined : getDocumentId(),
      sourceLocale,
      targetLocale: getCurrentLocale() as string,
      status: getCurrentStatus(),
      attributes: context.contentType?.attributes,
      components: context.components,
      values: context.form.values,
      overwrite,
    });
    applyResults(output.results);
    return output;
  }

  React.useEffect(() => {
    fetchSettings();
    fetchLocales();
  }, []);

  const currentLocale = getCurrentLocale();
  const targetLocale = i18nLocales.find(
    (locale: OutputFetchLocales) => locale.code === currentLocale
  );
  const isLocalized = context.contentType?.pluginOptions?.i18n?.localized === true;

  if (!appSettings || !appSettings.active || !appSettings.aiEnabled) return null;
  if (!isLocalized || !currentLocale || i18nLocales.length < 2) return null;
  if (!context.contentType) return null;
  if (!context.isSingleType && !getDocumentId()) return null;

  return {
    title: formatMessage({
      id: getTranslation(`module.${module}.panel.title`),
      defaultMessage: 'Translation',
    }),
    content: (
      <>
        <Box display="flex" style={{ flexDirection: 'column', width: '100%' }}>
          <Button
            variant="secondary"
            startIcon={<Sparkle />}
            onClick={() => setShowModal(true)}
            disabled={context.form.isSubmitting || context.form.disabled}
            fullWidth
          >
            {formatMessage({
              id: getTranslation(`module.${module}.button.translate-with-ai`),
              defaultMessage: 'Translate with AI',
            })}
          </Button>
        </Box>
        <DocumentTranslateModal
          open={showModal}
          locales={i18nLocales}
          targetLocale={targetLocale}
          translate={translate}
          close={() => setShowModal(false)}
        />
      </>
    ),
  };
};

export default DocumentTranslateBox;
