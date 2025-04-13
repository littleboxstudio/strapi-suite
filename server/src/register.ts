import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from './config/index';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.customFields.register({
    name: 'ltbslug',
    plugin: PLUGIN_ID,
    type: 'uid',
  });
};

export default register;
