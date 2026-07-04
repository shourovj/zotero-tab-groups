import { config } from "../package.json";
import hooks from "./hooks";
import { GroupStore } from "./modules/groupStore";
import { TabGroupsUI } from "./modules/tabGroupsUI";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    store: GroupStore;
    ui: Map<Window, TabGroupsUI>;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      store: new GroupStore(),
      ui: new Map(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
