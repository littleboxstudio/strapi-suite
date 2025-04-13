import { useState, useEffect, Fragment } from 'react';
import { Box, TextInput, Field, Typography, SingleSelect, Card } from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled, { useTheme } from 'styled-components';
import { getTranslation } from '../../core/utils/getTranslation';
import { isEmpty, isNotEmpty } from '../../core/utils/isEmpty';
import config from '../../core/config';
import FetchSlugs, { Output as OutputFetchSlugs } from '../../core/usecases/fetchSlugs';
import { Item } from './types';
import { Tab } from '../../components/Tab';
import { SingleSelectOption } from '@strapi/design-system';

const BoxInput = styled(Box)`
  & > div {
    width: 100%;
  }
`;

const CustomTextInput = styled(TextInput)`
  border: none !important;
  width: 100% !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  input:focus {
    border: none !important;
  }
`;

const ActionButton = styled(Box)`
  width: 40px;
  justify-content: center;
  align-items: center;
  display: flex;
  border-left: ${({ $dark }) => ($dark ? '1px solid #32324d' : '1px solid #dcdce4')};
  cursor: pointer;
  &:hover {
    background-color: ${({ $dark }) => ($dark ? '#272732' : '#f0f0fa')};
  }
`;

type Form = {
  title: string;
  target: string;
  url?: string;
  contentId?: string;
  contentModel?: string;
  metadata?: Record<string, any>;
};

