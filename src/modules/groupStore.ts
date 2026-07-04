import { getPref, setPref } from "../utils/prefs";

export interface TabGroup {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
}

interface PersistedData {
  groups: { [groupID: string]: TabGroup };
  // itemID -> groupID. Tab IDs are session-scoped, so membership is keyed
  // on the Zotero item behind each reader tab and survives restarts.
  items: { [itemID: string]: string };
}

/** Edge-like group color palette. */
export const GROUP_COLORS: { name: string; value: string }[] = [
  { name: "Blue", value: "#4a7dd6" },
  { name: "Red", value: "#d64a4a" },
  { name: "Orange", value: "#e8853d" },
  { name: "Yellow", value: "#d6a516" },
  { name: "Green", value: "#2e9e5b" },
  { name: "Teal", value: "#209fb5" },
  { name: "Purple", value: "#8f5bd6" },
  { name: "Pink", value: "#d64a94" },
];

/**
 * Holds group definitions and item->group membership.
 * Persisted as JSON in a single plugin pref, debounced.
 */
export class GroupStore {
  private data: PersistedData = { groups: {}, items: {} };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  load() {
    try {
      const raw = getPref("data");
      if (typeof raw === "string" && raw) {
        const parsed = JSON.parse(raw) as PersistedData;
        this.data = {
          groups: parsed.groups || {},
          items: parsed.items || {},
        };
      }
    } catch (e) {
      ztoolkit.log("TabGroups: failed to load persisted data", e);
      this.data = { groups: {}, items: {} };
    }
  }

  private save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        setPref("data", JSON.stringify(this.data));
      } catch (e) {
        ztoolkit.log("TabGroups: failed to save data", e);
      }
    }, 300);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      setPref("data", JSON.stringify(this.data));
    }
  }

  groups(): TabGroup[] {
    return Object.values(this.data.groups);
  }

  getGroup(groupID: string): TabGroup | undefined {
    return this.data.groups[groupID];
  }

  createGroup(title?: string, color?: string): TabGroup {
    const n = Object.keys(this.data.groups).length;
    const group: TabGroup = {
      id: `ztg-${Zotero.Utilities.randomString(8)}`,
      title: title || `Group ${n + 1}`,
      color: color || GROUP_COLORS[n % GROUP_COLORS.length].value,
      collapsed: false,
    };
    this.data.groups[group.id] = group;
    this.save();
    return group;
  }

  deleteGroup(groupID: string) {
    delete this.data.groups[groupID];
    for (const itemID of Object.keys(this.data.items)) {
      if (this.data.items[itemID] === groupID) {
        delete this.data.items[itemID];
      }
    }
    this.save();
  }

  renameGroup(groupID: string, title: string) {
    const g = this.data.groups[groupID];
    if (g && title.trim()) {
      g.title = title.trim();
      this.save();
    }
  }

  setColor(groupID: string, color: string) {
    const g = this.data.groups[groupID];
    if (g) {
      g.color = color;
      this.save();
    }
  }

  setCollapsed(groupID: string, collapsed: boolean) {
    const g = this.data.groups[groupID];
    if (g && g.collapsed !== collapsed) {
      g.collapsed = collapsed;
      this.save();
    }
  }

  groupOfItem(itemID: number | string): TabGroup | undefined {
    const gid = this.data.items[String(itemID)];
    return gid ? this.data.groups[gid] : undefined;
  }

  assignItem(itemID: number | string, groupID: string) {
    if (!this.data.groups[groupID]) {
      return;
    }
    this.data.items[String(itemID)] = groupID;
    this.save();
  }

  removeItem(itemID: number | string) {
    if (String(itemID) in this.data.items) {
      delete this.data.items[String(itemID)];
      this.save();
    }
  }
}
