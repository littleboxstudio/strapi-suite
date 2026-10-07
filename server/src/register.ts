import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from './config/index';
import { createTabsMiddleware } from './middlewares/tabs';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.customFields.register({
    name: 'ltbslug',
    plugin: PLUGIN_ID,
    type: 'uid',
  });

  // Registered during `register` so it runs before the router, which is mounted in `bootstrap`.
  strapi.server.use(createTabsMiddleware({ strapi }));
};

export default register;
