const ADV_COUNTER_MODULE_ID = "imp-counter";
const ADV_COUNTER_MODULE_PATH = document.currentScript?.src?.match(/\/modules\/([^/]+)\//)?.[1] ?? ADV_COUNTER_MODULE_ID;
const ADV_COUNTER_STATE_JOURNAL_NAME = "Imp Counter State";
const ADV_COUNTER_VALUES_FLAG = "values";

function advCounterT(key) {
  return game.i18n.localize(`ADVCOUNTER.${key}`);
}

const ADV_COUNTERS = {
  one: {
    labelSetting: "counterOneLabel",
    valueSetting: "counterOneValue",
    allowPlayersSetting: "allowPlayersCounterOne",
    stateSetting: "counterOneState",
    defaultLabel: "Players Advantage",
    defaultLeft: 120,
    defaultTop: 120
  },
  two: {
    labelSetting: "counterTwoLabel",
    valueSetting: "counterTwoValue",
    allowPlayersSetting: "allowPlayersCounterTwo",
    stateSetting: "counterTwoState",
    defaultLabel: "Enemies Advantage",
    defaultLeft: 360,
    defaultTop: 120
  }
};

function advCounterConfig(key) {
  return ADV_COUNTERS[key];
}

function advCounterLabel(key) {
  const config = advCounterConfig(key);
  return game.settings.get(ADV_COUNTER_MODULE_ID, config.labelSetting) || config.defaultLabel;
}

function advCounterValue(key) {
  const config = advCounterConfig(key);
  const documentValue = advCounterStoredValues()[key];
  if (Number.isFinite(documentValue)) return documentValue;
  return Number(game.settings.get(ADV_COUNTER_MODULE_ID, config.valueSetting) ?? 0);
}

function advCounterStateJournal() {
  return game.journal?.getName(ADV_COUNTER_STATE_JOURNAL_NAME) || null;
}

function advCounterStoredValues() {
  return foundry.utils.deepClone(advCounterStateJournal()?.getFlag(ADV_COUNTER_MODULE_ID, ADV_COUNTER_VALUES_FLAG) || {});
}

async function advCounterEnsureStateJournal() {
  let journal = advCounterStateJournal();
  if (journal) {
    if (game.user?.isGM) await advCounterPrepareStateJournal(journal);
    return journal;
  }

  if (!game.user?.isGM) return null;
  journal = await JournalEntry.create({
    name: ADV_COUNTER_STATE_JOURNAL_NAME,
    ownership: advCounterStateJournalOwnership(),
    pages: []
  });
  await advCounterPrepareStateJournal(journal);
  return journal;
}

function advCounterStateJournalOwnership(journal = null) {
  const ownership = foundry.utils.deepClone(journal?.ownership || {});
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  ownership.default = ownerLevel;
  ownership[game.user.id] = ownerLevel;
  return ownership;
}

async function advCounterPrepareStateJournal(journal) {
  const ownership = {
    ...advCounterStateJournalOwnership(journal)
  };
  if (JSON.stringify(journal.ownership || {}) !== JSON.stringify(ownership)) {
    journal = await journal.update({ ownership });
  }

  const values = journal.getFlag(ADV_COUNTER_MODULE_ID, ADV_COUNTER_VALUES_FLAG);
  if (!values || typeof values !== "object") {
    await journal.setFlag(ADV_COUNTER_MODULE_ID, ADV_COUNTER_VALUES_FLAG, {
      one: Number(game.settings.get(ADV_COUNTER_MODULE_ID, ADV_COUNTERS.one.valueSetting) ?? 0),
      two: Number(game.settings.get(ADV_COUNTER_MODULE_ID, ADV_COUNTERS.two.valueSetting) ?? 0)
    });
  }
}

function advCounterState(key) {
  const config = advCounterConfig(key);
  return foundry.utils.deepClone(game.settings.get(ADV_COUNTER_MODULE_ID, config.stateSetting) || {});
}

function advCounterCanEdit(key, user = game.user) {
  const config = advCounterConfig(key);
  return Boolean(user?.isGM || game.settings.get(ADV_COUNTER_MODULE_ID, config.allowPlayersSetting));
}

function advCounterNormalizeValue(value) {
  const parsed = Number.parseInt(value, 10);
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  const allowNegative = game.settings.get(ADV_COUNTER_MODULE_ID, "allowNegativeValues");
  return allowNegative ? safeValue : Math.max(0, safeValue);
}

function advCounterIsPrimaryGM() {
  return Boolean(game.user?.isGM);
}

async function advCounterSetValue(key, value, { broadcast = true } = {}) {
  const config = advCounterConfig(key);
  if (!config) return;
  const normalized = advCounterNormalizeValue(value);
  const journal = await advCounterEnsureStateJournal();
  if (!journal) {
    advCounterWarnNoGM();
    ImpCounterManager.renderAll();
    return;
  }

  try {
    await journal.setFlag(ADV_COUNTER_MODULE_ID, `${ADV_COUNTER_VALUES_FLAG}.${key}`, normalized);
  } catch (error) {
    console.warn(`${ADV_COUNTER_MODULE_ID} | Could not update counter journal`, error);
    ui.notifications.warn(advCounterT("Notifications.NoPermissionWindow"));
    ImpCounterManager.renderAll();
    return;
  }
  if (game.user?.isGM) await game.settings.set(ADV_COUNTER_MODULE_ID, config.valueSetting, normalized);
  ImpCounterManager?.renderAll?.();
}

async function advCounterAdjustValue(key, delta, options = {}) {
  await advCounterSetValue(key, advCounterValue(key) + Number(delta || 0), options);
}

function advCounterWarnNoGM() {
  ui.notifications.warn(advCounterT("Notifications.NoGM"));
}

async function advCounterRequestSet(key, value) {
  if (!advCounterCanEdit(key)) {
    ui.notifications.warn(advCounterT("Notifications.NoPermissionWindow"));
    return;
  }

  await advCounterSetValue(key, value);
}

async function advCounterRequestAdjust(key, delta) {
  if (!advCounterCanEdit(key)) {
    ui.notifications.warn(advCounterT("Notifications.NoPermissionWindow"));
    return;
  }

  await advCounterAdjustValue(key, delta);
}

class ImpCounterWindow extends Application {
  constructor(counterKey, options = {}) {
    super(options);
    this.counterKey = counterKey;
    this._restoredPosition = false;
    this._positionSaveTimer = null;
    this._onEdgeMouseMove = this._onEdgeMouseMove.bind(this);
    this._onEdgeMouseLeave = this._onEdgeMouseLeave.bind(this);
    this._onEdgeMouseDown = this._onEdgeMouseDown.bind(this);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["imp-counter-window"],
      template: `modules/${ADV_COUNTER_MODULE_PATH}/templates/counter-window.hbs`,
      width: 150,
      height: "auto",
      minimizable: false,
      popOut: true,
      resizable: false
    });
  }

  get id() {
    return `${ADV_COUNTER_MODULE_ID}-${this.counterKey}`;
  }

  get title() {
    return advCounterLabel(this.counterKey);
  }

  get pinned() {
    return Boolean(advCounterState(this.counterKey).pinned);
  }

  async getData() {
    const canEdit = advCounterCanEdit(this.counterKey);
    return {
      key: this.counterKey,
      label: advCounterLabel(this.counterKey),
      value: advCounterValue(this.counterKey),
      canEdit,
      pinned: this.pinned,
      lockedLabel: advCounterT("UI.Locked"),
      lockedText: advCounterT("UI.LockedText"),
      closeTitle: advCounterT("UI.CloseTitle"),
      minusTitle: advCounterT("UI.MinusTitle"),
      plusTitle: advCounterT("UI.PlusTitle")
    };
  }

  async _render(force, options) {
    await super._render(force, options);
    this._bindEdgeResize();
    this._applyPinnedClass();

    if (!this._restoredPosition) {
      this._restoredPosition = true;
      window.setTimeout(() => this._restorePosition(), 0);
    }

    ImpCounterManager.updateLauncher();
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = this._htmlRoot(html);
    if (!root) return;

    root.addEventListener("click", async (event) => {
      const stepButton = event.target.closest(".imp-counter-step");
      if (stepButton && root.contains(stepButton)) {
        event.preventDefault();
        event.stopPropagation();
        const delta = Number(stepButton.dataset.delta || 0);
        const multiplier = event.shiftKey ? 5 : 1;
        await advCounterRequestAdjust(this.counterKey, delta * multiplier);
        return;
      }

      const actionButton = event.target.closest("[data-action]");
      if (!actionButton || !root.contains(actionButton)) return;

      event.preventDefault();
      event.stopPropagation();

      if (actionButton.dataset.action === "close") {
        await this.close();
      }
    });

    const valueInput = root.querySelector(".imp-counter-value");
    valueInput?.addEventListener("focus", (event) => {
      event.currentTarget.select();
    });

    valueInput?.addEventListener("change", async (event) => {
      await advCounterRequestSet(this.counterKey, event.currentTarget.value);
    });

    valueInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      await advCounterRequestSet(this.counterKey, event.currentTarget.value);
      event.currentTarget.blur();
    });

    root.querySelector(".imp-counter-meta")?.addEventListener("mousedown", (event) => {
      this._startDrag(event);
    });
  }

  setPosition(position = {}) {
    let result;
    const element = this._getWindowElement();
    if (!element) {
      result = foundry.utils.mergeObject(this.position ?? {}, position, { inplace: false });
      if (this.position) Object.assign(this.position, result);
      return result;
    }

    try {
      result = super.setPosition(position);
    } catch (error) {
      if (!String(error?.message ?? "").includes("getComputedStyle")) throw error;
      this._applyPositionDirect(position);
      result = this.position ?? position;
    }

    this._schedulePositionSave(result);
    return result;
  }

  async close(options = {}) {
    this._savePositionNow();
    const result = await super.close(options);
    ImpCounterManager.updateLauncher();
    return result;
  }

  async togglePinned() {
    const state = advCounterState(this.counterKey);
    state.pinned = !state.pinned;
    await game.settings.set(ADV_COUNTER_MODULE_ID, advCounterConfig(this.counterKey).stateSetting, state);
    this._applyPinnedClass();
    this._getWindowElement()?.querySelector("[data-action='pin']")?.classList.toggle("is-active", Boolean(state.pinned));
  }

  _applyPinnedClass() {
    this._getWindowElement()?.classList.toggle("imp-counter-pinned", this.pinned);
  }

  _restorePosition() {
    const config = advCounterConfig(this.counterKey);
    const state = advCounterState(this.counterKey);
    const position = state.position || {
      left: config.defaultLeft,
      top: config.defaultTop,
      width: this.options.width
    };
    this._applyPositionDirect(position);
  }

  _schedulePositionSave(position) {
    if (!this.rendered || !position) return;
    window.clearTimeout(this._positionSaveTimer);
    this._positionSaveTimer = window.setTimeout(() => this._savePositionNow(), 250);
  }

  async _savePositionNow() {
    const element = this._getWindowElement();
    if (!element && !this.position) return;

    const rect = element?.getBoundingClientRect();
    const state = advCounterState(this.counterKey);
    state.position = {
      left: this.position?.left ?? rect?.left,
      top: this.position?.top ?? rect?.top,
      width: this.position?.width ?? rect?.width,
      height: this.position?.height ?? rect?.height
    };
    await game.settings.set(ADV_COUNTER_MODULE_ID, advCounterConfig(this.counterKey).stateSetting, state);
  }

  _getWindowElement() {
    const element = this.element;
    if (element instanceof HTMLElement) return element;
    if (element?.[0] instanceof HTMLElement) return element[0];
    return document.getElementById(this.id);
  }

  _htmlRoot(html) {
    if (html instanceof HTMLElement) return html;
    if (html?.[0] instanceof HTMLElement) return html[0];
    return this._getWindowElement();
  }

  _applyPositionDirect(position = {}) {
    const element = this._getWindowElement();
    if (!element) return;

    for (const key of ["left", "top", "width", "height"]) {
      if (Number.isFinite(position[key])) {
        element.style[key] = `${position[key]}px`;
      }
    }

    if (this.position) {
      Object.assign(this.position, position);
    }
  }

  _startDrag(event) {
    if (event.button !== 0) return;
    if (event.target.closest("button, input")) return;

    const element = this._getWindowElement();
    if (!element) return;
    if (this._resizeEdgesFromEvent(event, element)) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = element.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;

    const move = (moveEvent) => {
      const position = {
        left: startLeft + moveEvent.clientX - startX,
        top: startTop + moveEvent.clientY - startY,
        width: rect.width,
        height: rect.height
      };
      this._applyPositionDirect(position);
      this._schedulePositionSave(position);
    };

    const stop = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
      this._savePositionNow();
    };

    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
  }

  _bindEdgeResize() {
    const element = this._getWindowElement();
    if (!element) return;

    element.addEventListener("mousemove", this._onEdgeMouseMove);
    element.addEventListener("mouseleave", this._onEdgeMouseLeave);
    element.addEventListener("mousedown", this._onEdgeMouseDown);
  }

  _onEdgeMouseMove(event) {
    const element = this._getWindowElement();
    if (!element || this._edgeResizing) return;

    const edges = this._resizeEdgesFromEvent(event, element);
    element.style.cursor = this._cursorForEdges(edges);
  }

  _onEdgeMouseLeave() {
    const element = this._getWindowElement();
    if (!element || this._edgeResizing) return;
    element.style.cursor = "";
  }

  _onEdgeMouseDown(event) {
    const element = this._getWindowElement();
    if (!element || event.button !== 0) return;

    const edges = this._resizeEdgesFromEvent(event, element);
    if (!edges) return;

    event.preventDefault();
    event.stopPropagation();
    this._startEdgeResize(event, edges);
  }

  _resizeEdgesFromEvent(event, element) {
    if (event.target.closest("button, input")) return "";

    const rect = element.getBoundingClientRect();
    const threshold = 6;
    const nearLeft = event.clientX - rect.left <= threshold;
    const nearRight = rect.right - event.clientX <= threshold;
    const nearTop = event.clientY - rect.top <= threshold;
    const nearBottom = rect.bottom - event.clientY <= threshold;
    let edges = "";

    if (nearTop) edges += "n";
    if (nearBottom) edges += "s";
    if (nearLeft) edges += "w";
    if (nearRight) edges += "e";
    return edges;
  }

  _cursorForEdges(edges) {
    if (!edges) return "";
    if (["ne", "sw"].includes(edges)) return "nesw-resize";
    if (["nw", "se"].includes(edges)) return "nwse-resize";
    if (edges.includes("e") || edges.includes("w")) return "ew-resize";
    if (edges.includes("n") || edges.includes("s")) return "ns-resize";
    return "";
  }

  _startEdgeResize(event, edges) {
    const element = this._getWindowElement();
    if (!element) return;

    this._edgeResizing = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = element.getBoundingClientRect();
    const minWidth = 104;
    const minHeight = 70;

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let left = rect.left;
      let top = rect.top;
      let width = rect.width;
      let height = rect.height;

      if (edges.includes("e")) width = Math.max(minWidth, rect.width + dx);
      if (edges.includes("w")) {
        width = Math.max(minWidth, rect.width - dx);
        left = rect.right - width;
      }
      if (edges.includes("s")) height = Math.max(minHeight, rect.height + dy);
      if (edges.includes("n")) {
        height = Math.max(minHeight, rect.height - dy);
        top = rect.bottom - height;
      }

      const position = { left, top, width, height };
      this._applyPositionDirect(position);
      this._schedulePositionSave(position);
    };

    const stop = () => {
      this._edgeResizing = false;
      element.style.cursor = "";
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
      this._savePositionNow();
    };

    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
  }
}

