import { GroupStore } from "./modules/groupStore";
import { TabGroupsUI } from "./modules/tabGroupsUI";
import { patchTabMenu, unpatchTabMenu } from "./modules/tabMenu";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  try {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);

    addon.data.store = new GroupStore();
    addon.data.store.load();
    (addon.api as any).status = status;

    registerNotifier();

    await Promise.all(
      Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
    );

    addon.data.initialized = true;
    Zotero.debug("[TabGroups] startup complete");
  } catch (e) {
    Zotero.logError(e as Error);
  }
}

function registerNotifier() {
  const callback = {
    notify: (
      event: string,
      type: string,
      ids: number[] | string[],
      extraData: { [key: string]: any },
    ) => {
      if (!addon?.data.alive) {
        Zotero.Notifier.unregisterObserver(notifierID);
        return;
      }
      addon.hooks.onNotify(event, type, ids, extraData);
    },
  };
  const notifierID = Zotero.Notifier.registerObserver(callback, ["tab"]);
  Zotero.Plugins.addObserver({
    shutdown: ({ id }) => {
      if (id === addon.data.config.addonID) {
        Zotero.Notifier.unregisterObserver(notifierID);
      }
    },
  });
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  try {
    // Zotero calls this hook for already-open windows on plugin load and
    // onStartup also iterates them — make attachment idempotent.
    const existing = addon.data.ui.get(win as unknown as Window);
    if (existing) {
      return;
    }
    addon.data.ztoolkit = createZToolkit();

    // Plugin stylesheet
    const doc = win.document;
    const styles = ztoolkit.UI.createElement(doc, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${addon.data.config.addonRef}/content/tabgroups.css`,
      },
    });
    doc.documentElement?.appendChild(styles);

    const ui = new TabGroupsUI(win);
    const attached = ui.attach();
    Zotero.debug(`[TabGroups] onMainWindowLoad: attached=${attached}`);
    if (attached) {
      addon.data.ui.set(win as unknown as Window, ui);
      patchTabMenu(win, ui);
    } else {
      Zotero.logError(
        new Error("[TabGroups] tab bar container not found; UI not attached"),
      );
    }
  } catch (e) {
    Zotero.logError(e as Error);
  }
}

/** Manual diagnostic: run `Zotero.TabGroups.api.status()` in Tools →
 *  Developer → Run JavaScript to inspect attach state. */
function status() {
  const wins = Zotero.getMainWindows();
  return {
    initialized: addon.data.initialized,
    mainWindows: wins.length,
    attachedWindows: addon.data.ui.size,
    tabBarFound: wins.map(
      (w) => !!w.document.getElementById("tab-bar-container"),
    ),
    openMenuIsFunction: wins.map(
      (w) => typeof (w as any).Zotero_Tabs?._openMenu,
    ),
    groups: addon.data.store.groups(),
  };
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const ui = addon.data.ui.get(win);
  if (ui) {
    ui.detach();
    addon.data.ui.delete(win);
  }
  unpatchTabMenu(win);
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  for (const [win, ui] of addon.data.ui) {
    ui.detach();
    unpatchTabMenu(win);
  }
  addon.data.ui.clear();
  addon.data.store?.flush();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * Tab open/close/select events: re-run membership + layout so tabs
 * reopened after a restart rejoin their persisted groups.
 */
async function onNotify(
  event: string,
  type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {
  if (type !== "tab") {
    return;
  }
  for (const ui of addon.data.ui.values()) {
    if (event === "add" || event === "close") {
      ui.reconcile();
    } else {
      ui.scheduleRender();
    }
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
};
