import { TabGroupsUI } from "./tabGroupsUI";

const PATCHED = Symbol.for("ztg-openMenu-patched");
const LISTENERS = Symbol.for("ztg-menu-listeners");

function debug(msg: string) {
  Zotero.debug(`[TabGroups] ${msg}`);
}

/**
 * Zotero builds the tab context menu from scratch in Zotero_Tabs._openMenu()
 * (a fresh menupopup appended to the popupset, removed on popuphidden).
 *
 * Two injection paths, because other plugins may replace or bypass
 * _openMenu entirely:
 *  1. Wrap _openMenu: let the original build and open the popup, then
 *     append our "Add to Group" items to the same popup.
 *  2. Fallback: capture-phase contextmenu on the window records the
 *     right-clicked tab; a capture-phase popupshowing listener injects
 *     into whatever tab menupopup actually opens, whoever built it.
 * Popups are marked so the two paths never double-inject.
 */
export function patchTabMenu(win: _ZoteroTypes.MainWindow, ui: TabGroupsUI) {
  const zt = (win as any).Zotero_Tabs;
  if (!zt || zt[PATCHED]) {
    return;
  }
  const doc = win.document;
  const original = zt._openMenu;
  zt[PATCHED] = original;
  if (typeof original === "function") {
    zt._openMenu = function (x: number, y: number, id: string) {
      original.call(this, x, y, id);
      try {
        const popup = doc.querySelector("popupset")?.lastElementChild as any;
        injectGroupItems(win, ui, id, popup);
      } catch (e) {
        Zotero.logError(e as Error);
      }
    };
  } else {
    debug("Zotero_Tabs._openMenu not found; relying on popupshowing fallback");
  }

  // Fallback path.
  let lastCtx: { id: string; time: number } | null = null;
  const onContextMenu = (e: Event) => {
    const tabNode = (e.target as HTMLElement)?.closest?.(
      ".tab[data-id], [data-tab-id]",
    ) as HTMLElement | null;
    const id =
      tabNode?.getAttribute("data-id") || tabNode?.getAttribute("data-tab-id");
    lastCtx = id ? { id, time: Date.now() } : null;
  };
  const onPopupShowing = (e: Event) => {
    try {
      const popup = e.target as any;
      if (
        popup?.tagName !== "menupopup" ||
        popup.parentElement?.tagName !== "popupset" ||
        !lastCtx ||
        Date.now() - lastCtx.time > 1500
      ) {
        return;
      }
      injectGroupItems(win, ui, lastCtx.id, popup);
    } catch (err) {
      Zotero.logError(err as Error);
    }
  };
  doc.addEventListener("contextmenu", onContextMenu, true);
  doc.addEventListener("popupshowing", onPopupShowing, true);
  zt[LISTENERS] = { onContextMenu, onPopupShowing };
  debug("tab context menu patched");
}

export function unpatchTabMenu(win: Window) {
  const zt = (win as any).Zotero_Tabs;
  if (!zt) {
    return;
  }
  if (zt[PATCHED]) {
    if (typeof zt[PATCHED] === "function") {
      zt._openMenu = zt[PATCHED];
    }
    delete zt[PATCHED];
  }
  if (zt[LISTENERS]) {
    win.document.removeEventListener(
      "contextmenu",
      zt[LISTENERS].onContextMenu,
      true,
    );
    win.document.removeEventListener(
      "popupshowing",
      zt[LISTENERS].onPopupShowing,
      true,
    );
    delete zt[LISTENERS];
  }
}

function injectGroupItems(
  win: _ZoteroTypes.MainWindow,
  ui: TabGroupsUI,
  tabID: string,
  popup: any,
) {
  // The library tab has no backing item and cannot be grouped.
  if (tabID === "zotero-pane") {
    return;
  }
  if (!popup || popup.tagName !== "menupopup" || popup.dataset?.ztgInjected) {
    return;
  }
  popup.dataset.ztgInjected = "1";
  const doc = win.document;

  const currentGroup = ui.groupOfTabID(tabID);
  const store = addon.data.store;

  popup.appendChild(doc.createXULElement("menuseparator"));

  const menu = doc.createXULElement("menu") as any;
  menu.setAttribute("label", "Add to Group");
  const sub = doc.createXULElement("menupopup") as any;
  menu.appendChild(sub);

  for (const group of store.groups()) {
    const item = doc.createXULElement("menuitem") as any;
    item.setAttribute("label", group.title);
    item.setAttribute("type", "checkbox");
    if (currentGroup?.id === group.id) {
      item.setAttribute("checked", "true");
    }
    (item.style as CSSStyleDeclaration).color = group.color;
    item.addEventListener("command", () => ui.assignTab(tabID, group.id));
    sub.appendChild(item);
  }
  if (store.groups().length) {
    sub.appendChild(doc.createXULElement("menuseparator"));
  }
  const newItem = doc.createXULElement("menuitem") as any;
  newItem.setAttribute("label", "New Group…");
  newItem.addEventListener("command", () => ui.createGroupWithTab(tabID));
  sub.appendChild(newItem);
  popup.appendChild(menu);

  if (currentGroup) {
    const removeItem = doc.createXULElement("menuitem") as any;
    removeItem.setAttribute("label", `Remove from "${currentGroup.title}"`);
    removeItem.addEventListener("command", () => ui.removeTab(tabID));
    popup.appendChild(removeItem);
  }
  Zotero.debug(`[TabGroups] menu items injected for tab ${tabID}`);
}