const ImpCounterManager = {
  apps: new Map(),
  resetSnapshot: null,

  init() {
    this.createLauncher();
    this.updateLauncher();

    if (game.settings.get(ADV_COUNTER_MODULE_ID, "autoOpenWindows")) {
      this.openAll();
    }
  },

  getApp(key) {
    if (!this.apps.has(key)) {
      this.apps.set(key, new ImpCounterWindow(key));
    }
    return this.apps.get(key);
  },

  open(key) {
    this.getApp(key).render(true);
  },

  toggle(key) {
    const app = this.getApp(key);
    if (app.rendered) app.close();
    else app.render(true);
  },

  openAll() {
    for (const key of Object.keys(ADV_COUNTERS)) {
      this.open(key);
    }
  },

  closeAll() {
    for (const app of this.apps.values()) {
      if (app.rendered) app.close();
    }
  },

  toggleAll() {
    const anyRendered = Array.from(this.apps.values()).some((app) => app.rendered);
    if (anyRendered) this.closeAll();
    else this.openAll();
  },

  renderAll() {
    for (const app of this.apps.values()) {
      if (app.rendered) app.render(false);
    }
    this.updateLauncher();
  },

  createLauncher() {
    if (document.getElementById("imp-counter-launcher")) return;

    const launcher = document.createElement("div");
    launcher.id = "imp-counter-launcher";
    launcher.innerHTML = `
      <button type="button" data-action="toggle">
        <i class="fas fa-table-list"></i>
        <span class="imp-counter-adv-label"></span>
      </button>
      <button type="button" data-action="reset-toggle" class="imp-counter-launcher-reset">
        <i class="fas fa-rotate-right"></i>
        <span class="imp-counter-reset-label"></span>
      </button>
      <button type="button" data-counter="one">
        <span class="imp-counter-launcher-label"></span>
        <span class="imp-counter-launcher-value"></span>
      </button>
      <button type="button" data-counter="two">
        <span class="imp-counter-launcher-label"></span>
        <span class="imp-counter-launcher-value"></span>
      </button>
    `;

    launcher.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;

      const action = button.dataset.action;
      const counter = button.dataset.counter;
      if (action === "toggle") this.toggleAll();
      if (action === "reset-toggle") this.toggleResetCounters();
      if (counter) this.toggle(counter);
    });

    document.body.appendChild(launcher);
    this.updateLauncherVisibility();
    this.setupLauncherPositioning();
  },

  setupLauncherPositioning() {
    window.removeEventListener("resize", this._launcherResizeHandler);
    this._launcherResizeHandler = () => this.positionLauncher();
    window.addEventListener("resize", this._launcherResizeHandler);

    const players = document.getElementById("players");
    if (players && this._observedPlayers !== players) {
      this._playersObserver?.disconnect();
      this._observedPlayers = players;
      this._playersObserver = new MutationObserver(() => this.positionLauncher());
      this._playersObserver.observe(players, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }

    window.setTimeout(() => this.positionLauncher(), 0);
    window.setTimeout(() => this.positionLauncher(), 500);
  },

  positionLauncher() {
    const launcher = document.getElementById("imp-counter-launcher");
    if (!launcher) return;

    const players = document.getElementById("players");
    const defaultBottom = 78;
    let bottom = defaultBottom;

    if (players) {
      const rect = players.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      if (visible) {
        bottom = Math.max(defaultBottom, window.innerHeight - rect.top + 8);
      }
    }

    launcher.style.bottom = `${Math.round(bottom)}px`;
  },

  updateLauncher() {
    const launcher = document.getElementById("imp-counter-launcher");
    if (!launcher) return;

    launcher.querySelector("[data-action='toggle']")?.setAttribute("title", advCounterT("UI.ToggleWindowsTitle"));
    const advLabel = launcher.querySelector(".imp-counter-adv-label");
    if (advLabel) advLabel.textContent = advCounterT("UI.AdvButton");

    for (const key of Object.keys(ADV_COUNTERS)) {
      const button = launcher.querySelector(`[data-counter='${key}']`);
      if (!button) continue;

      button.setAttribute("title", advCounterT(key === "one" ? "UI.OpenCounterOneTitle" : "UI.OpenCounterTwoTitle"));
      button.querySelector(".imp-counter-launcher-label").textContent = `${advCounterLabel(key)}:`;
      button.querySelector(".imp-counter-launcher-value").textContent = advCounterValue(key);
      button.classList.toggle("is-open", Boolean(this.apps.get(key)?.rendered));
    }

    this.updateResetButton();
    this.updateLauncherVisibility();
    this.positionLauncher();
  },

  editableCounterKeys() {
    return Object.keys(ADV_COUNTERS).filter((key) => advCounterCanEdit(key));
  },

  currentValues(keys = Object.keys(ADV_COUNTERS)) {
    return Object.fromEntries(keys.map((key) => [key, advCounterValue(key)]));
  },

  valuesMatch(values) {
    if (!values) return false;
    return Object.entries(values).every(([key, value]) => advCounterValue(key) === value);
  },

  updateResetButton() {
    const button = document.querySelector("#imp-counter-launcher [data-action='reset-toggle']");
    if (!button) return;

    if (this.resetSnapshot?.pending && this.valuesMatch(this.resetSnapshot.after)) {
      this.resetSnapshot.pending = false;
    } else if (this.resetSnapshot && !this.resetSnapshot.pending && !this.valuesMatch(this.resetSnapshot.after)) {
      this.resetSnapshot = null;
    }

    const canUndo = Boolean(this.resetSnapshot);
    button.classList.toggle("can-undo", canUndo);
    button.title = canUndo ? advCounterT("UI.UndoCountersTitle") : advCounterT("UI.ResetCountersTitle");
    button.querySelector("i")?.classList.toggle("fa-rotate-left", canUndo);
    button.querySelector("i")?.classList.toggle("fa-rotate-right", !canUndo);
    button.querySelector(".imp-counter-reset-label").textContent = canUndo ? advCounterT("UI.UndoCountersLabel") : advCounterT("UI.ResetCountersLabel");
  },

  async toggleResetCounters() {
    const keys = this.editableCounterKeys();
    if (!keys.length) {
      ui.notifications.warn(advCounterT("Notifications.NoPermissionCounters"));
      return;
    }

    if (this.resetSnapshot && this.valuesMatch(this.resetSnapshot.after)) {
      const restoreEntries = Object.entries(this.resetSnapshot.before).filter(([key]) => keys.includes(key));
      this.resetSnapshot = null;
      for (const [key, value] of restoreEntries) {
        await advCounterRequestSet(key, value);
      }
      this.updateLauncher();
      return;
    }

    const before = this.currentValues(keys);
    const after = Object.fromEntries(keys.map((key) => [key, 0]));
    this.resetSnapshot = {
      before,
      after,
      pending: true
    };

    for (const key of keys) {
      await advCounterRequestSet(key, 0);
    }

    this.updateLauncher();
  },

  updateLauncherVisibility() {
    const hidden = !game.settings.get(ADV_COUNTER_MODULE_ID, "showLauncher");
    document.body.classList.toggle("imp-counter-launcher-hidden", hidden);
  }
};

