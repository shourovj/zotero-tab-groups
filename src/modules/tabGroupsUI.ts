import { GROUP_COLORS, TabGroup } from "./groupStore";

interface ZoteroTab {
  id: string;
  type: string;
  title: string;
  selected?: boolean;
  data?: { itemID?: number };
}

interface GroupRun {
  group: TabGroup;
  tabs: ZoteroTab[];
  nodes: HTMLElement[];
}

const PILL_GAP = 6;

/**
 * Per-main-window controller.
 *
 * Zotero 7's tab strip is a React component rendered into #tab-bar-container,
 * so we never insert children into it. Instead we:
 *  - decorate the React-owned .tab nodes with classes/inline styles,
 *    re-applied by a MutationObserver after every React render;
 *  - reserve space before each group's first tab via margin-inline-start and
 *    render our group pill (name, color, collapse) in a fixed-position overlay
 *    outside the React root;
 *  - reorder tabs only through the official Zotero_Tabs.move() API.
 */
export class TabGroupsUI {
  private win: _ZoteroTypes.MainWindow;
  private doc: Document;
  private container: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private rafPending = false;
  private reordering = false;
  private draggedTabID: string | null = null;
  private draggedGroupID: string | null = null;
  private pillWidths: Map<string, number> = new Map();
  private listeners: Array<{
    target: EventTarget;
    type: string;
    fn: EventListener;
    capture?: boolean;
  }> = [];

  constructor(win: _ZoteroTypes.MainWindow) {
    this.win = win;
    this.doc = win.document;
  }

  private get tabsAPI(): any {
    return (this.win as any).Zotero_Tabs;
  }

  attach(): boolean {
    this.container = this.doc.getElementById(
      "tab-bar-container",
    ) as HTMLElement | null;
    if (!this.container) {
      ztoolkit.log("TabGroups: #tab-bar-container not found");
      return false;
    }

    this.overlay = this.doc.createElement("div");
    this.overlay.className = "ztg-overlay";
    this.doc.documentElement?.appendChild(this.overlay);

    this.observer = new (this.win as any).MutationObserver(() =>
      this.scheduleRender(),
    );
    this.observer!.observe(this.container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-id", "style"],
    });

    this.on(this.win, "resize", () => this.scheduleRender());
    // Capture-phase scroll catches the tab strip's internal scroller.
    this.on(this.win, "scroll", () => this.scheduleRender(), true);
    this.on(
      this.container,
      "dragstart",
      (e) => {
        const tabNode = (e.target as HTMLElement)?.closest?.(
          ".tab[data-id]",
        ) as HTMLElement | null;
        this.draggedTabID = tabNode?.getAttribute("data-id") || null;
        this.draggedGroupID = this.draggedTabID
          ? this.groupOfTabID(this.draggedTabID)?.id || null
          : null;
      },
      true,
    );
    this.on(
      this.container,
      "dragend",
      () => {
        const tabID = this.draggedTabID;
        const fromGroup = this.draggedGroupID;
        this.draggedTabID = null;
        this.draggedGroupID = null;
        // Let Zotero_Tabs finish its own move first.
        this.win.setTimeout(() => this.reconcileAfterDrag(tabID, fromGroup), 0);
      },
      true,
    );

