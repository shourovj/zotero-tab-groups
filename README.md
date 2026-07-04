# Zotero Tab Groups

[![zotero target version](https://img.shields.io/badge/Zotero-7%20%E2%86%92%209-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0)

**Edge-style tab groups for Zotero's horizontal tab bar** — organize your open
PDFs into named, colored, collapsible clusters, just like tab groups in
Microsoft Edge or Chrome.

Reading for multiple projects at once? Group the tabs per project, collapse the
ones you're not using, and find everything again after a restart.

## Features

- 🗂️ **Group tabs** — right-click any PDF tab → *Add to Group → New Group…*
- 🎨 **8 colors + custom names** — each group gets a colored pill in the tab
  strip and a colored underline across its member tabs
- 📌 **Auto-contiguous** — grouped tabs always stay next to each other
- 🫳 **Drag and drop** — drop a tab onto a group's pill to add it; drag a tab
  into the middle of a group to join it, or drag it out to leave
- 🔽 **Collapse / expand** — click a group's pill to hide its tabs behind the
  pill (shows the tab count); click again to expand
- ✏️ **Manage groups** — double-click a pill to rename; right-click it for
  color, collapse, close-all, and ungroup options
- 💾 **Survives restarts** — membership is keyed to the underlying Zotero item,
  so reopening a PDF puts its tab back in its group

## Installation

1. Download the latest `.xpi` from the
   [releases page](https://github.com/shourovj/zotero-tab-groups/releases/latest)
   *(in Firefox, right-click → Save Link As… so it doesn't try to install there)*
2. In Zotero: **Tools → Plugins → ⚙️ → Install Plugin From File…** and select
   the `.xpi`
3. Open some PDFs and right-click a tab to start grouping

Compatible with Zotero 7, 8, and 9 (developed and tested on Zotero 9).

## Usage

| Action | How |
| --- | --- |
| Create a group | Right-click a tab → **Add to Group → New Group…** |
| Add a tab to a group | Right-click → **Add to Group → *group name***, or drag the tab onto the group's pill |
| Remove a tab | Right-click → **Remove from "*group*"**, or drag the tab out of the group |
| Collapse / expand | Click the group's pill |
| Rename | Double-click the pill, or right-click it → **Rename Group…** |
| Change color | Right-click the pill → **Color** |
| Close all tabs in a group | Right-click the pill → **Close Tabs in Group** |
| Dissolve a group | Right-click the pill → **Ungroup** |

> [!tip]
> Selecting a hidden tab of a collapsed group (e.g. with keyboard shortcuts)
> auto-expands the group.

### Troubleshooting

Run this in **Tools → Developer → Run JavaScript** to check the plugin's state:

```js
JSON.stringify(Zotero.TabGroups?.api?.status?.() ?? "plugin not loaded", null, 2)
```

Errors are logged to the Error Console prefixed with `[TabGroups]`. If another
tab-modifying plugin conflicts, try disabling it and reloading.

## How it works

Zotero 7+ renders its tab bar as a React component, so this plugin never
injects children into the strip. Instead it:

- decorates the React-owned tab nodes with classes/styles, re-applied by a
  `MutationObserver` after every React render;
- draws group pills and underline frames in an overlay layer outside the React
  root, positioned from the member tabs' bounding rectangles;
- reorders tabs only through the official `Zotero_Tabs.move()` API;
- persists groups and membership (keyed by item ID) as JSON in a Zotero pref.

## Development

```bash
git clone https://github.com/shourovj/zotero-tab-groups.git
cd zotero-tab-groups
npm install
cp .env.example .env   # set your Zotero binary (and optionally profile) path

npm start              # launch Zotero with the plugin + hot reload
npm run build          # production build → .scaffold/build/zotero-tab-groups.xpi
npm test               # run the in-app mocha test suite inside a live Zotero
```

The test suite (`test/tabgroups.test.ts`) exercises the real tab bar DOM in a
sandboxed Zotero profile: grouping, contiguity, collapse, drag-assignment,
persistence, and context-menu injection.

## Credits

- Built with [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template),
  [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit),
  and [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold)
- Inspired by tab groups in Microsoft Edge

## License

[AGPL-3.0-or-later](LICENSE) © Shourov Joarder
