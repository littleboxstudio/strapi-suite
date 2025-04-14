## ✨ Features

- **Menus**: powerful menu management tool to create, customize, and organize menus for seamless navigation.
- **Translations**: simplify and organize string translations for efficient multilingual content management and smooth integration.
- **Slug**: optimize URLs with smart, SEO-friendly slugs for better rankings and cleaner links effortlessly.
- **Sitemap**: a way to set the properties to generate the sitemap.
- **Page attributes**: a way to set page properties like templates or parent pages to automatically create full slugs.
- **Parameters**: effortlessly manage and customize settings with a intuitive and flexible solution.

&nbsp;
&nbsp;
&nbsp;
## ⏳ Installation

Install the plugin in your Strapi project.

```bash
# using yarn
yarn add @littlebox/strapi-suite

# using npm
npm install @littlebox/strapi-suite --save
```

&nbsp;
&nbsp;
&nbsp;
## 🖐 Requirements

The full installation requirements are identical to those of Strapi and can be found in the [Strapi Quick Start guide](https://docs.strapi.io/cms/quick-start).

**Supported Strapi versions**:

- Strapi ^5.0.0

&nbsp;
&nbsp;
&nbsp;
## 💡 Usage
With this plugin, you can add new features to Strapi. It makes it easier to manage menus, create slugs, generate sitemaps, set public and private parameters, translate strings, and define page settings. Use our [ready-to-go Next.js frontend](https://github.com/littleboxstudio/strapi-frontend) to take advantage of these solutions.


### Menus
Powerful menu management tool to create, customize, and organize menus for seamless navigation. Use drag and drop to build menus in a simple and intuitive way.

![Menu](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/menu.png?raw=true)

![Menu edit](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/menu-edit.png?raw=true)

![Menu edit metadata](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/menu-edit-metadata.png?raw=true)

To get the data from the frontend, use your preferred HTTP client:

```
GET /api/littlebox-strapi-suite/modules/menus?locale=<LOCALE>
```
```
[
    {
        "id": 1,
        "documentId": "rvycb4q234yqz47g1v69mzkm",
        "title": "Header",
        "uid": "header",
        "locale": "en",
        "createdAt": "2025-04-13T19:43:24.092Z",
        "updatedAt": "2025-04-13T19:48:35.207Z",
        "publishedAt": "2025-04-13T19:43:24.092Z",
        "children": [
            {
                "id": 1,
                "documentId": "k6phd1g4cf7ysqw527ok78d5",
                "menuId": "rvycb4q234yqz47g1v69mzkm",
                "parentId": null,
                "title": "Experiences",
                "url": "experiences",
                "target": "_self",
                "order": 1,
                "metadata": {},
                "createdAt": "2025-04-13T19:48:35.216Z",
                "updatedAt": "2025-04-13T19:48:35.216Z",
                "publishedAt": "2025-04-13T19:48:35.216Z",
                "children": [
                    {
                        "id": 2,
                        "documentId": "leb5vbdlthaw9uvbfo8njwsv",
                        "menuId": "rvycb4q234yqz47g1v69mzkm",
                        "parentId": "1",
                        "title": "Dolphin Watching",
                        "url": "experiences/dolphin-watching",
                        "target": "_blank",
                        "order": 1,
                        "metadata": {},
                        "createdAt": "2025-04-13T19:48:35.224Z",
                        "updatedAt": "2025-04-13T19:48:35.224Z",
                        "publishedAt": "2025-04-13T19:48:35.225Z",
                        "children": []
                    }
                ]
            },
            {
                "id": 3,
                "documentId": "zakerhh8fx912il34lxkj04f",
                "menuId": "rvycb4q234yqz47g1v69mzkm",
                "parentId": null,
                "title": "Transfer",
                "url": "transfer",
                "target": "_self",
                "order": 2,
                "metadata": {},
                "createdAt": "2025-04-13T19:48:35.234Z",
                "updatedAt": "2025-04-13T19:48:35.234Z",
                "publishedAt": "2025-04-13T19:48:35.234Z",
                "children": []
            }
        ]
    }
]
```

&nbsp;
&nbsp;
&nbsp;
### Translations
Simplify and organize string translations for efficient multilingual content management and smooth integration.

![Translation](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/translation.png?raw=true)

To get the data from the frontend, use your preferred HTTP client:

```
GET /api/littlebox-strapi-suite/modules/translations
```
```
[
    {
        "id": 5,
        "uid": "About us",
        "translations": {
            "en": "About us",
            "pt": "Sobre nós"
        }
    },
    {
        "id": 3,
        "uid": "Book now",
        "translations": {
            "en": "Book now",
            "pt": "Reserve agora"
        }
    }
]
```

&nbsp;
&nbsp;
&nbsp;
### Slug
Optimize URLs with smart, SEO-friendly slugs for better rankings and cleaner links effortlessly.

![Slug](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/slug.png?raw=true)

![Slug edit](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/slug-edit.png?raw=true)

![Slug attach](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/slug-attach.png?raw=true)

![Slug custom field](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/slug-custom-field.png?raw=true)

![Slug settings](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/slug-settings.png?raw=true)

This lets you get data from a document (either a collection or single content) using the slug. To get the data from the frontend, use your preferred HTTP client:

```
GET /api/littlebox-strapi-suite/modules/pages?slug=<SLUG>
```
```
{
    "document": {
        "id": 26,
        "documentId": "i111r5p3pa73r6tm71b7lh86",
        "title": "Littlebox Suite helped me build websites faster",
        "slug": "news/littlebox-suite-helped-me-build-websites-faster",
        "createdAt": "2025-04-13T21:32:18.148Z",
        "updatedAt": "2025-04-13T21:50:12.142Z",
        "publishedAt": "2025-04-13T21:50:12.161Z",
        "locale": "en",
        "localizations": [
            {
                "id": 27,
                "documentId": "i111r5p3pa73r6tm71b7lh86",
                "title": "Littlebox Suite ajudou-me a construir sites mais rápido",
                "slug": "pt/noticias/littlebox-suite-ajudou-me-a-construir-sites-mais-rapido",
                "createdAt": "2025-04-13T21:37:55.693Z",
                "updatedAt": "2025-04-13T22:05:35.160Z",
                "publishedAt": "2025-04-13T22:05:35.185Z",
                "locale": "pt"
            }
        ]
    }
}
```
**Note**: The default language won't show up in the URL slug if the `SHOW LANGUAGE SLUG` setting is turned off in the slug module settings (see screenshot above).

&nbsp;
&nbsp;
&nbsp;
### Page Attributes
A way to set page properties like templates or parent pages to automatically create full slugs.

![Page Attributes](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/page-attributes.png?raw=true)

![Page Attributes slug](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/page-attributes-slug.png?raw=true)

![Page Attributes parent](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/page-attributes-parent.png?raw=true)

To get the data from the frontend, use your preferred HTTP client:

```
GET /api/littlebox-strapi-suite/modules/pages?slug=<SLUG>&properties=attributes
```
```
{
    "document": {
        "id": 26,
        "documentId": "i111r5p3pa73r6tm71b7lh86",
        "title": "Littlebox Suite helped me build websites faster",
        "slug": "news/littlebox-suite-helped-me-build-websites-faster",
        "createdAt": "2025-04-13T21:32:18.148Z",
        "updatedAt": "2025-04-13T21:50:12.142Z",
        "publishedAt": "2025-04-13T21:50:12.161Z",
        "locale": "en",
        "localizations": [
            {
                "id": 27,
                "documentId": "i111r5p3pa73r6tm71b7lh86",
                "title": "Littlebox Suite ajudou-me a construir sites mais rápido",
                "slug": "pt/noticias/littlebox-suite-ajudou-me-a-construir-sites-mais-rapido",
                "createdAt": "2025-04-13T21:37:55.693Z",
                "updatedAt": "2025-04-13T22:05:35.160Z",
                "publishedAt": "2025-04-13T22:05:35.185Z",
                "locale": "pt"
            }
        ]
    },
    "attributes": {
        "template": "default",
        "priority": "0.5",
        "frequency": "never",
        "parent": {
            "id": "wnzxub0s3ghckznjdkshgcw7",
            "model": "api::page.page"
        }
    }
}
```

&nbsp;
&nbsp;
&nbsp;
### Sitemap
A way to set the properties for generating the sitemap on the frontend.
To get the data from the frontend, use your preferred HTTP client:

```
GET /api/littlebox-strapi-suite/modules/pages?properties=attributes
```
```
[
    {
        "id": "wnzxub0s3ghckznjdkshgcw7",
        "model": "api::page.page",
        "slug": "news",
        "locale": "en",
        "attributes": {
            "template": "default",
            "priority": "1.0",
            "frequency": "weekly"
        }
    },
    {
        "id": "wnzxub0s3ghckznjdkshgcw7",
        "model": "api::page.page",
        "slug": "noticias",
        "locale": "pt",
        "attributes": {
            "template": "default",
            "priority": "1.0",
            "frequency": "weekly"
        }
    },
    {
        "id": "i111r5p3pa73r6tm71b7lh86",
        "model": "api::page.page",
        "slug": "news/littlebox-suite-helped-me-build-websites-faster",
        "locale": "en",
        "attributes": {
            "template": "default",
            "priority": "1.0",
            "frequency": "yearly",
            "parent": {
                "id": "wnzxub0s3ghckznjdkshgcw7",
                "model": "api::page.page"
            }
        }
    },
    {
        "id": "i111r5p3pa73r6tm71b7lh86",
        "model": "api::page.page",
        "slug": "pt/noticias/littlebox-suite-ajudou-me-a-construir-sites-mais-rapido",
        "locale": "pt",
        "attributes": {
            "template": "default",
            "priority": "1.0",
            "frequency": "yearly",
            "parent": {
                "id": "wnzxub0s3ghckznjdkshgcw7",
                "model": "api::page.page"
            }
        }
    }
]
```

If you prefer, you can use our [ready-to-go Next.js frontend](https://github.com/littleboxstudio/strapi-frontend) as a base, which already implements these solutions.

&nbsp;
&nbsp;
&nbsp;
### Parameters
Effortlessly manage and customize settings with a intuitive and flexible solution.

![Parameter](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/parameter.png?v=10&raw=true)

![Parameter list](https://github.com/littleboxstudio/strapi-suite/blob/main/docs/screenshots/parameter-list.png?raw=true)

To get the data from the frontend, use your preferred HTTP client:

```
GET /api/littlebox-strapi-suite/modules/parameters
```
```
[
    {
        "uid": "recaptcha-public-key",
        "value": "iuyTYYT7ybknokdiuYTtdjapodu"
    }
]
```
This request will only return public parameters. To get the private parameters from the Strapi backend (e.g. for use in other plugins), use the `@strapi/strapi/admin` library:
```
import { getFetchClient } from '@strapi/strapi/admin';
const { get } = getFetchClient();
const data = await get('/littlebox-strapi-suite/admin/parameters');
```

&nbsp;
&nbsp;
&nbsp;
## 🤝 Contributing
Feel free to fork and make a pull request of this plugin. All the input is welcome!

&nbsp;
&nbsp;
&nbsp;
## ⭐️ Show your support
Give a star if this project helped you.

&nbsp;
&nbsp;
&nbsp;
## 🔗 Links
- [NPM package](https://www.npmjs.com/package/@littlebox/strapi-suite)
- [GitHub repository](https://github.com/littleboxstudio/strapi-suite)

&nbsp;
&nbsp;
&nbsp;
## 🌎 Community support
- For general help using Strapi, please refer to [the official Strapi documentation](https://strapi.io/documentation/).
- You can contact me at tools@littlebox.pt.
- Visit our website [littlebox.pt](https://littlebox.pt).

&nbsp;
&nbsp;
&nbsp;
## 📝 Resources
- [MIT License](LICENSE.md)