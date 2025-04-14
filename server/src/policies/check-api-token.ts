export default async (policyContext, config, { strapi }) => {
  const bearerToken = policyContext.request.header?.authorization?.substring('Bearer '.length);
  if (!bearerToken) {
    return false;
  }
  const apiTokenService = strapi.services['admin::api-token'];
  const accessKey = await apiTokenService.hash(bearerToken);
  const storedToken = await apiTokenService.getBy({accessKey: accessKey});
  if (!storedToken) {
    return false;
  }
  if (storedToken.expiresAt && storedToken.expiresAt < new Date()) {
    return false;
  }
  if (storedToken.type !== 'read-only') {
    return false;
  }
  return true;
};