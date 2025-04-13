import config from '../config';

const getTranslation = (id: string) => `${config.pluginId}.${id}`;

export { getTranslation };
