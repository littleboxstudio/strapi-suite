import type { Core } from '@strapi/strapi';


function handleAttributes(attributes) { 
  const query: any = {};
  Object.keys(attributes).forEach((key) => {
    switch (attributes[key]['type']) { 
      case 'component':
        const componentData = strapi.components[attributes[key]['component']];
        query[key] = { populate: handleAttributes(componentData.attributes) }
        break;
      case 'media':
        query[key] = { populate: "*" }
        break;
      case 'relation':
        if (key === "roles" || key === "users" || key === "createdBy" || key === "updatedBy") break;
        query[key] = key === 'localizations'
          ? { populate: "*" }
          : { populate: populateQueryFromContentType(strapi, attributes[key]['target']) };
        break;
      case 'dynamiczone':
        const components = attributes[key]['components'];
        query[key] = { on: {} };
        components.forEach(component => { 
          const componentData = strapi.components[component];
          query[key]['on'][component] = { populate: handleAttributes(componentData.attributes) };
        });
        break;
      default:
        break;
    }
  });
  return Object.keys(query).length === 0 ? "*" : query;
}

export function populateQueryFromContentType(strapi: Core.Strapi, contentType: string) { 
  const attributes = strapi.contentTypes[contentType]['attributes'];
  const query = handleAttributes(attributes);
  return query;
}