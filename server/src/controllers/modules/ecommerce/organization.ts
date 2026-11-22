import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError } from './errors';

/** Admin API for categories, product types, tags and vendor suggestions. */
const EcommerceOrganizationController = ({ strapi }: { strapi: Core.Strapi }) => {
  const organization = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceOrganizationService');
  const toId = (ctx: any) => Number(ctx.params.id);
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);

  const labels = {
    category: { invalid: 'Invalid category', notFound: 'Category not found' },
    productType: { invalid: 'Invalid product type', notFound: 'Product type not found' },
    tag: { invalid: 'Invalid tag', notFound: 'Tag not found' },
  };
  type Label = keyof typeof labels;

  /** Runs `work`; maps domain errors (400/404/409). */
  const run = async (ctx: any, label: Label, work: () => Promise<void>) => {
    try {
      await work();
    } catch (err) {
      return handleDomainError(ctx, err, labels[label]);
    }
  };

  const created = (label: Label, method: string) => (ctx: any) =>
    run(ctx, label, async () => {
      const { id } = await organization()[method](ctx.request.body);
      ctx.status = 201;
      ctx.body = { id };
    });

  const noContent = (label: Label, method: string, withBody = true) => (ctx: any) =>
    run(ctx, label, async () => {
      await (withBody ? organization()[method](toId(ctx), ctx.request.body) : organization()[method](toId(ctx)));
      ctx.status = 204;
    });

  const page = (label: Label, method: string) => (ctx: any) =>
    run(ctx, label, async () => {
      const { page: p, search, locale } = ctx.query || {};
      ctx.body = await organization()[method]({ page: Number(p) || 1, search: text(search), locale: text(locale) });
    });

  return {
    listCategories: (ctx: any) =>
      run(ctx, 'category', async () => {
        ctx.body = await organization().listCategoryTree(text(ctx.query?.locale));
      }),
    getCategory: (ctx: any) =>
      run(ctx, 'category', async () => {
        ctx.body = await organization().getCategory(toId(ctx));
      }),
    createCategory: created('category', 'createCategory'),
    updateCategory: noContent('category', 'updateCategory'),
    moveCategory: noContent('category', 'moveCategory'),
    deleteCategory: noContent('category', 'deleteCategory', false),

    listProductTypes: page('productType', 'listProductTypes'),
    createProductType: created('productType', 'createProductType'),
    updateProductType: noContent('productType', 'updateProductType'),
    deleteProductType: noContent('productType', 'deleteProductType', false),

    listTags: page('tag', 'listTags'),
    createTag: created('tag', 'createTag'),
    updateTag: noContent('tag', 'updateTag'),
    deleteTag: noContent('tag', 'deleteTag', false),

    async listVendors(ctx: any) {
      ctx.body = await organization().listVendors(text(ctx.query?.search));
    },
  };
};

export default EcommerceOrganizationController;
