/** Admin routes of the `ltbimage` custom field. Not a module: always available. */
export const IMAGE_FIELD_PERMISSIONS = {
  create: 'plugin::upload.assets.create',
  /** Additionally required (on that file) to use a Media Library file as the source. */
  read: 'plugin::upload.read',
  /** Required (on that file) to edit a file's alt text. */
  update: 'plugin::upload.assets.update',
} as const;

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path,
  handler: `ImageFieldModuleController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
  },
});

export default [
  route('POST', '/image-field/upload', 'upload', IMAGE_FIELD_PERMISSIONS.create),
  route('PUT', '/image-field/files/:id/alt', 'updateAlt', IMAGE_FIELD_PERMISSIONS.update),
];
