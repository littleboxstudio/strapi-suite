import React from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Typography, SingleSelect, SingleSelectOption, Button } from '@strapi/design-system';
import {
  unstable_useContentManagerContext as useContentManagerContext,
  unstable_useDocumentActions as useDocumentActions,
} from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import FetchModuleSettings from '../core/usecases/fetchModuleSettings';
import FetchSlugs, { Output as OutputFetchSlugs } from '../core/usecases/fetchSlugs';
import FetchTemplates, { Output as OutputFetchTemplates } from '../core/usecases/fetchTemplates';
import FetchDocumentAttributes, {
  Output as OutputFetchAttribute,
} from '../core/usecases/fetchDocumentAttributes';
import { getTranslation } from '../core/utils/getTranslation';
import Registry from '../core/di/registry';
import Mediator, { Subscription } from '../core/mediator/mediator';
import PageAttributeUpdated from '../core/events/pageAttributeUpdated';
import DocumentCustomFieldStarted from '../core/events/documentCustomFieldStarted';
import config from '../core/config';
import DangerModal from './DangerModal';

const PageAttributesBox = ({ document }: any) => {
  const { formatMessage } = useIntl();
  const location = useLocation();
  const { form }: any = useContentManagerContext();
  const [selectedParent, setSelectedParent] = React.useState(-1);
  const [selectedTemplate, setSelectedTemplate] = React.useState(-1);
  const [selectedPriority, setSelectedPriority] = React.useState('no-priority');
  const [selectedFrequency, setSelectedFrequency] = React.useState('no-frequency');
  const [parents, setParents] = React.useState<OutputFetchSlugs[]>([]);
  const [templates, setTemplates] = React.useState<OutputFetchTemplates[]>([]);
  const [attributes, setAttributes] = React.useState<OutputFetchAttribute>();
  const [appSettings, setAppSettings] = React.useState<Record<string, any>>();
  const [showDangerModal, setShowDangerModal] = React.useState(false);
  const [showBox, setShowBox] = React.useState(false);
  const [currentLocale, setCurrentLocale] = React.useState(getCurrentLocate());

  function getCurrentLocate() {
    const queryString = window.location.search.split('?')[1];
    const searchParams = new URLSearchParams(queryString);
    return searchParams.get('plugins[i18n][locale]');
  }

  function changeParentEvent(index: number) {
    const parentContentId = index === -1 ? null : parents[index].contentId;
    const parentContentModel = index === -1 ? null : parents[index].contentModel;
    dispatchEvent('ltb_attribute_parent', parentContentId);
    dispatchEvent('ltb_attribute_parent_model', parentContentModel);
    setSelectedParent(index);
  }

  function changeTemplateEvent(index: number) {
    const templateId = index === -1 ? null : templates[index].documentId;
    dispatchEvent('ltb_attribute_template', templateId);
    setSelectedTemplate(index);
  }

  function changePriorityEvent(value: string) {
    const priority = value === 'no-priority' ? null : value;
    dispatchEvent('ltb_attribute_priority', priority);
    setSelectedPriority(value);
  }

  function changeFrequencyEvent(value: string) {
    const frequency = value === 'no-frequency' ? null : value;
    dispatchEvent('ltb_attribute_frequency', frequency);
    setSelectedFrequency(value);
  }

  function dispatchEvent(name: string, value: any) {
    const mockEvent = {
      target: { name, value },
    } as React.ChangeEvent<HTMLInputElement>;
    form.onChange(mockEvent);
  }

  async function fectchAttributes() {
    if (document && document.documentId) {
      const fetchDocumentAttributes = new FetchDocumentAttributes();
      const outputFetchDocumentAttributes = await fetchDocumentAttributes.execute(
        document.documentId,
        {
          locale: getCurrentLocate(),
          state: document.publishedAt ? 'published' : 'draft',
        }
      );
      setAttributes(outputFetchDocumentAttributes);
    }
  }

  async function fetchParents() {
    const fetchSlugs = new FetchSlugs();
    const outputFetchSlugs = await fetchSlugs.execute({ locale: getCurrentLocate() });
    const filteredParents: any = [];
    outputFetchSlugs.forEach((parent) => {
      if (!document || parent.contentId !== document.documentId) {
        filteredParents.push(parent);
      }
    });
    setParents(filteredParents);
  }

  async function fetchTemplates() {
    const fetchTemplates = new FetchTemplates();
    const outputFetchSlugs = await fetchTemplates.execute();
    setTemplates(outputFetchSlugs);
  }

  function buildPath(selectedIndex: number): string {
    const slugs: string[] = [];
    function findParentRecursively(index: number): void {
      const currentItem = parents[index];
      slugs.unshift(currentItem.slug);
      if (currentItem.parentContentId && currentItem.parentContentModel) {
        const parentIndex = parents.findIndex(
          (item) =>
            item.contentId === currentItem.parentContentId &&
            item.contentModel === currentItem.parentContentModel
        );
        if (parentIndex !== -1) {
          findParentRecursively(parentIndex);
        }
      }
    }
    findParentRecursively(selectedIndex);
    return slugs.join('/');
  }

  async function fetchSettings() {
    const fetchModuleSettings = new FetchModuleSettings();
    const settings = await fetchModuleSettings.execute('attribute');
    setAppSettings(settings);
  }

  React.useEffect(() => {
    if (attributes) {
      if (parents) {
        const index = parents.findIndex(
          (p: OutputFetchSlugs) =>
            p.contentId === attributes.parentContentId &&
            p.contentModel === attributes.parentContentModel
        );
        const showModal: boolean =
          index === -1 && attributes && attributes.parentContentId ? true : false;
        setSelectedParent(index);
        setShowDangerModal(showModal);
      }
      if (templates) {
        const index = templates.findIndex(
          (t: OutputFetchTemplates) => t.documentId === attributes.templateId
        );
        setSelectedTemplate(index);
      }
      setSelectedPriority(attributes.priority || 'no-priority');
      setSelectedFrequency(attributes.frequency || 'no-frequency');
    }
  }, [templates, parents, attributes]);

  React.useEffect(() => {
    if (parents.length > 0) {
      const value = selectedParent === -1 ? '' : buildPath(selectedParent);
      const mediator: Mediator = Registry.getInstance().inject('mediator');
      mediator.notify(new PageAttributeUpdated({ parentSlug: value }));
    }
  }, [selectedParent, parents]);

  React.useEffect(() => {
    fectchAttributes();
    fetchTemplates();
    fetchParents();
  }, [location]);

  React.useEffect(() => {
    const subscription: Subscription = Registry.getInstance()
      .inject('mediator')
      .subscribe(DocumentCustomFieldStarted.id, () => {
        setShowBox(true);
      });
    fetchSettings();
    return () => subscription.unsubscribe();
  }, []);

  if (!showBox || !currentLocale) return null;
  if (!appSettings || (appSettings && !appSettings.active)) return null;
  return {
    title: formatMessage({
      id: getTranslation(`module.${config.uuid.modules.attribute}.panel.title`),
      defaultMessage: 'Page Attributes',
    }),
    content: (
      <>
        <Box display="flex" style={{ flexDirection: 'column', width: '100%' }}>
          <Typography variant="sigma" style={{ marginTop: '5px', marginBottom: '6px' }}>
            {formatMessage({
              id: getTranslation(`module.${config.uuid.modules.attribute}.panel.parent.title`),
              defaultMessage: 'Parent',
            })}
          </Typography>
          <SingleSelect
            onChange={changeParentEvent}
            value={selectedParent}
            disabled={form.isSubmitting || form.disabled}
          >
            <SingleSelectOption value={-1}>
              {formatMessage({
                id: getTranslation(`module.${config.uuid.modules.attribute}.panel.parent.default`),
                defaultMessage: 'No parent',
              })}
            </SingleSelectOption>
            {parents.map((parent: any, index) => (
              <SingleSelectOption key={index} value={index}>
                {parent.contentTitle}
              </SingleSelectOption>
            ))}
          </SingleSelect>
          <Typography variant="sigma" style={{ marginTop: '20px', marginBottom: '6px' }}>
            {formatMessage({
              id: getTranslation(`module.${config.uuid.modules.attribute}.panel.attribute.title`),
              defaultMessage: 'Template',
            })}
          </Typography>
          <SingleSelect
            onChange={changeTemplateEvent}
            value={selectedTemplate}
            disabled={form.isSubmitting || form.disabled}
          >
            <SingleSelectOption value={-1}>
              {formatMessage({
                id: getTranslation(
                  `module.${config.uuid.modules.attribute}.panel.template.default`
                ),
                defaultMessage: 'No template',
              })}
            </SingleSelectOption>
            {templates.map((template: any, index) => (
              <SingleSelectOption key={index} value={index}>
                {template.name}
              </SingleSelectOption>
            ))}
          </SingleSelect>
          <Typography variant="sigma" style={{ marginTop: '20px', marginBottom: '6px' }}>
            {formatMessage({
              id: getTranslation(
                `module.${config.uuid.modules.attribute}.panel.attribute.sitemap.priority`
              ),
              defaultMessage: 'Priority',
            })}
          </Typography>
          <SingleSelect
            onChange={changePriorityEvent}
            value={selectedPriority}
            disabled={form.isSubmitting || form.disabled}
          >
            <SingleSelectOption value="no-priority">
              {formatMessage({
                id: getTranslation(
                  `module.${config.uuid.modules.attribute}.panel.priority.default`
                ),
                defaultMessage: 'No priority',
              })}
            </SingleSelectOption>
            <SingleSelectOption value="0.0">0.0</SingleSelectOption>
            <SingleSelectOption value="0.1">0.1</SingleSelectOption>
            <SingleSelectOption value="0.2">0.2</SingleSelectOption>
            <SingleSelectOption value="0.3">0.3</SingleSelectOption>
            <SingleSelectOption value="0.4">0.4</SingleSelectOption>
            <SingleSelectOption value="0.5">0.5</SingleSelectOption>
            <SingleSelectOption value="0.6">0.6</SingleSelectOption>
            <SingleSelectOption value="0.7">0.7</SingleSelectOption>
            <SingleSelectOption value="0.8">0.8</SingleSelectOption>
            <SingleSelectOption value="0.9">0.9</SingleSelectOption>
            <SingleSelectOption value="1.0">1.0</SingleSelectOption>
          </SingleSelect>
          <Typography variant="sigma" style={{ marginTop: '20px', marginBottom: '6px' }}>
            {formatMessage({
              id: getTranslation(
                `module.${config.uuid.modules.attribute}.panel.attribute.sitemap.frequency`
              ),
              defaultMessage: 'Change Frequency',
            })}
          </Typography>
          <SingleSelect
            onChange={changeFrequencyEvent}
            value={selectedFrequency}
            disabled={form.isSubmitting || form.disabled}
          >
            <SingleSelectOption value="no-frequency">
              {formatMessage({
                id: getTranslation(
                  `module.${config.uuid.modules.attribute}.panel.frequency.default`
                ),
                defaultMessage: 'No frequency',
              })}
            </SingleSelectOption>
            <SingleSelectOption value="always">Always</SingleSelectOption>
            <SingleSelectOption value="hourly">Hourly</SingleSelectOption>
            <SingleSelectOption value="daily">Daily</SingleSelectOption>
            <SingleSelectOption value="weekly">Weekly</SingleSelectOption>
            <SingleSelectOption value="monthly">Monthly</SingleSelectOption>
            <SingleSelectOption value="yearly">Yearly</SingleSelectOption>
            <SingleSelectOption value="never">Never</SingleSelectOption>
          </SingleSelect>
        </Box>
        <DangerModal
          open={showDangerModal}
          title={formatMessage({
            id: getTranslation(
              `module.${config.uuid.modules.attribute}.panel.attribute.parent-not-found.title`
            ),
            defaultMessage: 'Page Attributes',
          })}
          text={formatMessage({
            id: getTranslation(
              `module.${config.uuid.modules.attribute}.panel.attribute.parent-not-found.text`
            ),
            defaultMessage:
              'The parent no longer exists or is not active. Please select a valid parent.',
          })}
          button={formatMessage({
            id: getTranslation(
              `module.${config.uuid.modules.attribute}.panel.attribute.parent-not-found.button`
            ),
            defaultMessage: 'Ok, I will fix it',
          })}
        />
      </>
    ),
  };
};

export default PageAttributesBox;
