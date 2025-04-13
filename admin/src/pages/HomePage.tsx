import { Main, Button } from '@strapi/design-system';
import { ExternalLink } from '@strapi/icons';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import config from '../core/config';
import { getTranslation } from '../core/utils/getTranslation';
import HeaderLayout from '../components/HeaderLayout';
import Card from '../components/Card';
import BoxGrid from '../components/BoxGrid';
import { useSettings } from '../contexts/settings';

const HomePage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const settings = useSettings();

  return (
    <Main
      style={{
        width: '100%',
        padding: '40px 50px',
      }}
    >
      <HeaderLayout breadcrumbs={[{ title: 'Suite Modules', link: `/plugins/${config.pluginId}` }]}>
        <Button
          size="S"
          variant="tertiary"
          style={{ marginRight: '10px' }}
          endIcon={<ExternalLink />}
          onClick={() => window.open('https://strapi.littlebox.pt', '_blank')}
        >
          {formatMessage({ id: getTranslation('app.documentation') })}
        </Button>
        <Button
          variant="tertiary"
          endIcon={<ExternalLink />}
          onClick={() => window.open('https://littlebox.pt', '_blank')}
        >
          {formatMessage({ id: getTranslation('app.website-cta') })}
        </Button>
      </HeaderLayout>

      <BoxGrid style={{ paddingTop: '40px' }}>
        <Card
          title={formatMessage({ id: getTranslation(`module.${config.uuid.modules.menu}.name`) })}
          subtitle={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.menu}.description`),
          })}
          badge={formatMessage({ id: getTranslation('app.free') })}
          active={settings.provide(config.uuid.modules.menu).active}
        >
          <Button
            size="L"
            variant="tertiary"
            style={{ marginBottom: '8px' }}
            onClick={() => navigate(`/plugins/${config.pluginId}/menu`)}
          >
            {formatMessage({ id: getTranslation('app.configurations') })}
          </Button>
        </Card>

        <Card
          title={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.attribute}.name`),
          })}
          subtitle={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.attribute}.description`),
          })}
          badge={formatMessage({ id: getTranslation('app.free') })}
          active={settings.provide(config.uuid.modules.attribute).active}
        >
          <Button
            size="L"
            variant="tertiary"
            style={{ marginBottom: '8px' }}
            onClick={() => navigate(`/plugins/${config.pluginId}/attribute`)}
          >
            {formatMessage({ id: getTranslation('app.configurations') })}
          </Button>
        </Card>

        <Card
          title={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.parameter}.name`),
          })}
          subtitle={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.parameter}.description`),
          })}
          badge={formatMessage({ id: getTranslation('app.free') })}
          active={settings.provide(config.uuid.modules.parameter).active}
        >
          <Button
            size="L"
            variant="tertiary"
            style={{ marginBottom: '8px' }}
            onClick={() => navigate(`/plugins/${config.pluginId}/parameter`)}
          >
            {formatMessage({ id: getTranslation('app.configurations') })}
          </Button>
        </Card>

        <Card
          title={formatMessage({ id: getTranslation(`module.${config.uuid.modules.slug}.name`) })}
          subtitle={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.slug}.description`),
          })}
          badge={formatMessage({ id: getTranslation('app.free') })}
          active={settings.provide(config.uuid.modules.slug).active}
        >
          <Button
            size="L"
            variant="tertiary"
            style={{ marginBottom: '8px' }}
            onClick={() => navigate(`/plugins/${config.pluginId}/slug`)}
          >
            {formatMessage({ id: getTranslation('app.configurations') })}
          </Button>
        </Card>

        <Card
          title={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.translation}.name`),
          })}
          subtitle={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.translation}.description`),
          })}
          badge={formatMessage({ id: getTranslation('app.free') })}
          active={settings.provide(config.uuid.modules.translation).active}
        >
          <Button
            size="L"
            variant="tertiary"
            style={{ marginBottom: '8px' }}
            onClick={() => navigate(`/plugins/${config.pluginId}/translation`)}
          >
            {formatMessage({ id: getTranslation('app.configurations') })}
          </Button>
        </Card>

        <Card
          title={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.template}.name`),
          })}
          subtitle={formatMessage({
            id: getTranslation(`module.${config.uuid.modules.template}.description`),
          })}
          badge={formatMessage({ id: getTranslation('app.free') })}
          active={settings.provide(config.uuid.modules.template).active}
        >
          <Button
            size="L"
            variant="tertiary"
            style={{ marginBottom: '8px' }}
            onClick={() => navigate(`/plugins/${config.pluginId}/template`)}
          >
            {formatMessage({ id: getTranslation('app.configurations') })}
          </Button>
        </Card>
      </BoxGrid>
    </Main>
  );
};

export { HomePage };