    this.reconcile();
    this.scheduleRender();
    return true;
  }

  detach() {
    this.observer?.disconnect();
    this.observer = null;
    for (const l of this.listeners) {
      l.target.removeEventListener(l.type, l.fn, l.capture);
    }
    this.listeners = [];
    this.overlay?.remove();
    this.overlay = null;
    this.clearDecorations();
    this.container = null;
  }

  private on(
    target: EventTarget,
    type: string,
    fn: EventListener,
    capture = false,
  ) {
    target.addEventListener(type, fn, capture);
    this.listeners.push({ target, type, fn, capture });
  }

  scheduleRender() {
    if (this.rafPending || !this.container) {
      return;
    }
    this.rafPending = true;
    this.win.requestAnimationFrame(() => {
      this.rafPending = false;
      try {
        this.render();
      } catch (e) {
        ztoolkit.log("TabGroups: render error", e);
      }
    });
  }

  // ---------------------------------------------------------------- model

  private openTabs(): ZoteroTab[] {
    return (this.tabsAPI?._tabs as ZoteroTab[]) || [];
  }

  private itemIDOfTabID(tabID: string): number | undefined {
    return this.openTabs().find((t) => t.id === tabID)?.data?.itemID;
  }

  groupOfTabID(tabID: string): TabGroup | undefined {
    const itemID = this.itemIDOfTabID(tabID);
    return itemID != null ? addon.data.store.groupOfItem(itemID) : undefined;
  }

  /** Groups with their open member tabs, ordered by first member position. */
  private groupRuns(): GroupRun[] {
    const runs = new Map<string, GroupRun>();
    for (const tab of this.openTabs()) {
      const itemID = tab.data?.itemID;
      if (itemID == null) {
        continue;
      }
      const group = addon.data.store.groupOfItem(itemID);
      if (!group) {
        continue;
      }
      let run = runs.get(group.id);
      if (!run) {
        run = { group, tabs: [], nodes: [] };
        runs.set(group.id, run);
      }
      run.tabs.push(tab);
    }
    return [...runs.values()];
  }

  // ------------------------------------------------------------- ordering

  /**
   * Keep each group's tabs contiguous, anchored at the position of its
   * first member, using Zotero_Tabs.move(). Guarded against observer
   * feedback loops with a reentrancy flag.
   */
  reconcile() {
    if (this.reordering || !this.tabsAPI) {
      return;
    }
    const tabs = this.openTabs();
    const emitted = new Set<string>();
    const target: ZoteroTab[] = [];
    for (const tab of tabs) {
      if (emitted.has(tab.id)) {
        continue;
      }
      const group =
        tab.data?.itemID != null
          ? addon.data.store.groupOfItem(tab.data.itemID)
          : undefined;
      if (group) {
        // Emit the whole group at the first member's position,
        // preserving members' current relative order.
        for (const member of tabs) {
          if (
            member.data?.itemID != null &&
            addon.data.store.groupOfItem(member.data.itemID)?.id === group.id
          ) {
            target.push(member);
            emitted.add(member.id);
          }
        }
      } else {
        target.push(tab);
        emitted.add(tab.id);
      }
    }

    this.reordering = true;
    try {
      for (let i = 1; i < target.length; i++) {
        const current = this.openTabs();
        if (current[i]?.id !== target[i].id) {
          this.tabsAPI.move(target[i].id, i);
        }
      }
    } finally {
      this.reordering = false;
    }
    this.scheduleRender();
  }

  /**
   * Edge-like drag semantics, applied after a native tab drag ends:
   *  - a tab dropped strictly inside another group's span joins that group;
   *  - a group member dragged out of its group's span leaves the group;
   *  - then contiguity is re-enforced.
   */
  private reconcileAfterDrag(tabID: string | null, fromGroupID: string | null) {
    if (!tabID) {
      return;
    }
    const tabs = this.openTabs();
    const index = tabs.findIndex((t) => t.id === tabID);
    const itemID = this.itemIDOfTabID(tabID);
    if (index < 0 || itemID == null) {
      return;
    }

    // Span (min..max index) of every group, excluding the dragged tab itself.
    const spans = new Map<string, { min: number; max: number }>();
    tabs.forEach((t, i) => {
      if (t.id === tabID || t.data?.itemID == null) {
        return;
      }
      const g = addon.data.store.groupOfItem(t.data.itemID);
      if (!g) {
        return;
      }
      const span = spans.get(g.id);
      if (!span) {
        spans.set(g.id, { min: i, max: i });
      } else {
        span.min = Math.min(span.min, i);
        span.max = Math.max(span.max, i);
      }
    });

    let assigned: string | null = null;
    for (const [gid, span] of spans) {
      if (index > span.min && index <= span.max) {
        assigned = gid;
        break;
      }
    }

    if (assigned && assigned !== fromGroupID) {
      const group = addon.data.store.getGroup(assigned);
      if (group && !group.collapsed) {
        addon.data.store.assignItem(itemID, assigned);
      }
    } else if (!assigned && fromGroupID) {
      addon.data.store.removeItem(itemID);
    }
    this.reconcile();
  }

  // ------------------------------------------------------------ rendering

  private clearDecorations() {
    if (!this.container) {
      return;
    }
    for (const node of this.container.querySelectorAll<HTMLElement>(
      ".tab[data-id]",
    )) {
      if (node.dataset.ztgGroup !== undefined) {
        delete node.dataset.ztgGroup;
      }
      node.classList.remove("ztg-collapsed");
      node.style.removeProperty("--ztg-color");
      node.style.removeProperty("margin-inline-start");
    }
  }

  render() {
    if (!this.container || !this.overlay) {
      return;
    }
    const runs = this.groupRuns();
    const store = addon.data.store;

    // Auto-expand a collapsed group when one of its hidden tabs is selected
    // (e.g. via keyboard tab cycling).
    for (const run of runs) {
      if (run.group.collapsed && run.tabs.some((t) => t.selected)) {
        store.setCollapsed(run.group.id, false);
        run.group.collapsed = false;
      }
    }

    const byGroup = new Map<string, GroupRun>(runs.map((r) => [r.group.id, r]));
    const firstOfGroup = new Map<string, HTMLElement>();

    // 1. Decorate React-owned tab nodes.
    for (const node of this.container.querySelectorAll<HTMLElement>(
      ".tab[data-id]",
    )) {
      const tabID = node.getAttribute("data-id")!;
      const group = this.groupOfTabID(tabID);
      const run = group ? byGroup.get(group.id) : undefined;
      // Only write when values actually change: these nodes are watched by
      // our own MutationObserver, and same-value attribute writes still fire
      // mutation records — an unguarded write here would loop forever.
      if (!group || !run) {
        if (node.dataset.ztgGroup !== undefined) {
          delete node.dataset.ztgGroup;
        }
        node.classList.remove("ztg-collapsed");
        if (node.style.getPropertyValue("--ztg-color")) {
          node.style.removeProperty("--ztg-color");
        }
        if (node.style.marginInlineStart) {
          node.style.removeProperty("margin-inline-start");
        }
        continue;
      }
      if (node.dataset.ztgGroup !== group.id) {
        node.dataset.ztgGroup = group.id;
      }
      if (node.style.getPropertyValue("--ztg-color") !== group.color) {
        node.style.setProperty("--ztg-color", group.color);
      }
      if (node.classList.contains("ztg-collapsed") !== group.collapsed) {
        node.classList.toggle("ztg-collapsed", group.collapsed);
      }
      if (!firstOfGroup.has(group.id)) {
        firstOfGroup.set(group.id, node);
        const margin = `${
          (this.pillWidths.get(group.id) || 60) + PILL_GAP * 2
        }px`;
        if (node.style.marginInlineStart !== margin) {
          node.style.marginInlineStart = margin;
        }
      } else if (node.style.marginInlineStart) {
        node.style.removeProperty("margin-inline-start");
      }
      run.nodes.push(node);
    }

    // 2. Sync overlay pills/frames with current groups.
    const wanted = new Set(
      runs.filter((r) => r.nodes.length).map((r) => r.group.id),
    );
    for (const el of this.overlay.querySelectorAll<HTMLElement>("[data-ztg]")) {
      if (!wanted.has(el.dataset.ztg!)) {
        el.remove();
        this.pillWidths.delete(el.dataset.ztg!);
      }
    }

    const containerRect = this.container.getBoundingClientRect();
    let needsRerender = false;

    for (const run of runs) {
      if (!run.nodes.length) {
        continue;
      }
      const { group } = run;
      const pill = this.ensurePill(group);
      const frame = this.ensureFrame(group);

      // Update pill content/appearance.
      const label = pill.querySelector<HTMLElement>(".ztg-pill-label")!;
      const text = group.collapsed
        ? `${group.title} (${run.tabs.length})`
        : group.title;
      if (label.textContent !== text) {
        label.textContent = text;
      }
      pill.style.background = group.color;
      pill.classList.toggle("ztg-pill-collapsed", group.collapsed);

      // Measure pill; if width changed, margins must be reapplied next frame.
      const w = pill.offsetWidth;
      if (w && this.pillWidths.get(group.id) !== w) {
        this.pillWidths.set(group.id, w);
        needsRerender = true;
      }

      // Position pill inside the margin gap before the first member tab.
      const firstRect = run.nodes[0].getBoundingClientRect();
      const lastRect = run.nodes[run.nodes.length - 1].getBoundingClientRect();
      const pillLeft = firstRect.left - (w || 60) - PILL_GAP;
      const visible =
        pillLeft < containerRect.right &&
        firstRect.left - (w || 60) - PILL_GAP * 2 > containerRect.left - 4;
      pill.style.display = visible ? "flex" : "none";
      if (visible) {
        pill.style.left = `${pillLeft}px`;
        pill.style.top = `${
          containerRect.top + (containerRect.height - pill.offsetHeight) / 2
        }px`;
      }

      // Colored frame under the whole run (pill through last tab).
      if (group.collapsed || !visible) {
        frame.style.display = "none";
      } else {
        frame.style.display = "block";
        frame.style.background = group.color;
        frame.style.left = `${pillLeft}px`;
        frame.style.top = `${containerRect.bottom - 3}px`;
        frame.style.width = `${Math.max(
          0,
          Math.min(lastRect.right, containerRect.right) - pillLeft,
        )}px`;
      }
    }

    if (needsRerender) {
      this.scheduleRender();
    }
  }

  private ensurePill(group: TabGroup): HTMLElement {
    let pill = this.overlay!.querySelector<HTMLElement>(
      `.ztg-pill[data-ztg="${group.id}"]`,
    );
    if (pill) {
      return pill;
    }
    pill = this.doc.createElement("div");
    pill.className = "ztg-pill";
    pill.dataset.ztg = group.id;
    const label = this.doc.createElement("span");
    label.className = "ztg-pill-label";
    pill.appendChild(label);
    this.overlay!.appendChild(pill);

    pill.addEventListener("click", () => {
      const g = addon.data.store.getGroup(group.id);
      if (g) {
        addon.data.store.setCollapsed(g.id, !g.collapsed);
        this.scheduleRender();
      }
    });
    pill.addEventListener("dblclick", () => this.promptRename(group.id));
    pill.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openPillMenu(e as MouseEvent, group.id);
    });
    // Drop target: native tab drags carry 'zotero/tab' in dataTransfer.
    pill.addEventListener("dragover", (e) => {
      const de = e as DragEvent;
      if (de.dataTransfer?.types.includes("zotero/tab")) {
        de.preventDefault();
        de.dataTransfer.dropEffect = "move";
        pill!.classList.add("ztg-drop");
      }
    });
    pill.addEventListener("dragleave", () =>
      pill!.classList.remove("ztg-drop"),
    );
    pill.addEventListener("drop", (e) => {
      const de = e as DragEvent;
      pill!.classList.remove("ztg-drop");
      const tabID = de.dataTransfer?.getData("zotero/tab");
      if (!tabID) {
        return;
      }
      de.preventDefault();
      de.stopPropagation();
      // Cancel the pending native-drag reconciliation for this drop.
      this.draggedTabID = null;
      this.draggedGroupID = null;
      this.assignTab(tabID, group.id);
    });
    return pill;
  }

  private ensureFrame(group: TabGroup): HTMLElement {
    let frame = this.overlay!.querySelector<HTMLElement>(
      `.ztg-frame[data-ztg="${group.id}"]`,
    );
    if (!frame) {
      frame = this.doc.createElement("div");
      frame.className = "ztg-frame";
      frame.dataset.ztg = group.id;
      this.overlay!.appendChild(frame);
    }
    return frame;
  }

  // ------------------------------------------------------------- actions

  assignTab(tabID: string, groupID: string) {
    const itemID = this.itemIDOfTabID(tabID);
    if (itemID == null) {
      return;
    }
    addon.data.store.assignItem(itemID, groupID);
    addon.data.store.setCollapsed(groupID, false);
    this.reconcile();
  }

  removeTab(tabID: string) {
    const itemID = this.itemIDOfTabID(tabID);
    if (itemID == null) {
      return;
    }
    addon.data.store.removeItem(itemID);
    this.reconcile();
  }

  createGroupWithTab(tabID: string) {
    const itemID = this.itemIDOfTabID(tabID);
    if (itemID == null) {
      return;
    }
    const group = addon.data.store.createGroup();
    addon.data.store.assignItem(itemID, group.id);
    this.reconcile();
    this.promptRename(group.id);
  }

  promptRename(groupID: string) {
    const group = addon.data.store.getGroup(groupID);
    if (!group) {
      return;
    }
    const result = { value: group.title };
    const ok = Services.prompt.prompt(
      this.win as any,
      "Rename Group",
      "Group name:",
      result,
      "",
      { value: false },
    );
    if (ok && result.value.trim()) {
      addon.data.store.renameGroup(groupID, result.value);
      this.scheduleRender();
    }
  }

  private openPillMenu(e: MouseEvent, groupID: string) {
    const group = addon.data.store.getGroup(groupID);
    if (!group) {
      return;
    }
    const doc = this.doc;
    const popupset = doc.querySelector("popupset");
    if (!popupset) {
      return;
    }
    const popup = doc.createXULElement("menupopup") as any;
    popupset.appendChild(popup);
    popup.addEventListener("popuphidden", (ev: Event) => {
      if (ev.target === popup) {
        popup.remove();
      }
    });

    const addItem = (labelText: string, fn: () => void) => {
      const item = doc.createXULElement("menuitem") as any;
      item.setAttribute("label", labelText);
      item.addEventListener("command", fn);
      popup.appendChild(item);
      return item;
    };

    addItem(group.collapsed ? "Expand Group" : "Collapse Group", () => {
      addon.data.store.setCollapsed(groupID, !group.collapsed);
      this.scheduleRender();
    });
    addItem("Rename Group…", () => this.promptRename(groupID));

    // Color submenu with colored swatches.
    const colorMenu = doc.createXULElement("menu") as any;
    colorMenu.setAttribute("label", "Color");
    const colorPopup = doc.createXULElement("menupopup") as any;
    colorMenu.appendChild(colorPopup);
    for (const c of GROUP_COLORS) {
      const item = doc.createXULElement("menuitem") as any;
      item.setAttribute("label", c.name);
      item.setAttribute("type", "checkbox");
      if (group.color === c.value) {
        item.setAttribute("checked", "true");
      }
      (item.style as CSSStyleDeclaration).color = c.value;
      item.addEventListener("command", () => {
        addon.data.store.setColor(groupID, c.value);
        this.scheduleRender();
      });
      colorPopup.appendChild(item);
    }
    popup.appendChild(colorMenu);

    popup.appendChild(doc.createXULElement("menuseparator"));

    addItem("Close Tabs in Group", () => {
      const ids = this.groupRuns()
        .find((r) => r.group.id === groupID)
        ?.tabs.map((t) => t.id);
      if (ids?.length) {
        this.tabsAPI.close(ids);
      }
    });
    addItem("Ungroup", () => {
      addon.data.store.deleteGroup(groupID);
      this.scheduleRender();
    });

    popup.openPopupAtScreen(e.screenX, e.screenY, true);
  }
}
