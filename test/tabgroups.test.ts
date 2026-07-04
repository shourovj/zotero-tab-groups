import { assert } from "chai";
import { config } from "../package.json";

/**
 * End-to-end tests that run inside a live Zotero instance.
 * Tabs are added through the real Zotero_Tabs API (unselected reader-type
 * tabs render in the strip without opening an actual reader), so these
 * exercise the real React tab bar DOM, our MutationObserver decoration,
 * the overlay pills, contiguity reordering, and pref persistence.
 */

const win = () => Zotero.getMainWindow() as any;
const tabsAPI = () => win().Zotero_Tabs;
const store = () => (Zotero as any)[config.addonInstance].data.store;
const ui = () =>
  (Zotero as any)[config.addonInstance].data.ui.get(
    Zotero.getMainWindow() as any,
  );

function addFakeReaderTab(title: string, itemID: number): string {
  const { id } = tabsAPI().add({
    type: "reader",
    title,
    data: { itemID },
    select: false,
  });
  return id;
}

function tabNode(tabID: string): HTMLElement | null {
  return win().document.querySelector(
    `#tab-bar-container .tab[data-id="${tabID}"]`,
  );
}

function pillFor(groupID: string): HTMLElement | null {
  return win().document.querySelector(`.ztg-pill[data-ztg="${groupID}"]`);
}

/** Wait until the next animation frame + a tick, so rAF-throttled renders run. */
async function settle(frames = 3) {
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => win().requestAnimationFrame(() => r(null)));
  }
  await Zotero.Promise.delay(50);
}