function registerAdvCounterSettings() {
  const rerender = () => ImpCounterManager.renderAll();

  game.settings.register(ADV_COUNTER_MODULE_ID, "counterOneLabel", {
    name: "ADVCOUNTER.Settings.CounterOneLabel.Name",
    hint: "ADVCOUNTER.Settings.CounterOneLabel.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "Players Advantage",
    onChange: rerender
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "counterTwoLabel", {
    name: "ADVCOUNTER.Settings.CounterTwoLabel.Name",
    hint: "ADVCOUNTER.Settings.CounterTwoLabel.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "Enemies Advantage",
    onChange: rerender
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "allowPlayersCounterOne", {
    name: "ADVCOUNTER.Settings.AllowPlayersCounterOne.Name",
    hint: "ADVCOUNTER.Settings.AllowPlayersCounterOne.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: rerender
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "allowPlayersCounterTwo", {
    name: "ADVCOUNTER.Settings.AllowPlayersCounterTwo.Name",
    hint: "ADVCOUNTER.Settings.AllowPlayersCounterTwo.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: rerender
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "allowNegativeValues", {
    name: "ADVCOUNTER.Settings.AllowNegativeValues.Name",
    hint: "ADVCOUNTER.Settings.AllowNegativeValues.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: rerender
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "resetOnCombatStart", {
    name: "ADVCOUNTER.Settings.ResetOnCombatStart.Name",
    hint: "ADVCOUNTER.Settings.ResetOnCombatStart.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "autoOpenWindows", {
    name: "ADVCOUNTER.Settings.AutoOpenWindows.Name",
    hint: "ADVCOUNTER.Settings.AutoOpenWindows.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "autoOpenDefaultDisabledMigration", {
    name: "ADVCOUNTER.Settings.AutoOpenDefaultDisabledMigration.Name",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "showLauncher", {
    name: "ADVCOUNTER.Settings.ShowLauncher.Name",
    hint: "ADVCOUNTER.Settings.ShowLauncher.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ImpCounterManager.updateLauncherVisibility()
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "counterOneValue", {
    name: "ADVCOUNTER.Settings.CounterOneValue.Name",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: rerender
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "counterTwoValue", {
    name: "ADVCOUNTER.Settings.CounterTwoValue.Name",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: rerender
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "counterOneState", {
    name: "ADVCOUNTER.Settings.CounterOneState.Name",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(ADV_COUNTER_MODULE_ID, "counterTwoState", {
    name: "ADVCOUNTER.Settings.CounterTwoState.Name",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}

function registerAdvCounterCombatReset() {
  Hooks.on("createCombat", async () => {
    if (!advCounterIsPrimaryGM()) return;
    if (!game.settings.get(ADV_COUNTER_MODULE_ID, "resetOnCombatStart")) return;

    await advCounterSetValue("one", 0);
    await advCounterSetValue("two", 0);
  });
}

Hooks.once("init", () => {
  registerAdvCounterSettings();
});

async function migrateAdvCounterClientDefaults() {
  if (game.settings.get(ADV_COUNTER_MODULE_ID, "autoOpenDefaultDisabledMigration")) return;

  await game.settings.set(ADV_COUNTER_MODULE_ID, "autoOpenWindows", false);
  await game.settings.set(ADV_COUNTER_MODULE_ID, "autoOpenDefaultDisabledMigration", true);
}

Hooks.once("ready", async () => {
  registerAdvCounterCombatReset();
  await migrateAdvCounterClientDefaults();
  await advCounterEnsureStateJournal();
  ImpCounterManager.init();

  Hooks.on("renderPlayerList", () => {
    ImpCounterManager.setupLauncherPositioning();
  });

  Hooks.on("updateJournalEntry", (journal) => {
    if (journal.name === ADV_COUNTER_STATE_JOURNAL_NAME) ImpCounterManager.renderAll();
  });

  game.impCounter = {
    open: (key) => key ? ImpCounterManager.open(key) : ImpCounterManager.openAll(),
    toggle: (key) => key ? ImpCounterManager.toggle(key) : ImpCounterManager.toggleAll(),
    close: () => ImpCounterManager.closeAll(),
    set: advCounterRequestSet,
    adjust: advCounterRequestAdjust
  };
});
