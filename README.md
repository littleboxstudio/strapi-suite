# Littlebox Strapi Suite

The Littlebox Strapi Suite is a plugin designed to enhance Strapi for building and managing institutional websites and blogs. It introduces features such as menu creation, string translations, parameter management, templates, page attributes, and content search via slugs.

For installation instructions and detailed documentation, please refer to:
[Before Starting - Littlebox Strapi Suite Documentation](https://strapi-suite.littlebox.pt/before-starting)

## Content type tabs

Organize the fields of a collection type or single type in tabs.

1. In the Content-Type Builder, open the content type settings and, under **Advanced settings → Tabs**, add, rename and reorder the tabs.
2. In the advanced settings of each field, pick the **Tab** where it is shown. Fields without a tab stay visible above the tabs.

The Content Manager edit view shows one tab at a time. Switching tabs keeps unsaved changes, and the active tab is kept in the URL hash (`#ltbTab=<key>`).

REST read requests (`find` and `findOne`) and the slugs module routes (`/api/littlebox-strapi-suite/modules/pages/home` and `/api/littlebox-strapi-suite/modules/pages?slug=...`) return the fields of each tab inside a property named after the tab. The name is converted to lowercase, accents are removed, spaces become `_` and other special characters are dropped (`"Loja - Vitrine"` → `loja_vitrine`):

```json
{
  "data": {
    "id": 1,
    "documentId": "abc",
    "title": "Home",
    "loja_vitrine": { "banner": {}, "produtos_destaque": [] }
  }
}
```

Notes:

- Only the root level of the response is grouped. `filters`, `sort`, `fields` and `populate` keep using the original field names.
- Renaming a tab changes its key in the API.
- A tab whose key is empty or conflicts with a root field is not grouped, and a warning is logged.
- Writes through the REST API and GraphQL are not affected.