describe("tab groups", function () {
  this.timeout(20000);
  const openedTabIDs: string[] = [];

  const open = (title: string, itemID: number) => {
    const id = addFakeReaderTab(title, itemID);
    openedTabIDs.push(id);
    return id;
  };

  after(async function () {
    tabsAPI().close(openedTabIDs.filter((id) => tabsAPI()._getTab(id).tab));
    for (const g of store().groups()) {
      store().deleteGroup(g.id);
    }
    await settle();
  });

  it("plugin UI is attached to the main window", function () {
    assert.isDefined(ui(), "TabGroupsUI instance registered for main window");
    assert.isNotNull(
      win().document.querySelector(".ztg-overlay"),
      "overlay layer exists",
    );
  });

  it("plugin stylesheet is registered and applied (chrome:// URL works)", function () {
    const overlay = win().document.querySelector(".ztg-overlay");
    const style = win().getComputedStyle(overlay);
    assert.equal(
      style.position,
      "fixed",
      "overlay position comes from tabgroups.css",
    );
  });

  it("attach is idempotent (double onMainWindowLoad does not duplicate UI)", async function () {
    const plugin = (Zotero as any)[config.addonInstance];
    await plugin.hooks.onMainWindowLoad(win());
    const overlays = win().document.querySelectorAll(".ztg-overlay");
    assert.lengthOf(overlays, 1, "only one overlay layer exists");
  });

  it("tab context menu is patched with group items", async function () {
    const t = open("Menu Test", 900010);
    await settle();
    tabsAPI()._openMenu(200, 200, t);
    await Zotero.Promise.delay(150);
    const popupset = win().document.querySelector("popupset");
    const popup = popupset?.lastElementChild as any;
    try {
      assert.isNotNull(popup, "context menu popup exists");
      const labels = [...popup.querySelectorAll("menu, menuitem")].map(
        (el: any) => el.getAttribute("label"),
      );
      assert.include(labels, "Add to Group", "'Add to Group' submenu present");
      const sub = [...popup.querySelectorAll("menu")].find(
        (el: any) => el.getAttribute("label") === "Add to Group",
      ) as any;
      const subLabels = [...sub.querySelectorAll("menuitem")].map((el: any) =>
        el.getAttribute("label"),
      );
      assert.include(subLabels, "New Group…", "'New Group…' item present");
    } finally {
      popup?.hidePopup?.();
      await Zotero.Promise.delay(100);
    }
  });

  it("tabs render in the strip via Zotero_Tabs.add", async function () {
    const t1 = open("Paper A", 900001);
    await settle();
    assert.isNotNull(tabNode(t1), "tab DOM node exists");
  });

  const tabIDByItem = (itemID: number) =>
    tabsAPI()._tabs.find((t: any) => t.data?.itemID === itemID)?.id;

  it("assigning tabs to a group decorates them and shows a pill", async function () {
    const t1 = tabIDByItem(900001);
    const t2 = open("Paper B", 900002);
    const group = store().createGroup("Test Group");
    store().assignItem(900001, group.id);
    store().assignItem(900002, group.id);
    ui().reconcile();
    await settle();

    assert.equal(
      tabNode(t1)?.dataset.ztgGroup,
      group.id,
      "first tab decorated",
    );
    assert.equal(
      tabNode(t2)?.dataset.ztgGroup,
      group.id,
      "second tab decorated",
    );
    const pill = pillFor(group.id);
    assert.isNotNull(pill, "group pill rendered in overlay");
    assert.include(pill!.textContent || "", "Test Group");
    assert.isAbove(
      tabNode(t1)!.getBoundingClientRect().left,
      pill!.getBoundingClientRect().left,
      "pill sits before the first member tab",
    );
  });

  it("keeps group members contiguous after an interloper appears", async function () {
    const group = store().groups().find((g: any) => g.title === "Test Group");
    // Insert an ungrouped tab between the two members.
    const stray = open("Stray", 900003);
    const t2Index = tabsAPI()._tabs.findIndex(
      (t: any) => t.data?.itemID === 900002,
    );
    tabsAPI().move(stray, t2Index);
    ui().reconcile();
    await settle();

    const indices = tabsAPI()
      ._tabs.map((t: any, i: number) => ({ t, i }))
      .filter(
        (x: any) =>
          x.t.data?.itemID &&
          store().groupOfItem(x.t.data.itemID)?.id === group.id,
      )
      .map((x: any) => x.i);
    assert.lengthOf(indices, 2);
    assert.equal(
      indices[1] - indices[0],
      1,
      "group members are adjacent after reconcile",
    );
  });

  it("collapse hides member tabs; expand restores them", async function () {
    const group = store().groups().find((g: any) => g.title === "Test Group");
    store().setCollapsed(group.id, true);
    ui().scheduleRender();
    await settle();

    const node = win().document.querySelector(
      `#tab-bar-container .tab[data-ztg-group="${group.id}"]`,
    ) as HTMLElement;
    assert.isTrue(
      node.classList.contains("ztg-collapsed"),
      "member has collapsed class",
    );
    assert.isBelow(
      node.getBoundingClientRect().width,
      2,
      "collapsed member is visually hidden",
    );
    assert.include(
      pillFor(group.id)!.textContent || "",
      "(2)",
      "collapsed pill shows member count",
    );

    store().setCollapsed(group.id, false);
    ui().scheduleRender();
    await settle();
    assert.isAbove(
      node.getBoundingClientRect().width,
      10,
      "expanded member is visible again",
    );
  });

  it("assignTab via UI (same path as pill drop / context menu) joins a group", async function () {
    const group = store().groups().find((g: any) => g.title === "Test Group");
    const stray = tabIDByItem(900003); // "Stray"
    ui().assignTab(stray, group.id);
    await settle();
    assert.equal(
      store().groupOfItem(900003)?.id,
      group.id,
      "dropped tab joined group",
    );
    assert.equal(tabNode(stray)?.dataset.ztgGroup, group.id);
  });

  it("removing a tab from its group clears decoration", async function () {
    const stray = tabIDByItem(900003);
    ui().removeTab(stray);
    await settle();
    assert.isUndefined(store().groupOfItem(900003));
    assert.isUndefined(tabNode(stray)?.dataset.ztgGroup);
  });

  it("persists groups and membership to the pref as JSON", async function () {
    store().flush();
    const raw = Zotero.Prefs.get(`${config.prefsPrefix}.data`, true) as string;
    const data = JSON.parse(raw);
    const group = Object.values(data.groups).find(
      (g: any) => g.title === "Test Group",
    ) as any;
    assert.isDefined(group, "group persisted");
    assert.equal(data.items["900001"], group.id, "membership keyed by itemID");
  });

  it("deleting a group removes pill and membership", async function () {
    const group = store().groups().find((g: any) => g.title === "Test Group");
    store().deleteGroup(group.id);
    ui().scheduleRender();
    await settle();
    assert.isNull(pillFor(group.id), "pill removed");
    assert.isUndefined(store().groupOfItem(900001));
  });
});
