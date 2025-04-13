import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { useIntl } from 'react-intl';
import {
  Box,
  Field,
  TextInput,
  useComposedRefs,
  Typography,
  Button,
  IconButton,
} from '@strapi/design-system';
import { Pin, Cross } from '@strapi/icons';
import {
  FieldValue,
  InputProps,
  useFocusInputField,
  unstable_useContentManagerContext as useContentManagerContext,
} from '@strapi/strapi/admin';
import styled from 'styled-components';
import config from '../core/config';
import { getTranslation } from '../core/utils/getTranslation';
import { convertToSlug } from '../core/utils/convertToSlug';
import FetchModuleSettings from '../core/usecases/fetchModuleSettings';
import FetchLocales, { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import { Subscription } from '../core/mediator/mediator';
import Registry from '../core/di/registry';
import PageAttributeUpdated, {
  PageAttributeUpdatedData,
} from '../core/events/pageAttributeUpdated';
import DocumentCustomFieldStarted from '../core/events/documentCustomFieldStarted';
import { PluginIcon } from './PluginIcon';

type Props = InputProps &
  FieldValue & {
    labelAction?: React.ReactNode;
    attribute?: {
      targetField: string;
    };
  };

const BoxInput = styled(Box)`
  & > div {
    width: 100%;
  }
`;

const Input = React.forwardRef<HTMLButtonElement, Props>(
  (
    {
      hint,
      disabled = false,
      labelAction,
      label,
      name,
      required = false,
      onChange,
      value,
      placeholder,
    },
    forwardedRef: any
  ) => {
    const { formatMessage } = useIntl();
    const fieldRef = useFocusInputField<HTMLInputElement>(name);
    const composedRefs = useComposedRefs(forwardedRef, fieldRef);
    const context: any = useContentManagerContext();
    const location = useLocation();
    const [currentI18nLocale, setCurrentI18nLocale] = React.useState<OutputFetchLocales>();
    const [showWarning, setShowWarning] = React.useState(false);
    const [i18nLocales, setI18nLocales] = React.useState<OutputFetchLocales[]>([]);
    const [editMode, setEditMode] = React.useState(false);
    const [parentSlug, setParentSlug] = React.useState('');
    const [appSettings, setAppSettings] = React.useState<Record<string, any>>();
    const [currentSlug, setCurrentSlug] = React.useState(value);
    const [slugBeforeEdit, setSlugBeforeEdit] = React.useState(value);
    const [attachedTitle, setAttachedTitle] = React.useState(!!!context.form.values[name]);

    function getCurrentLocate() {
      const queryString = window.location.search.split('?')[1];
      const searchParams = new URLSearchParams(queryString);
      return searchParams.get('plugins[i18n][locale]');
    }

    async function fetchLocales() {
      const fetchLocales = new FetchLocales();
      const fetchLocalesOutput = await fetchLocales.execute();
      setI18nLocales(fetchLocalesOutput);
    }

    async function fetchSettings() {
      const fetchModuleSettings = new FetchModuleSettings();
      const settings = await fetchModuleSettings.execute('slug');
      setAppSettings(settings);
    }

    function createChangeEvent(text: string) {
      const convertedText = convertToSlug(text);
      const mockChangeEvent = {
        target: {
          name: name,
          value: convertedText,
        },
      } as React.ChangeEvent<HTMLInputElement>;
      const mockLtbChangeEvent = {
        target: {
          name: 'ltb_slug',
          value: convertedText,
        },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange(mockChangeEvent);
      onChange(mockLtbChangeEvent);
      setCurrentSlug(convertedText);
    }

    React.useEffect(() => {
      const currentLocale = getCurrentLocate();
      const i18nLocale = i18nLocales.find((locale: any) => locale.code === currentLocale);
      setCurrentI18nLocale(i18nLocale);
      setShowWarning(!!!currentLocale);
    }, [context.form, i18nLocales]);

    React.useEffect(() => {
      if (attachedTitle && !context.form.isSubmitting) {
        createChangeEvent(context.form.values.title);
      }
      if (context.form.isSubmitting) {
        setAttachedTitle(false);
        setSlugBeforeEdit(context.form.values[name]);
      }
    }, [context.form]);

    React.useEffect(() => {
      if (!editMode) {
        setCurrentSlug(context.form.values[name]);
      }
    }, [context.form.values[name]]);

    React.useEffect(() => {
      setEditMode(false);
      setCurrentSlug(context.form.values[name]);
    }, [location]);

    React.useEffect(() => {
      const subscription: Subscription = Registry.getInstance()
        .inject('mediator')
        .subscribe(PageAttributeUpdated.id, (data: PageAttributeUpdatedData) => {
          const parentSlug = data.parentSlug.length > 1 ? `${data.parentSlug}/` : '';
          setParentSlug(parentSlug);
        });
      setTimeout(() =>
        Registry.getInstance().inject('mediator').notify(new DocumentCustomFieldStarted({ name }))
      );
      fetchLocales();
      fetchSettings();
      return () => subscription.unsubscribe();
    }, []);

    if (!appSettings || (appSettings && !appSettings.active)) return null;
    return (
      <>
        <Field.Root name={name} id={name} hint={hint} required={required}>
          <Field.Label action={labelAction}>{label}</Field.Label>
          {showWarning && (
            <Box
              style={{
                display: 'flex',
                flexDirection: 'row',
                width: '100%',
                alignItems: 'center',
                padding: '5px 12px',
                background: '#181826',
                borderRadius: '4px',
                borderStyle: 'solid',
                borderWidth: '1px',
                borderColor: '#4a4a6a',
              }}
            >
              <PluginIcon />
              <Typography
                variant="omega"
                style={{
                  display: 'flex',
                  height: '38px',
                  alignItems: 'center',
                  paddingLeft: '10px',
                  color: '#c93f3f',
                }}
              >
                {formatMessage({
                  id: getTranslation(`module.${config.uuid.modules.attribute}.field.slug.warning`),
                  defaultMessage: 'Activate internationalization to use this feature.',
                })}
              </Typography>
            </Box>
          )}
          {!showWarning && (
            <Box style={{ display: 'flex', flexDirection: 'row', width: '100%' }}>
              {appSettings && (
                <Box
                  style={{
                    width: 'auto',
                    marginRight: editMode ? '10px' : '0',
                    alignItems: 'center',
                    display: 'flex',
                  }}
                >
                  <Typography variant="omega" style={{ color: '#a5a5ba' }}>
                    {appSettings.showDefaultLanguage || !currentI18nLocale?.isDefault
                      ? `/${currentI18nLocale?.code}/${parentSlug}`
                      : `/${parentSlug}`}
                  </Typography>
                </Box>
              )}
              <Box style={{ flex: 1, alignItems: 'center', display: 'flex' }}>
                {!editMode && (
                  <Typography variant="omega" style={{ color: '#a5a5ba' }}>
                    {currentSlug}
                  </Typography>
                )}
                {editMode && (
                  <BoxInput
                    style={{ flex: 1, display: 'flex', width: '100%', marginRight: '10px' }}
                  >
                    <TextInput
                      style={{ width: '100%' }}
                      ref={composedRefs}
                      aria-label={formatMessage({
                        id: getTranslation(
                          `module.${config.uuid.modules.slug}.field.slug.aria-label`
                        ),
                        defaultMessage: 'Advanced Slug',
                      })}
                      value={value}
                      placeholder={placeholder}
                      onChange={(e: any) => createChangeEvent(e.target.value)}
                    />
                    <Field.Hint />
                    <Field.Error />
                  </BoxInput>
                )}
              </Box>
              <Box display="flex" style={{ minHeight: '40px' }}>
                {!editMode && (
                  <Box display="flex">
                    {!disabled && (
                      <>
                        {!attachedTitle && (
                          <IconButton
                            size="L"
                            variant="success-light"
                            aria-label={formatMessage({
                              id: getTranslation(
                                `module.${config.uuid.modules.slug}.field.slug.aria-label.attached`
                              ),
                              defaultMessage: 'Attach to title field',
                            })}
                            title={formatMessage({
                              id: getTranslation(
                                `module.${config.uuid.modules.slug}.field.slug.attached.title`
                              ),
                              defaultMessage: 'Attach to title field',
                            })}
                            onClick={() => {
                              setAttachedTitle(true);
                              createChangeEvent(context.form.values.title);
                            }}
                          >
                            <Pin />
                          </IconButton>
                        )}
                        <Button
                          style={{ marginLeft: '10px' }}
                          size="L"
                          variant="tertiary"
                          aria-label={formatMessage({
                            id: getTranslation(
                              `module.${config.uuid.modules.slug}.field.slug.aria-label.edit`
                            ),
                            defaultMessage: 'Edit slug',
                          })}
                          onClick={() => {
                            setEditMode(true);
                            setAttachedTitle(false);
                            setSlugBeforeEdit(value);
                          }}
                        >
                          {formatMessage({
                            id: getTranslation(
                              `module.${config.uuid.modules.slug}.field.slug.edit`
                            ),
                          })}
                        </Button>
                      </>
                    )}
                  </Box>
                )}
                {editMode && (
                  <>
                    <IconButton
                      size="L"
                      variant="danger-light"
                      aria-label={formatMessage({
                        id: getTranslation(
                          `module.${config.uuid.modules.slug}.field.aria-label.cancel`
                        ),
                        defaultMessage: 'Cancel edit',
                      })}
                      title={formatMessage({
                        id: getTranslation(
                          `module.${config.uuid.modules.slug}.field.slug.cancel.title`
                        ),
                        defaultMessage: 'Cancel edit',
                      })}
                      onClick={() => {
                        setEditMode(false);
                        if (slugBeforeEdit) {
                          createChangeEvent(slugBeforeEdit);
                        } else {
                          setAttachedTitle(true);
                          createChangeEvent(context.form.values.title);
                        }
                      }}
                    >
                      <Cross />
                    </IconButton>
                  </>
                )}
              </Box>
            </Box>
          )}
        </Field.Root>
      </>
    );
  }
);

export default Input;
