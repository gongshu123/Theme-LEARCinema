# Theme LEAR Cinema

A cinematic dark theme for [Stash](https://github.com/stashapp/stash), focused on large landscape artwork, compact media cards, and consistent navigation across scene, performer, studio, and gallery pages.

## Features

- Cinematic scene landing page with a featured hero
- Landscape scene and gallery cards
- Consistent pagination on scene, performer, studio, and gallery lists
- Responsive layouts for desktop and smaller screens
- Refined scene, performer, studio, and gallery detail pages
- Search, filter, recommendation, and settings UI styling

## Installation

1. Download or clone this repository.
2. Copy the `Theme-LEARCinema` folder into your Stash `plugins` directory.
3. In Stash, open **Settings → Plugins** and reload plugins.
4. Enable **Theme - LEAR Cinema**.
5. Refresh the browser if the interface was already open.

Example layout:

```text
stash/
└── plugins/
    └── Theme-LEARCinema/
        ├── Theme-LEARCinema.yml
        ├── Theme-LEARCinema.css
        └── Theme-LEARCinema.js
```

## Development

The theme is implemented as a Stash plugin with plain CSS and JavaScript. After editing the files, reload the plugin in Stash and hard-refresh the browser.

Because Stash's rendered markup can change between releases, verify the theme after upgrading Stash.

## License

Released under the [MIT License](LICENSE).

## 中文说明

LEAR Cinema 是一个面向 Stash 的电影化深色主题，提供横向媒体卡片、场景 Hero、详情页样式，以及短片、演员、工作室和图库页面统一的翻页布局。

安装时将整个 `Theme-LEARCinema` 文件夹复制到 Stash 的 `plugins` 目录，在插件设置中重新加载并启用主题即可。