function MenuEditItem(props: {
  data: Item;
  locale: string;
  onChangeEvent: (data: Item) => void;
  onCheckEvent: (isValid: boolean) => void;
}) {
  const theme = useTheme();
  const [isDarkMode, setIsDarkMode] = useState(theme.colors.alternative100 === '#181826');
  const [module, setModule] = useState(config.uuid.modules.menu);
  const { formatMessage } = useIntl();
  const [form, setForm] = useState<Form | undefined>();
  const [contents, setContents] = useState<OutputFetchSlugs[]>([]);
  const [metadataForm, setMetadataForm] = useState({ property: '', value: '' });
  const [metadata, setMetadata] = useState<any>([]);

  async function fetchContentsWithSlug() {
    const fetchSlugs = new FetchSlugs();
    const outputFetchSlugs = await fetchSlugs.execute({ locale: props.locale });
    setContents(outputFetchSlugs);
  }

  function dispatchOnChangeEvent(form: Form) {
    console.log('dispatchOnChangeEvent:');
    console.log(form);
    if (
      !form ||
      (form && isEmpty(form.title)) ||
      (form && isEmpty(form.target)) ||
      (form && isEmpty(form.url) && isEmpty(form.contentId))
    ) {
      props.onCheckEvent(false);
    } else {
      props.onCheckEvent(true);
    }
    props.onChangeEvent({
      ...props.data,
      ...form,
    });
  }

  function addMetadata(property: string, value: string) {
    if (isNotEmpty(property) && isNotEmpty(value)) {
      const arrayMetadata = [...metadata, [property, value]];
      updateMetadata(arrayMetadata);
    }
  }

  function removeMetadata(index: number) {
    const arrayMetadata = [...metadata];
    arrayMetadata.splice(index, 1);
    updateMetadata(arrayMetadata);
  }

  function updatePropertyMetadata(index: number, value: string) {
    const arrayMetadata = [...metadata];
    arrayMetadata[index][0] = value;
    updateMetadata(arrayMetadata);
  }

  function updateValueMetadata(index: number, value: string) {
    const arrayMetadata = [...metadata];
    arrayMetadata[index][1] = value;
    updateMetadata(arrayMetadata);
  }

  function updateMetadata(updatedData: any) {
    const objectMetadata = Object.fromEntries(updatedData);
    const updatedForm: any = { ...form, metadata: objectMetadata };
    setForm(updatedForm);
    setMetadata(updatedData);
    setMetadataForm({ property: '', value: '' });
    dispatchOnChangeEvent(updatedForm);
  }

  useEffect(() => {
    setForm({
      title: props.data.title || '',
      url: props.data.url || '',
      contentId: props.data.contentId || '',
      contentModel: props.data.contentModel || '',
      target: props.data.target || '',
      metadata: props.data.metadata,
    });
    if (props.data.metadata) {
      setMetadata(Object.entries(props.data.metadata));
    }
  }, [props.data]);

  useEffect(() => {
    fetchContentsWithSlug();
  }, []);

  return (
    <>
      {form && (
        <Box
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            alignSelf: 'start',
            height: 'auto',
          }}
        >
          <Tab defaultTab="link">
            <Tab.Header>
              <Tab.Item value="link">
                {formatMessage({
                  id: getTranslation(`module.${module}.edit.link.title`),
                  defaultMessage: 'Link',
                })}
              </Tab.Item>
              <Tab.Item value="metadata">
                {formatMessage({
                  id: getTranslation(`module.${module}.edit.metadata.title`),
                  defaultMessage: 'Metadata',
                })}
              </Tab.Item>
            </Tab.Header>
            <Tab.Body value="link">
              <Box style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
                <span style={{ paddingBottom: '5px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.edit.input.title`),
                      defaultMessage: 'Title',
                    })}
                  </Typography>
                </span>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%' }}>
                  <TextInput
                    style={{ width: '100%' }}
                    value={form.title}
                    hasError={isEmpty(form.title)}
                    onChange={(e: any) => {
                      const updatedForm = { ...form, title: e.target.value };
                      setForm(updatedForm);
                      dispatchOnChangeEvent(updatedForm);
                    }}
                  />
                  <Field.Hint />
                  <Field.Error />
                </BoxInput>
                <span style={{ paddingBottom: '5px', paddingTop: '20px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.edit.input.url`),
                      defaultMessage: 'Url',
                    })}
                  </Typography>
                </span>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%' }}>
                  <TextInput
                    style={{ width: '100%' }}
                    value={form.url}
                    hasError={isEmpty(form.url) && isEmpty(form.contentId)}
                    onChange={(e: any) => {
                      const updatedForm = {
                        ...form,
                        url: e.target.value,
                        contentId: '',
                        contentModel: '',
                      };
                      setForm(updatedForm);
                      dispatchOnChangeEvent(updatedForm);
                    }}
                  />
                  <Field.Hint />
                  <Field.Error />
                </BoxInput>
                <span style={{ paddingBottom: '5px', paddingTop: '20px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.edit.input.content`),
                      defaultMessage: 'Content',
                    })}
                  </Typography>
                </span>
                <BoxInput
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}
                >
                  <SingleSelect
                    onChange={(value: any) => {
                      const content = contents.find((c) => c.contentId === value);
                      const updatedForm = {
                        ...form,
                        url: '',
                        contentId: content?.contentId,
                        contentModel: content?.contentModel,
                      };
                      setForm(updatedForm);
                      dispatchOnChangeEvent(updatedForm);
                    }}
                    value={form.contentId}
                    hasError={isEmpty(form.url) && isEmpty(form.contentId)}
                  >
                    <SingleSelectOption value={''}>
                      {formatMessage({
                        id: getTranslation(
                          `module.${config.uuid.modules.attribute}.edit.input.content.default`
                        ),
                        defaultMessage: 'No content',
                      })}
                    </SingleSelectOption>
                    {contents.map((content: any, index) => (
                      <SingleSelectOption key={index} value={content.contentId}>
                        {content.contentTitle}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  {isEmpty(form.url) && isEmpty(form.contentId) && (
                    <Typography variant="pi" style={{ color: '#ee5e52', paddingTop: '5px' }}>
                      {formatMessage({
                        id: getTranslation(`module.${module}.edit.input.content.error`),
                        defaultMessage: 'You must enter the URL or choose a content',
                      })}
                    </Typography>
                  )}
                </BoxInput>
                <span style={{ paddingBottom: '5px', paddingTop: '20px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.edit.input.target`),
                      defaultMessage: 'Target',
                    })}
                  </Typography>
                </span>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%' }}>
                  <SingleSelect
                    onChange={(value: any) => {
                      const updatedForm = { ...form, target: value };
                      setForm(updatedForm);
                      dispatchOnChangeEvent(updatedForm);
                    }}
                    value={form.target}
                  >
                    <SingleSelectOption value="_blank">_blank</SingleSelectOption>
                    <SingleSelectOption value="_self">_self</SingleSelectOption>
                    <SingleSelectOption value="_parent">_parent</SingleSelectOption>
                    <SingleSelectOption value="_top">_top</SingleSelectOption>
                  </SingleSelect>
                </BoxInput>
              </Box>
            </Tab.Body>
            <Tab.Body value="metadata">
              <Box style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
                <Box
                  style={{
                    width: '100%',
                    border: isDarkMode ? '1px solid #32324d' : '1px solid #dcdce4',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      backgroundColor: isDarkMode ? '#1a1a25' : '#f0f0fa',
                    }}
                  >
                    <Box
                      style={{
                        width: '100%',
                        display: 'flex',
                        padding: '8px 0 8px 12px',
                        borderRight: isDarkMode ? '1px solid #32324d' : '1px solid #dcdce4',
                      }}
                    >
                      <Typography variant="sigma">
                        {formatMessage({
                          id: getTranslation(`module.${module}.edit.metadata.table.property`),
                          defaultMessage: 'Property',
                        })}
                      </Typography>
                    </Box>
                    <Box style={{ width: '100%', display: 'flex', padding: '8px 0 8px 12px' }}>
                      <Typography variant="sigma">
                        {formatMessage({
                          id: getTranslation(`module.${module}.edit.metadata.table.value`),
                          defaultMessage: 'Value',
                        })}
                      </Typography>
                    </Box>
                  </Box>
                  {metadata.length === 0 && (
                    <Box
                      style={{
                        display: 'flex',
                        width: '100%',
                        padding: '12px 0 12px 12px',
                      }}
                    >
                      <Typography variant="sigma">
                        {formatMessage({
                          id: getTranslation(`module.${module}.edit.metadata.table.empty`),
                          defaultMessage: 'You have not added any properties yet...',
                        })}
                      </Typography>
                    </Box>
                  )}
                  <Box
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                    }}
                  >
                    {metadata.map((data: any, index: number) => (
                      <Fragment key={index}>
                        <Box
                          style={{
                            width: '100%',
                            display: 'flex',
                            borderRight: isDarkMode ? '1px solid #32324d' : '1px solid #dcdce4',
                            borderTop: isDarkMode ? '1px solid #32324d' : '1px solid #dcdce4',
                          }}
                        >
                          <CustomTextInput
                            value={data[0]}
                            onChange={(e: any) => updatePropertyMetadata(index, e.target.value)}
                          />
                        </Box>
                        <Box
                          style={{
                            width: '100%',
                            display: 'flex',
                            borderTop: isDarkMode ? '1px solid #32324d' : '1px solid #dcdce4',
                          }}
                        >
                          <Box style={{ flex: 1 }}>
                            <CustomTextInput
                              value={data[1]}
                              onChange={(e: any) => updateValueMetadata(index, e.target.value)}
                            />
                          </Box>
                          <ActionButton $dark={isDarkMode} onClick={() => removeMetadata(index)}>
                            <Trash />
                          </ActionButton>
                        </Box>
                      </Fragment>
                    ))}
                  </Box>
                  <Box
                    style={{
                      width: '100%',
                      padding: '8px 0 8px 12px',
                      backgroundColor: isDarkMode ? '#1a1a25' : '#f0f0fa',
                    }}
                  >
                    <Typography variant="sigma">
                      {formatMessage({
                        id: getTranslation(`module.${module}.edit.metadata.table.add`),
                        defaultMessage: 'Add new entry',
                      })}
                    </Typography>
                  </Box>
                  <Box
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      style={{
                        width: '100%',
                        display: 'flex',
                        borderRight: isDarkMode ? '1px solid #32324d' : '1px solid #dcdce4',
                      }}
                    >
                      <CustomTextInput
                        value={metadataForm.property}
                        onChange={(e: any) => {
                          setMetadataForm({ ...metadataForm, property: e.target.value });
                        }}
                      />
                    </Box>
                    <Box
                      style={{
                        width: '100%',
                        display: 'flex',
                      }}
                    >
                      <Box style={{ flex: 1 }}>
                        <CustomTextInput
                          value={metadataForm.value}
                          onChange={(e: any) => {
                            setMetadataForm({ ...metadataForm, value: e.target.value });
                          }}
                        />
                      </Box>
                      <ActionButton
                        $dark={isDarkMode}
                        onClick={() => addMetadata(metadataForm.property, metadataForm.value)}
                      >
                        <Plus />
                      </ActionButton>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Tab.Body>
          </Tab>
        </Box>
      )}
    </>
  );
}

export default MenuEditItem;
