"use strict";

// main.ts
var import_obsidian2 = require("obsidian");

// api.ts
var import_obsidian = require("obsidian");
var APIClient = class {
  constructor(options) {
    this.options = options;
  }
  async health() {
    const response = await (0, import_obsidian.requestUrl)({
      url: this.url("/healthz"),
      method: "GET"
    });
    return response.status === 200;
  }
  async login(email, password, deviceName) {
    return this.request("POST", "/api/v1/auth/login", {
      email,
      password,
      device_name: deviceName
    });
  }
  async bootstrapAnonymous(clientID, deviceName) {
    return this.request("POST", "/api/v1/auth/anonymous", {
      client_id: clientID,
      device_name: deviceName
    });
  }
  async logout() {
    await this.request("POST", "/api/v1/auth/logout");
  }
  async getNoteHashes() {
    return this.request("GET", "/api/v1/notes/hashes");
  }
  async syncNotes(notes, batchIndex, totalBatches) {
    return this.request("POST", "/api/v1/notes/sync", {
      notes: notes.map((note) => ({
        path: note.path,
        title: note.title,
        content: note.content,
        content_hash: note.contentHash,
        note_updated_at: note.noteUpdatedAt
      })),
      batch_index: batchIndex,
      total_batches: totalBatches
    });
  }
  async markDeleted(paths) {
    if (paths.length === 0) {
      return;
    }
    await this.request("POST", "/api/v1/notes/deleted", { paths });
  }
  async getUserSettings() {
    return this.request("GET", "/api/v1/user/settings");
  }
  async updateUserSettings(payload) {
    return this.request("PUT", "/api/v1/user/settings", payload);
  }
  async getPushHistory(page = 1, limit = 20) {
    const query = `?page=${page}&limit=${limit}`;
    return this.request("GET", `/api/v1/push/history${query}`);
  }
  async getPushHistoryDetail(id) {
    return this.request("GET", `/api/v1/push/history/${encodeURIComponent(id)}`);
  }
  async queueRecalls(items) {
    return this.request("POST", "/api/v1/recalls/queue", { items });
  }
  async getQueueStatus(days = 7) {
    return this.request("GET", `/api/v1/recalls/queue/status?days=${days}`);
  }
  async pushInstant(payload) {
    return this.request("POST", "/api/v1/push/instant", payload);
  }
  async getUserRSS() {
    return this.request("GET", "/api/v1/user/rss");
  }
  async resetUserRSS() {
    return this.request("POST", "/api/v1/user/rss/reset", {});
  }
  async request(method, path, body) {
    const response = await (0, import_obsidian.requestUrl)({
      url: this.url(path),
      method,
      headers: this.headers(body !== void 0),
      body: body !== void 0 ? JSON.stringify(body) : void 0
    });
    if (response.status >= 400) {
      let message = `Request failed with status ${response.status}`;
      try {
        const data = JSON.parse(response.text);
        if (typeof (data == null ? void 0 : data.message) === "string" && data.message) {
          message = data.message;
        }
      } catch (e) {
      }
      throw new Error(message);
    }
    if (!response.text) {
      return void 0;
    }
    return JSON.parse(response.text);
  }
  headers(withJSON) {
    const headers = {};
    if (withJSON) {
      headers["Content-Type"] = "application/json";
    }
    if (this.options.token) {
      headers.Authorization = `Bearer ${this.options.token}`;
    }
    return headers;
  }
  url(path) {
    const base = this.options.serverUrl.replace(/\/+$/, "");
    return `${base}${path}`;
  }
};

// crypto.ts
async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

// settings.ts
var DEFAULT_SETTINGS = {
  serverUrl: "https://recall.aieania.tech",
  clientId: "",
  token: "",
  pushTime: "08:00",
  timezone: "Asia/Shanghai",
  dailyPushCount: 1,
  queueWindowDays: 7,
  rssUrl: "",
  enableRSS: true,
  enableCubox: false,
  cuboxApiUrl: "",
  cuboxFolder: "",
  cuboxTags: [],
  syncMode: "local",
  excludedFolders: [],
  lastSyncAt: "",
  lastSyncCount: 0,
  queueCoveredDays: 0,
  queueLastDate: "",
  queueItemCount: 0,
  queueDailyCount: 1,
  pushedHistory: [],
  queuedHistory: [],
  lastAutoOpenDate: "",
  recallStates: {},
  debugLog: [],
  debugLastError: ""
};
function normalizeSettings(settings) {
  var _a, _b, _c, _d, _e, _f, _g;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    cuboxTags: (_a = settings.cuboxTags) != null ? _a : DEFAULT_SETTINGS.cuboxTags,
    excludedFolders: (_b = settings.excludedFolders) != null ? _b : DEFAULT_SETTINGS.excludedFolders,
    pushedHistory: (_c = settings.pushedHistory) != null ? _c : DEFAULT_SETTINGS.pushedHistory,
    queuedHistory: (_d = settings.queuedHistory) != null ? _d : DEFAULT_SETTINGS.queuedHistory,
    recallStates: (_e = settings.recallStates) != null ? _e : DEFAULT_SETTINGS.recallStates,
    debugLog: (_f = settings.debugLog) != null ? _f : DEFAULT_SETTINGS.debugLog,
    debugLastError: (_g = settings.debugLastError) != null ? _g : DEFAULT_SETTINGS.debugLastError
  };
}

// main.ts
var RECALL_MAIN_VIEW = "obsidian-recall-main-view";
var RECALL_SIDEBAR_VIEW = "obsidian-recall-sidebar-view";
var ObsidianRecallPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = normalizeSettings({});
    this.activeRecallPath = "";
  }
  async onload() {
    try {
      await this.loadSettings();
      await this.recordDebug("onload:start");
      this.registerView(RECALL_MAIN_VIEW, (leaf) => new RecallReaderView(leaf, this));
      this.registerView(RECALL_SIDEBAR_VIEW, (leaf) => new RecallSidebarView(leaf, this));
      this.addRibbonIcon("history", "Insight Flow", async () => {
        await this.openRecallReaderView();
      });
      this.addRibbonIcon("rocket", "\u4E00\u952E\u63A8\u9001\u5F53\u524D\u7B14\u8BB0", async () => {
        await this.pushActiveNoteNow();
      });
      this.addCommand({
        id: "obsidian-recall-clear-token",
        name: "\u6E05\u7A7A Insight Flow Token",
        callback: async () => {
          this.settings.token = "";
          await this.saveSettings();
          new import_obsidian2.Notice("Token \u5DF2\u6E05\u7A7A");
        }
      });
      this.addCommand({
        id: "obsidian-recall-open-today",
        name: "\u6253\u5F00\u4ECA\u65E5\u56DE\u987E",
        callback: async () => {
          await this.openRecallReaderView();
        }
      });
      this.addCommand({
        id: "obsidian-recall-open-sidebar",
        name: "\u6253\u5F00\u4ECA\u65E5\u56DE\u987E\u4FA7\u8FB9\u680F",
        callback: async () => {
          await this.openRecallSidebarView(true);
        }
      });
      this.addCommand({
        id: "obsidian-recall-sync-now",
        name: "\u7ACB\u5373\u540C\u6B65\u7B14\u8BB0",
        callback: async () => {
          await this.syncNow();
        }
      });
      this.addCommand({
        id: "obsidian-recall-push-active-note",
        name: "\u4E00\u952E\u63A8\u9001\u5F53\u524D\u7B14\u8BB0",
        callback: async () => {
          await this.pushActiveNoteNow();
        }
      });
      this.addCommand({
        id: "obsidian-recall-test-connection",
        name: "\u6D4B\u8BD5\u670D\u52A1\u7AEF\u8FDE\u63A5",
        callback: async () => {
          await this.testConnection();
        }
      });
      this.addCommand({
        id: "obsidian-recall-logout",
        name: "\u9000\u51FA\u5F53\u524D\u4F1A\u8BDD",
        callback: async () => {
          await this.logout();
        }
      });
      this.addCommand({
        id: "obsidian-recall-push-history",
        name: "\u67E5\u770B\u63A8\u9001\u5386\u53F2",
        callback: async () => {
          await this.viewPushHistory();
        }
      });
      this.addSettingTab(new RecallSettingTab(this.app, this));
      await this.recordDebug("onload:ready");
      this.app.workspace.onLayoutReady(() => {
        void this.runStartupFlow();
      });
    } catch (error) {
      console.error("Insight Flow \u52A0\u8F7D\u5931\u8D25", error);
      try {
        await this.recordDebug(`onload:error:${formatError(error)}`, true);
      } catch (e) {
      }
      new import_obsidian2.Notice(`Insight Flow \u52A0\u8F7D\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(RECALL_MAIN_VIEW);
    this.app.workspace.detachLeavesOfType(RECALL_SIDEBAR_VIEW);
  }
  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async logout() {
    if (!this.settings.token) {
      new import_obsidian2.Notice("\u5F53\u524D\u672A\u767B\u5F55");
      return;
    }
    try {
      await this.client().logout();
    } catch (e) {
    }
    this.settings.token = "";
    await this.saveSettings();
    new import_obsidian2.Notice("\u5DF2\u9000\u51FA\u767B\u5F55");
  }
  async testConnection() {
    try {
      const healthy = await this.client().health();
      new import_obsidian2.Notice(healthy ? "\u670D\u52A1\u7AEF\u8FDE\u63A5\u6B63\u5E38" : "\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u5F02\u5E38\u54CD\u5E94");
    } catch (error) {
      new import_obsidian2.Notice(`\u8FDE\u63A5\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async saveRemoteSettings() {
    var _a, _b, _c;
    if (!this.settings.token) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5B8C\u6210\u521D\u59CB\u5316\u6216\u914D\u7F6E Token\uFF0C\u518D\u4FDD\u5B58\u8BBE\u7F6E");
      return;
    }
    try {
      const response = await this.client().updateUserSettings({
        push_time: this.settings.pushTime,
        timezone: this.settings.timezone,
        enable_rss: this.settings.enableRSS,
        enable_cubox: this.settings.enableCubox,
        cubox_api_url: this.settings.cuboxApiUrl,
        cubox_folder: this.settings.cuboxFolder,
        cubox_tags: this.settings.cuboxTags,
        sync_mode: "local",
        daily_push_count: this.settings.dailyPushCount,
        excluded_folders: this.settings.excludedFolders,
        min_note_length: 0
      });
      this.settings.pushTime = response.push_time;
      this.settings.timezone = response.timezone;
      this.settings.enableRSS = (_a = response.enable_rss) != null ? _a : this.settings.enableRSS;
      this.settings.enableCubox = (_b = response.enable_cubox) != null ? _b : this.settings.enableCubox;
      this.settings.cuboxFolder = response.cubox_folder || this.settings.cuboxFolder;
      this.settings.cuboxTags = (_c = response.cubox_tags) != null ? _c : this.settings.cuboxTags;
      if (!this.settings.enableRSS) {
        this.settings.rssUrl = "";
      }
      if (this.shouldReplaceSecret(this.settings.cuboxApiUrl, response.cubox_api_url)) {
        this.settings.cuboxApiUrl = response.cubox_api_url;
      }
      this.settings.syncMode = "local";
      this.settings.dailyPushCount = response.daily_push_count || this.settings.dailyPushCount;
      this.settings.excludedFolders = response.excluded_folders;
      await this.saveSettings();
      new import_obsidian2.Notice("\u5DF2\u4FDD\u5B58");
    } catch (error) {
      new import_obsidian2.Notice(`\u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async refreshRemoteSettings() {
    if (!this.settings.token) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5B8C\u6210\u521D\u59CB\u5316\u6216\u914D\u7F6E Token\uFF0C\u518D\u8BFB\u53D6\u670D\u52A1\u7AEF\u8BBE\u7F6E");
      return;
    }
    try {
      await this.pullRemoteSettings();
      await this.saveSettings();
      new import_obsidian2.Notice("\u5DF2\u4ECE\u670D\u52A1\u7AEF\u8BFB\u53D6\u6700\u65B0\u8BBE\u7F6E");
    } catch (error) {
      new import_obsidian2.Notice(`\u8BFB\u53D6\u670D\u52A1\u7AEF\u8BBE\u7F6E\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async refreshUserRSS() {
    if (!this.settings.token) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5B8C\u6210\u521D\u59CB\u5316\u6216\u914D\u7F6E Token\uFF0C\u518D\u83B7\u53D6 RSS \u5730\u5740");
      return;
    }
    if (!this.settings.enableRSS) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5F00\u542F RSS \u63A8\u9001");
      return;
    }
    try {
      const response = await this.client().getUserRSS();
      this.settings.rssUrl = response.rss_url || "";
      await this.saveSettings();
      new import_obsidian2.Notice("RSS \u5730\u5740\u5DF2\u66F4\u65B0");
    } catch (error) {
      new import_obsidian2.Notice(`\u8BFB\u53D6 RSS \u5730\u5740\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async resetUserRSS() {
    if (!this.settings.token) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5B8C\u6210\u521D\u59CB\u5316\u6216\u914D\u7F6E Token\uFF0C\u518D\u91CD\u7F6E RSS \u5730\u5740");
      return;
    }
    if (!this.settings.enableRSS) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5F00\u542F RSS \u63A8\u9001");
      return;
    }
    try {
      const response = await this.client().resetUserRSS();
      this.settings.rssUrl = response.rss_url || "";
      await this.saveSettings();
      new import_obsidian2.Notice("RSS \u5730\u5740\u5DF2\u91CD\u7F6E");
    } catch (error) {
      new import_obsidian2.Notice(`\u91CD\u7F6E RSS \u5730\u5740\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async viewPushHistory() {
    if (!this.settings.token) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5B8C\u6210\u521D\u59CB\u5316\u6216\u914D\u7F6E Token\uFF0C\u518D\u67E5\u770B\u63A8\u9001\u5386\u53F2");
      return;
    }
    try {
      const history = await this.client().getPushHistory(1, 20);
      const modal = new PushHistoryModal(this.app, this.client(), history.items);
      modal.open();
    } catch (error) {
      new import_obsidian2.Notice(`\u8BFB\u53D6\u63A8\u9001\u5386\u53F2\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async syncNow() {
    if (!this.settings.token) {
      await this.recordDebug("sync:missing-token");
      new import_obsidian2.Notice("\u8BF7\u5148\u5B8C\u6210\u521D\u59CB\u5316\u6216\u914D\u7F6E Token\uFF0C\u518D\u540C\u6B65\u7B14\u8BB0");
      return;
    }
    try {
      await this.runLocalSyncMode();
    } catch (error) {
      await this.recordDebug(`sync:error:${formatError(error)}`, true);
      new import_obsidian2.Notice(`\u540C\u6B65\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async pushActiveNoteNow() {
    if (!this.settings.token) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5B8C\u6210\u521D\u59CB\u5316\u6216\u914D\u7F6E Token\uFF0C\u518D\u6267\u884C\u4E00\u952E\u63A8\u9001");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof import_obsidian2.TFile) || file.extension !== "md") {
      new import_obsidian2.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A Markdown \u7B14\u8BB0");
      return;
    }
    if (this.shouldSkip(file.path)) {
      new import_obsidian2.Notice("\u5F53\u524D\u7B14\u8BB0\u547D\u4E2D\u8FC7\u6EE4\u89C4\u5219\uFF0C\u65E0\u6CD5\u63A8\u9001");
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    if (!content.trim()) {
      new import_obsidian2.Notice("\u5F53\u524D\u7B14\u8BB0\u5185\u5BB9\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u63A8\u9001");
      return;
    }
    try {
      await this.pushCurrentSettingsToServer();
      const response = await this.client().pushInstant({
        path: file.path,
        title: file.basename,
        content,
        content_hash: await sha256Hex(content),
        note_updated_at: new Date(file.stat.mtime).toISOString()
      });
      if (response.pushed) {
        this.settings.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
        this.settings.lastSyncCount = 1;
        await this.saveSettings();
        await this.refreshRecallViews();
        new import_obsidian2.Notice("\u5DF2\u7ACB\u5373\u63A8\u9001\u5F53\u524D\u7B14\u8BB0");
        return;
      }
      new import_obsidian2.Notice("\u7ACB\u5373\u63A8\u9001\u5931\u8D25");
    } catch (error) {
      await this.recordDebug(`push-active:error:${formatError(error)}`, true);
      new import_obsidian2.Notice(`\u4E00\u952E\u63A8\u9001\u5931\u8D25\uFF1A${formatError(error)}`);
    }
  }
  async runLocalSyncMode() {
    await this.recordDebug("sync:local:start");
    const queueDays = Math.max(1, Math.min(30, this.settings.queueWindowDays || 7));
    this.settings.queueWindowDays = queueDays;
    new import_obsidian2.Notice(`\u5F00\u59CB\u8865\u9F50\u672A\u6765 ${queueDays} \u5929\u56DE\u987E\u961F\u5217`);
    const localNotes = await this.collectLocalNotes();
    await this.recordDebug(`sync:local:collected:${localNotes.length}`);
    if (localNotes.length === 0) {
      new import_obsidian2.Notice("\u6CA1\u6709\u627E\u5230\u7B26\u5408\u6761\u4EF6\u7684\u7B14\u8BB0");
      return;
    }
    await this.pushCurrentSettingsToServer();
    const queueStatus = await this.client().getQueueStatus(queueDays);
    const dailyCount = Math.max(1, Math.min(20, queueStatus.daily_push_count || this.settings.dailyPushCount || 1));
    this.settings.dailyPushCount = dailyCount;
    this.applyQueueMetrics(queueStatus);
    const plans = this.buildQueuePlans(localNotes, dailyCount, queueStatus.items, queueDays);
    if (plans.length === 0) {
      this.settings.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
      this.settings.lastSyncCount = 0;
      await this.saveSettings();
      new import_obsidian2.Notice(`\u672A\u6765 ${queueDays} \u5929\u961F\u5217\u5DF2\u6EE1\uFF0C\u65E0\u9700\u8865\u5145`);
      return;
    }
    const response = await this.client().queueRecalls(plans);
    const afterQueueStatus = await this.client().getQueueStatus(queueDays);
    this.applyQueueMetrics(afterQueueStatus);
    if (response.queued > 0) {
      this.settings.queuedHistory = this.normalizePushedHistory([
        ...this.settings.queuedHistory,
        ...plans.map((item) => ({
          path: item.path,
          pushedAt: `${item.scheduled_date}T00:00:00.000Z`
        }))
      ]);
    }
    if (response.queued === 0 && response.skipped > 0) {
      new import_obsidian2.Notice("\u6CA1\u6709\u53EF\u7528\u4E8E\u672C\u5730\u62BD\u53D6\u7684\u7B14\u8BB0");
    }
    this.settings.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
    this.settings.lastSyncCount = response.queued;
    this.settings.debugLastError = "";
    await this.saveSettings();
    await this.recordDebug(`sync:local:done:queued=${response.queued}:skipped=${response.skipped}`);
    new import_obsidian2.Notice(`\u961F\u5217\u8865\u5145\u5B8C\u6210\uFF1A\u65B0\u589E ${response.queued} \u6761\uFF0C\u8DF3\u8FC7 ${response.skipped} \u6761`);
  }
  async runStartupFlow() {
    try {
      await this.recordDebug("startup:begin");
      if (!this.settings.serverUrl) {
        await this.recordDebug("startup:no-server");
        return;
      }
      if (!this.settings.token) {
        await this.recordDebug("startup:bootstrap-anonymous");
        await this.bootstrapAnonymousSession();
      }
      if (this.settings.token) {
        await this.recordDebug("startup:pull-settings");
        try {
          await this.pullRemoteSettings();
          await this.saveSettings();
        } catch (error) {
          await this.recordDebug(`startup:pull-settings-skip:${formatError(error)}`, true);
        }
        await this.recordDebug("startup:sync");
        await this.syncNow();
        await this.maybeAutoOpenTodayRecall();
      } else {
        await this.recordDebug("startup:no-token");
      }
    } catch (error) {
      await this.recordDebug(`startup:error:${formatError(error)}`, true);
      console.error("Insight Flow startup flow failed", error);
    }
  }
  ensureClientID() {
    var _a;
    const current = (_a = this.settings.clientId) == null ? void 0 : _a.trim();
    if (current) {
      return current;
    }
    const generated = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `client-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    this.settings.clientId = generated;
    return generated;
  }
  async bootstrapAnonymousSession() {
    if (!this.settings.serverUrl) {
      return;
    }
    const clientID = this.ensureClientID();
    const response = await this.client().bootstrapAnonymous(clientID, `Obsidian ${this.app.vault.getName()}`);
    this.settings.token = response.token;
    await this.saveSettings();
  }
  buildPairCode() {
    const payload = {
      v: 1,
      server_url: this.settings.serverUrl.trim(),
      token: this.settings.token.trim()
    };
    return `orc1.${encodeBase64URL(JSON.stringify(payload))}`;
  }
  async showPairCodeExportModal() {
    const token = this.settings.token.trim();
    if (!token) {
      new import_obsidian2.Notice("\u5F53\u524D\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684 Token");
      return;
    }
    new PairCodeExportModal(this.app, this.buildPairCode()).open();
  }
  async showPairCodeImportModal() {
    new PairCodeImportModal(this.app, async (code) => {
      await this.importPairCode(code);
    }).open();
  }
  async importPairCode(rawCode) {
    var _a, _b, _c, _d;
    const code = rawCode.trim();
    if (!code) {
      throw new Error("\u914D\u5BF9\u7801\u4E3A\u7A7A");
    }
    let serverURL = "";
    let token = "";
    if (code.startsWith("orc1.")) {
      const decoded = decodeBase64URL(code.slice("orc1.".length));
      const payload = JSON.parse(decoded);
      serverURL = String((_a = payload.server_url) != null ? _a : "").trim();
      token = String((_b = payload.token) != null ? _b : "").trim();
    } else if (code.startsWith("{")) {
      const payload = JSON.parse(code);
      serverURL = String((_c = payload.server_url) != null ? _c : "").trim();
      token = String((_d = payload.token) != null ? _d : "").trim();
    } else {
      token = code;
    }
    if (!token) {
      throw new Error("\u914D\u5BF9\u7801\u91CC\u6CA1\u6709 Token");
    }
    if (serverURL) {
      this.settings.serverUrl = serverURL;
    }
    this.settings.token = token;
    await this.saveSettings();
    await this.pullRemoteSettings();
    await this.saveSettings();
  }
  async pullRemoteSettings() {
    var _a, _b, _c, _d;
    if (!this.settings.token) {
      return;
    }
    try {
      const remote = await this.client().getUserSettings();
      this.settings.pushTime = remote.push_time || this.settings.pushTime;
      this.settings.timezone = remote.timezone || this.settings.timezone;
      this.settings.enableRSS = (_a = remote.enable_rss) != null ? _a : this.settings.enableRSS;
      this.settings.enableCubox = (_b = remote.enable_cubox) != null ? _b : this.settings.enableCubox;
      this.settings.cuboxFolder = remote.cubox_folder || this.settings.cuboxFolder;
      this.settings.cuboxTags = (_c = remote.cubox_tags) != null ? _c : this.settings.cuboxTags;
      this.settings.syncMode = "local";
      this.settings.dailyPushCount = remote.daily_push_count || this.settings.dailyPushCount;
      this.settings.excludedFolders = (_d = remote.excluded_folders) != null ? _d : this.settings.excludedFolders;
      if (this.shouldReplaceSecret(this.settings.cuboxApiUrl, remote.cubox_api_url)) {
        this.settings.cuboxApiUrl = remote.cubox_api_url;
      }
      if (this.settings.token) {
        if (this.settings.enableRSS) {
          const rss = await this.client().getUserRSS();
          this.settings.rssUrl = rss.rss_url || this.settings.rssUrl;
        } else {
          this.settings.rssUrl = "";
        }
        const queueDays = Math.max(1, Math.min(30, this.settings.queueWindowDays || 7));
        const queueStatus = await this.client().getQueueStatus(queueDays);
        this.applyQueueMetrics(queueStatus);
      }
    } catch (error) {
      await this.recordDebug(`settings:pull-error:${formatError(error)}`, true);
      throw error;
    }
  }
  async recordDebug(message, isError = false) {
    const entry = `${(/* @__PURE__ */ new Date()).toISOString()} ${message}`;
    this.settings.debugLog = [...this.settings.debugLog.slice(-19), entry];
    if (isError) {
      this.settings.debugLastError = entry;
    }
    await this.saveData(this.settings);
  }
  async collectLocalNotes() {
    const files = this.app.vault.getMarkdownFiles();
    const notes = [];
    for (const file of files) {
      if (this.shouldSkip(file.path)) {
        continue;
      }
      const content = await this.app.vault.cachedRead(file);
      if (!content.trim()) {
        continue;
      }
      notes.push({
        path: file.path,
        title: file.basename,
        content,
        contentHash: await sha256Hex(content),
        noteUpdatedAt: new Date(file.stat.mtime).toISOString()
      });
    }
    return notes;
  }
  async pushCurrentSettingsToServer() {
    var _a, _b, _c;
    const response = await this.client().updateUserSettings({
      push_time: this.settings.pushTime,
      timezone: this.settings.timezone,
      enable_rss: this.settings.enableRSS,
      enable_cubox: this.settings.enableCubox,
      cubox_api_url: this.settings.cuboxApiUrl,
      cubox_folder: this.settings.cuboxFolder,
      cubox_tags: this.settings.cuboxTags,
      sync_mode: "local",
      daily_push_count: this.settings.dailyPushCount,
      excluded_folders: this.settings.excludedFolders,
      min_note_length: 0
    });
    this.settings.pushTime = response.push_time;
    this.settings.timezone = response.timezone;
    this.settings.enableRSS = (_a = response.enable_rss) != null ? _a : this.settings.enableRSS;
    this.settings.enableCubox = (_b = response.enable_cubox) != null ? _b : this.settings.enableCubox;
    this.settings.cuboxFolder = response.cubox_folder || this.settings.cuboxFolder;
    this.settings.cuboxTags = (_c = response.cubox_tags) != null ? _c : this.settings.cuboxTags;
    if (!this.settings.enableRSS) {
      this.settings.rssUrl = "";
    }
    if (this.shouldReplaceSecret(this.settings.cuboxApiUrl, response.cubox_api_url)) {
      this.settings.cuboxApiUrl = response.cubox_api_url;
    }
    this.settings.syncMode = "local";
    this.settings.dailyPushCount = response.daily_push_count || this.settings.dailyPushCount;
    this.settings.excludedFolders = response.excluded_folders;
  }
  pickLocalRecallNote(notes) {
    const history = this.normalizePushedHistory([...this.settings.pushedHistory, ...this.settings.queuedHistory]);
    const pick = (days) => {
      return notes.filter((note) => !this.wasPushedRecently(note.path, history, days));
    };
    const ninetyDayPool = pick(90);
    if (ninetyDayPool.length > 0) {
      return this.randomNote(ninetyDayPool);
    }
    const thirtyDayPool = pick(30);
    if (thirtyDayPool.length > 0) {
      return this.randomNote(thirtyDayPool);
    }
    return this.randomNote(notes);
  }
  buildQueuePlans(notes, dailyCount, existing, queueDays) {
    const plan = [];
    const existingKey = new Set(existing.map((item) => `${item.scheduled_date}#${item.slot_index}`));
    const recentHistory = this.normalizePushedHistory([...this.settings.pushedHistory, ...this.settings.queuedHistory]);
    const candidatePool = notes.filter((note) => !this.wasPushedRecently(note.path, recentHistory, 90));
    const fallbackPool = candidatePool.length > 0 ? candidatePool : notes;
    let rollingPool = [...fallbackPool];
    for (let day = 0; day < queueDays; day++) {
      const date = /* @__PURE__ */ new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + day);
      const yyyyMmDd = date.toISOString().slice(0, 10);
      for (let slot = 1; slot <= dailyCount; slot++) {
        const key = `${yyyyMmDd}#${slot}`;
        if (existingKey.has(key)) {
          continue;
        }
        if (rollingPool.length === 0) {
          rollingPool = [...fallbackPool];
        }
        const picked = this.randomNote(rollingPool);
        if (!picked) {
          continue;
        }
        rollingPool = rollingPool.filter((item) => item.path !== picked.path);
        plan.push({
          path: picked.path,
          title: picked.title,
          content: picked.content,
          content_hash: picked.contentHash,
          note_updated_at: picked.noteUpdatedAt,
          scheduled_date: yyyyMmDd,
          slot_index: slot
        });
      }
    }
    return plan;
  }
  pickNextQueueSlot(existing, dailyCount, queueDays) {
    const existingKey = new Set(existing.map((item) => `${item.scheduled_date}#${item.slot_index}`));
    for (let day = 0; day < queueDays; day++) {
      const date = /* @__PURE__ */ new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + day);
      const yyyyMmDd = date.toISOString().slice(0, 10);
      for (let slot = 1; slot <= dailyCount; slot++) {
        const key = `${yyyyMmDd}#${slot}`;
        if (!existingKey.has(key)) {
          return { scheduledDate: yyyyMmDd, slotIndex: slot };
        }
      }
    }
    return null;
  }
  randomNote(notes) {
    var _a;
    if (notes.length === 0) {
      return null;
    }
    const index = Math.floor(Math.random() * notes.length);
    return (_a = notes[index]) != null ? _a : null;
  }
  wasPushedRecently(path, history, days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
    return history.some((item) => {
      if (item.path !== path) {
        return false;
      }
      const pushedAt = new Date(item.pushedAt).getTime();
      return Number.isFinite(pushedAt) && pushedAt >= cutoff;
    });
  }
  normalizePushedHistory(history) {
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1e3;
    const latestByPath = /* @__PURE__ */ new Map();
    for (const item of history) {
      const path = item.path.trim();
      const pushedAtMs = new Date(item.pushedAt).getTime();
      if (!path || !Number.isFinite(pushedAtMs) || pushedAtMs < cutoff) {
        continue;
      }
      const existing = latestByPath.get(path);
      if (!existing || new Date(existing.pushedAt).getTime() < pushedAtMs) {
        latestByPath.set(path, { path, pushedAt: new Date(pushedAtMs).toISOString() });
      }
    }
    return Array.from(latestByPath.values()).sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
  }
  shouldSkip(path) {
    var _a;
    const segments = path.split("/");
    const fileName = (_a = segments[segments.length - 1]) != null ? _a : path;
    if (fileName.startsWith("_")) {
      return true;
    }
    const lowerPath = path.toLowerCase();
    for (const folder of this.settings.excludedFolders) {
      const normalized = folder.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      if (!normalized) {
        continue;
      }
      if (lowerPath === normalized || lowerPath.startsWith(`${normalized}/`)) {
        return true;
      }
    }
    return false;
  }
  client() {
    return new APIClient({
      serverUrl: this.settings.serverUrl,
      token: this.settings.token
    });
  }
  async openRecallReaderView() {
    var _a;
    const leaves = this.app.workspace.getLeavesOfType(RECALL_MAIN_VIEW);
    for (const extraLeaf of leaves.slice(1)) {
      extraLeaf.detach();
    }
    const leaf = (_a = leaves[0]) != null ? _a : this.app.workspace.getLeaf(true);
    if (!leaves[0]) {
      await leaf.setViewState({
        type: RECALL_MAIN_VIEW,
        active: true
      });
    }
    this.app.workspace.revealLeaf(leaf);
    await this.refreshRecallViews();
  }
  async openRecallSidebarView(reveal = false) {
    const leaves = this.app.workspace.getLeavesOfType(RECALL_SIDEBAR_VIEW);
    for (const extraLeaf of leaves.slice(1)) {
      extraLeaf.detach();
    }
    const existing = leaves[0];
    const leaf = existing != null ? existing : this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      return;
    }
    await leaf.setViewState({
      type: RECALL_SIDEBAR_VIEW,
      active: reveal
    });
    if (reveal) {
      this.app.workspace.revealLeaf(leaf);
    }
    await this.refreshRecallViews();
  }
  async refreshRecallViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(RECALL_MAIN_VIEW)) {
      const view = leaf.view;
      if (view instanceof RecallReaderView) {
        await view.render();
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(RECALL_SIDEBAR_VIEW)) {
      const view = leaf.view;
      if (view instanceof RecallSidebarView) {
        await view.render();
      }
    }
  }
  setActiveRecallPath(path) {
    this.activeRecallPath = path;
  }
  consumeActiveRecallPath() {
    const path = this.activeRecallPath;
    this.activeRecallPath = "";
    return path;
  }
  async getTodayRecallItems() {
    var _a, _b;
    const today = this.getLocalDateString();
    const queuedToday = this.settings.queuedHistory.filter((item) => item.pushedAt.startsWith(today));
    const queuedIndex = /* @__PURE__ */ new Map();
    queuedToday.forEach((item, index) => {
      if (!queuedIndex.has(item.path)) {
        queuedIndex.set(item.path, index + 1);
      }
    });
    const pushedToday = this.settings.pushedHistory.filter((item) => item.pushedAt.startsWith(today));
    const pushedIndex = /* @__PURE__ */ new Map();
    pushedToday.slice().reverse().forEach((item, index) => {
      if (!pushedIndex.has(item.path)) {
        pushedIndex.set(item.path, index + 1);
      }
    });
    const mergedPaths = /* @__PURE__ */ new Set([
      ...Array.from(queuedIndex.keys()),
      ...Array.from(pushedIndex.keys())
    ]);
    const items = [];
    for (const path of mergedPaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof import_obsidian2.TFile)) {
        continue;
      }
      const content = await this.app.vault.cachedRead(file);
      items.push({
        path,
        title: file.basename,
        content,
        slotIndex: (_b = (_a = queuedIndex.get(path)) != null ? _a : pushedIndex.get(path)) != null ? _b : 999,
        status: queuedIndex.has(path) ? "queued" : "done",
        sourceDate: today,
        file
      });
    }
    items.sort((a, b) => {
      if (a.slotIndex !== b.slotIndex) {
        return a.slotIndex - b.slotIndex;
      }
      return a.title.localeCompare(b.title, "zh-CN");
    });
    return items;
  }
  getFutureInventoryCount(days = 7) {
    const start = this.startOfLocalDay(/* @__PURE__ */ new Date());
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    return this.settings.queuedHistory.filter((item) => {
      const date = new Date(item.pushedAt);
      return date >= start && date < end;
    }).length;
  }
  getRecallState(date, path) {
    var _a;
    return (_a = this.settings.recallStates[this.recallStateKey(date, path)]) != null ? _a : {
      read: false,
      snoozed: false,
      revisit: false,
      updatedAt: ""
    };
  }
  async updateRecallState(date, path, patch) {
    const key = this.recallStateKey(date, path);
    const current = this.getRecallState(date, path);
    this.settings.recallStates[key] = {
      ...current,
      ...patch,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.saveSettings();
    await this.refreshRecallViews();
  }
  getTodayProgress(items) {
    const today = this.getLocalDateString();
    const read = items.filter((item) => this.getRecallState(today, item.path).read).length;
    return {
      total: items.length,
      read,
      remaining: Math.max(0, items.length - read)
    };
  }
  findNextUnreadIndex(items) {
    const today = this.getLocalDateString();
    return items.findIndex((item) => !this.getRecallState(today, item.path).read);
  }
  async revealSourceNote(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) {
      new import_obsidian2.Notice("\u539F\u7B14\u8BB0\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u52A8");
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }
  async maybeAutoOpenTodayRecall() {
    const today = this.getLocalDateString();
    if (this.settings.lastAutoOpenDate === today) {
      return;
    }
    const items = await this.getTodayRecallItems();
    if (items.length === 0) {
      return;
    }
    this.settings.lastAutoOpenDate = today;
    await this.saveSettings();
    await this.openRecallSidebarView(false);
    await this.openRecallReaderView();
  }
  recallStateKey(date, path) {
    return `${date}::${path}`;
  }
  startOfLocalDay(value) {
    const copy = new Date(value);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }
  getLocalDateString() {
    const value = this.startOfLocalDay(/* @__PURE__ */ new Date());
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  applyQueueMetrics(status) {
    var _a;
    const items = (_a = status.items) != null ? _a : [];
    const uniqueDays = new Set(items.map((item) => item.scheduled_date).filter(Boolean));
    const sortedDays = Array.from(uniqueDays).sort((a, b) => a.localeCompare(b));
    this.settings.queueCoveredDays = sortedDays.length;
    this.settings.queueLastDate = sortedDays.length > 0 ? sortedDays[sortedDays.length - 1] : "";
    this.settings.queueItemCount = items.length;
    this.settings.queueDailyCount = Math.max(1, Math.min(20, status.daily_push_count || this.settings.dailyPushCount || 1));
  }
  shouldReplaceSecret(localValue, remoteValue) {
    const remoteTrimmed = remoteValue.trim();
    if (!remoteTrimmed) {
      return false;
    }
    if (remoteTrimmed.includes("*")) {
      return false;
    }
    return !localValue.trim();
  }
};
var RecallReaderView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentIndex = 0;
  }
  getViewType() {
    return RECALL_MAIN_VIEW;
  }
  getDisplayText() {
    return "\u4ECA\u65E5\u56DE\u987E";
  }
  getIcon() {
    return "history";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-recall-reader-view");
    this.applyBottomOverlayOffset(contentEl);
    const items = await this.plugin.getTodayRecallItems();
    const progress = this.plugin.getTodayProgress(items);
    const firstUnread = this.plugin.findNextUnreadIndex(items);
    if (items.length === 0) {
      renderRecallEmptyState(contentEl, this.plugin, "\u4ECA\u5929\u8FD8\u6CA1\u6709\u53EF\u9605\u8BFB\u7684\u56DE\u987E\u5185\u5BB9\u3002");
      return;
    }
    const focusedPath = this.plugin.consumeActiveRecallPath();
    const focusedIndex = focusedPath ? items.findIndex((item) => item.path === focusedPath) : -1;
    if (focusedIndex >= 0) {
      this.currentIndex = focusedIndex;
    }
    if (firstUnread >= 0 && (this.currentIndex < 0 || this.currentIndex >= items.length)) {
      this.currentIndex = firstUnread;
    }
    if (this.currentIndex >= items.length) {
      this.currentIndex = items.length - 1;
    }
    if (this.currentIndex < 0) {
      this.currentIndex = 0;
    }
    const today = formatDateLabel(/* @__PURE__ */ new Date());
    const current = items[this.currentIndex];
    const state = this.plugin.getRecallState(current.sourceDate, current.path);
    const shell = contentEl.createDiv({ cls: "obsidian-recall-reader-shell" });
    const header = shell.createDiv({ cls: "obsidian-recall-reader-header" });
    const titleBlock = header.createDiv();
    titleBlock.createEl("div", { text: "\u4ECA\u65E5\u56DE\u987E", cls: "obsidian-recall-eyebrow" });
    titleBlock.createEl("h2", { text: today, cls: "obsidian-recall-reader-title" });
    const progressBar = shell.createDiv({ cls: "obsidian-recall-progress" });
    const progressFill = progressBar.createDiv({ cls: "obsidian-recall-progress-fill" });
    const progressPercent = items.length === 0 ? 0 : (this.currentIndex + 1) / items.length * 100;
    progressFill.style.width = `${progressPercent}%`;
    header.createDiv({
      cls: "obsidian-recall-progress-meta",
      text: `\u8FDB\u5EA6 ${this.currentIndex + 1}/${items.length}`
    });
    const card = shell.createDiv({ cls: "obsidian-recall-card" });
    const cardTop = card.createDiv({ cls: "obsidian-recall-card-top" });
    const titleWrap = cardTop.createDiv();
    titleWrap.createEl("h3", { text: current.title, cls: "obsidian-recall-card-title" });
    const pathEl = titleWrap.createDiv({ text: current.path, cls: "obsidian-recall-card-path" });
    pathEl.title = current.path;
    const badgeRow = cardTop.createDiv({ cls: "obsidian-recall-card-badges" });
    if (state.revisit) {
      badgeRow.createSpan({ text: "\u5DF2\u52A0\u5165\u518D\u56DE\u987E", cls: "obsidian-recall-badge obsidian-recall-badge-accent" });
    } else if (state.snoozed) {
      badgeRow.createSpan({ text: "\u7A0D\u540E\u518D\u770B", cls: "obsidian-recall-badge" });
    } else if (state.read) {
      badgeRow.createSpan({ text: "\u5DF2\u8BFB", cls: "obsidian-recall-badge obsidian-recall-badge-muted" });
    }
    const body = card.createDiv({ cls: "obsidian-recall-card-body markdown-rendered" });
    await import_obsidian2.MarkdownRenderer.render(this.app, current.content, body, current.path, this.plugin);
    if (progress.read >= progress.total) {
      const completion = card.createDiv({ cls: "obsidian-recall-completion" });
      completion.createDiv({ text: "\u4ECA\u5929\u7684\u56DE\u987E\u5DF2\u7ECF\u5904\u7406\u5B8C\u4E86\u3002", cls: "obsidian-recall-completion-title" });
      completion.createDiv({ text: `\u672A\u6765 7 \u5929\u5E93\u5B58 ${this.plugin.getFutureInventoryCount(7)} \u6761` });
    }
    const footer = shell.createDiv({ cls: "obsidian-recall-toolbar" });
    const prevButton = footer.createEl("button", { text: "\u4E0A\u4E00\u6761" });
    prevButton.disabled = this.currentIndex <= 0;
    prevButton.onclick = async () => {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
      await this.render();
    };
    const nextButton = footer.createEl("button", { text: "\u4E0B\u4E00\u6761" });
    nextButton.disabled = this.currentIndex >= items.length - 1;
    nextButton.onclick = async () => {
      this.currentIndex = Math.min(items.length - 1, this.currentIndex + 1);
      await this.render();
    };
    const readButton = footer.createEl("button", { text: state.read ? "\u5DF2\u8BFB\u5B8C\u6210" : "\u6807\u8BB0\u5DF2\u8BFB" });
    readButton.addClass("mod-cta");
    readButton.onclick = async () => {
      await this.plugin.updateRecallState(current.sourceDate, current.path, {
        read: true,
        snoozed: false
      });
      const refreshed = await this.plugin.getTodayRecallItems();
      const nextUnread = this.plugin.findNextUnreadIndex(refreshed);
      if (nextUnread >= 0) {
        this.currentIndex = nextUnread;
      }
      await this.render();
    };
    const snoozeButton = footer.createEl("button", { text: state.snoozed ? "\u5DF2\u7A0D\u540E" : "\u7A0D\u540E\u518D\u770B" });
    snoozeButton.onclick = async () => {
      await this.plugin.updateRecallState(current.sourceDate, current.path, {
        snoozed: !state.snoozed,
        read: false
      });
      await this.render();
    };
    const revisitButton = footer.createEl("button", { text: state.revisit ? "\u5DF2\u52A0\u5165\u518D\u56DE\u987E" : "\u52A0\u5165\u518D\u56DE\u987E" });
    revisitButton.onclick = async () => {
      await this.plugin.updateRecallState(current.sourceDate, current.path, {
        revisit: !state.revisit
      });
      await this.render();
    };
    const sourceButton = footer.createEl("button", { text: "\u6253\u5F00\u539F\u7B14\u8BB0" });
    sourceButton.onclick = async () => {
      await this.plugin.revealSourceNote(current.path);
    };
  }
  applyBottomOverlayOffset(contentEl) {
    var _a;
    const isMobileWidth = window.matchMedia("(max-width: 768px)").matches;
    const fallback = isMobileWidth ? 58 : 12;
    if (!isMobileWidth) {
      contentEl.style.setProperty("--recall-status-offset", `${fallback}px`);
      return;
    }
    const statusBar = document.querySelector(".status-bar");
    const statusHeight = (_a = statusBar == null ? void 0 : statusBar.getBoundingClientRect().height) != null ? _a : 0;
    const offset = Math.max(fallback, Math.ceil(statusHeight + 12));
    contentEl.style.setProperty("--recall-status-offset", `${offset}px`);
  }
};
var RecallSidebarView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return RECALL_SIDEBAR_VIEW;
  }
  getDisplayText() {
    return "\u56DE\u987E\u961F\u5217";
  }
  getIcon() {
    return "panel-right-open";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-recall-sidebar-view");
    const items = await this.plugin.getTodayRecallItems();
    const progress = this.plugin.getTodayProgress(items);
    const wrap = contentEl.createDiv({ cls: "obsidian-recall-sidebar-shell" });
    wrap.createEl("h3", { text: "\u6BCF\u65E5\u56DE\u987E", cls: "obsidian-recall-sidebar-title" });
    const stats = wrap.createDiv({ cls: "obsidian-recall-sidebar-stats" });
    stats.createDiv({ text: `\u4ECA\u65E5\u961F\u5217\uFF1A${progress.total} \u6761` });
    stats.createDiv({ text: `\u5DF2\u8BFB\uFF1A${progress.read} \u6761` });
    stats.createDiv({ text: `\u5269\u4F59\uFF1A${progress.remaining} \u6761` });
    stats.createDiv({ text: `\u672A\u6765 7 \u5929\u5E93\u5B58\uFF1A${this.plugin.getFutureInventoryCount(7)} \u6761` });
    const actionRow = wrap.createDiv({ cls: "obsidian-recall-sidebar-actions" });
    const openButton = actionRow.createEl("button", { text: "\u6253\u5F00\u4ECA\u65E5\u56DE\u987E" });
    openButton.addClass("mod-cta");
    openButton.onclick = async () => {
      await this.plugin.openRecallReaderView();
    };
    const refreshButton = actionRow.createEl("button", { text: "\u5237\u65B0\u961F\u5217" });
    refreshButton.onclick = async () => {
      await this.plugin.refreshRecallViews();
    };
    if (items.length === 0) {
      wrap.createDiv({ text: "\u4ECA\u5929\u8FD8\u6CA1\u6709\u53EF\u9605\u8BFB\u7684\u56DE\u987E\u5185\u5BB9\u3002", cls: "obsidian-recall-sidebar-empty" });
      return;
    }
    const list = wrap.createDiv({ cls: "obsidian-recall-sidebar-list" });
    for (const item of items) {
      const state = this.plugin.getRecallState(item.sourceDate, item.path);
      const row = list.createDiv({ cls: "obsidian-recall-sidebar-item" });
      row.tabIndex = 0;
      const top = row.createDiv({ cls: "obsidian-recall-sidebar-item-top" });
      top.createSpan({ text: item.title, cls: "obsidian-recall-sidebar-item-title" });
      top.createSpan({
        text: state.read ? "\u5DF2\u8BFB" : state.snoozed ? "\u7A0D\u540E" : "\u672A\u8BFB",
        cls: "obsidian-recall-sidebar-item-state"
      });
      row.createDiv({ text: item.path, cls: "obsidian-recall-sidebar-item-path" });
      const openItem = async () => {
        this.plugin.setActiveRecallPath(item.path);
        await this.plugin.openRecallReaderView();
      };
      row.onclick = () => {
        void openItem();
      };
      row.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void openItem();
        }
      };
    }
  }
};
function renderRecallEmptyState(containerEl, plugin, message) {
  const shell = containerEl.createDiv({ cls: "obsidian-recall-reader-shell" });
  const card = shell.createDiv({ cls: "obsidian-recall-card obsidian-recall-card-empty" });
  card.createEl("h3", { text: "\u4ECA\u65E5\u56DE\u987E", cls: "obsidian-recall-card-title" });
  card.createDiv({ text: message, cls: "obsidian-recall-empty-text" });
  const actions = card.createDiv({ cls: "obsidian-recall-toolbar" });
  const syncButton = actions.createEl("button", { text: "\u7ACB\u5373\u8865\u9F50\u961F\u5217" });
  syncButton.addClass("mod-cta");
  syncButton.onclick = async () => {
    await plugin.syncNow();
    await plugin.refreshRecallViews();
  };
}
var RecallSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("obsidian-recall-settings");
    containerEl.createEl("h2", { text: "Insight Flow \u8BBE\u7F6E" });
    containerEl.createEl("p", {
      text: "\u7528\u4E8E\u4ECE\u672C\u5730\u62BD\u53D6\u7B14\u8BB0\u5E76\u9884\u63D0\u4EA4\u5230\u670D\u52A1\u7AEF\uFF0C\u6309\u8BA1\u5212\u751F\u6210\u6BCF\u65E5\u56DE\u987E\uFF08RSS \u53EF\u8BA2\u9605\uFF09\u3002"
    });
    const statusLines = [
      this.plugin.settings.token ? "\u767B\u5F55\u72B6\u6001\uFF1A\u5DF2\u767B\u5F55" : "\u767B\u5F55\u72B6\u6001\uFF1A\u672A\u767B\u5F55",
      `\u540C\u6B65\u6A21\u5F0F\uFF1A\u672C\u5730\u62BD\u53D6\uFF08${Math.max(1, Math.min(30, this.plugin.settings.queueWindowDays || 7))}\u5929\u6EDA\u52A8\u9884\u63D0\u4EA4\uFF09`,
      `\u63A8\u9001\u901A\u9053\uFF1ARSS ${this.plugin.settings.enableRSS ? "\u5F00\u542F" : "\u5173\u95ED"} \xB7 Cubox ${this.plugin.settings.enableCubox ? "\u5F00\u542F" : "\u5173\u95ED"}`,
      this.plugin.settings.lastSyncAt ? `\u4E0A\u6B21\u540C\u6B65\uFF1A${new Date(this.plugin.settings.lastSyncAt).toLocaleString()}` : "\u4E0A\u6B21\u540C\u6B65\uFF1A\u6682\u65E0",
      `\u6700\u8FD1\u8865\u5145\u6761\u76EE\uFF1A${this.plugin.settings.lastSyncCount} \u6761`,
      `\u5E93\u5B58\u8986\u76D6\uFF1A${this.plugin.settings.queueCoveredDays} \u5929 \xB7 \u6BCF\u5929 ${this.plugin.settings.queueDailyCount} \u6761`,
      this.plugin.settings.queueLastDate ? `\u5DF2\u6392\u961F\u5230\uFF1A${this.plugin.settings.queueLastDate}` : "\u5DF2\u6392\u961F\u5230\uFF1A\u6682\u65E0",
      `\u961F\u5217\u603B\u6761\u76EE\uFF1A${this.plugin.settings.queueItemCount}`,
      this.plugin.settings.debugLastError ? `\u6700\u8FD1\u9519\u8BEF\uFF1A${this.plugin.settings.debugLastError}` : "\u6700\u8FD1\u9519\u8BEF\uFF1A\u65E0"
    ];
    containerEl.createEl("div", {
      cls: "obsidian-recall-settings-summary",
      text: statusLines.join("\n")
    });
    new import_obsidian2.Setting(containerEl).setName("\u670D\u52A1\u5668\u5730\u5740").setDesc("Insight Flow \u670D\u52A1\u7AEF\u5730\u5740").addText(
      (text) => text.setPlaceholder("https://your-recall-server.example").setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        this.plugin.settings.serverUrl = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u8BBF\u95EE Token").setDesc("\u9996\u6B21\u5B89\u88C5\u4F1A\u81EA\u52A8\u751F\u6210\u3002\u53EF\u624B\u52A8\u4FEE\u6539\uFF0C\u7528\u4E8E\u591A\u8BBE\u5907\u5171\u7528\u540C\u4E00\u7528\u6237\u8EAB\u4EFD\u3002").addText((text) => {
      text.inputEl.setAttribute("type", "text");
      text.setPlaceholder("token").setValue(this.plugin.settings.token).onChange(async (value) => {
        this.plugin.settings.token = value.trim();
        await this.plugin.saveSettings();
      });
    }).addButton(
      (button) => button.setIcon("copy").setTooltip("\u590D\u5236 Token").onClick(async () => {
        const token = this.plugin.settings.token.trim();
        if (!token) {
          new import_obsidian2.Notice("\u5F53\u524D\u6CA1\u6709\u53EF\u590D\u5236\u7684 Token");
          return;
        }
        await navigator.clipboard.writeText(token);
        new import_obsidian2.Notice("Token \u5DF2\u590D\u5236");
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u542F\u7528 RSS \u63A8\u9001").setDesc("\u5F00\u542F\u540E\u4F1A\u5199\u5165 RSS \u6761\u76EE\u5E76\u53EF\u5728\u5BA2\u6237\u7AEF\u8BA2\u9605").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableRSS).onChange(async (value) => {
        this.plugin.settings.enableRSS = value;
        if (!value) {
          this.plugin.settings.rssUrl = "";
        }
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (this.plugin.settings.enableRSS) {
      new import_obsidian2.Setting(containerEl).setName("RSS \u5730\u5740").setDesc("\u6BCF\u4E2A\u7528\u6237\u72EC\u7ACB\u7684\u79C1\u6709\u8BA2\u9605\u5730\u5740\uFF08\u53EA\u8BFB\uFF09").addText((text) => {
        text.setPlaceholder("\uFF08\u5C1A\u672A\u83B7\u53D6 RSS \u5730\u5740\uFF09").setValue(this.plugin.settings.rssUrl.trim()).setDisabled(true);
        text.inputEl.addClass("obsidian-recall-rss-input");
      }).addButton(
        (button) => button.setButtonText("\u83B7\u53D6").onClick(async () => {
          await this.plugin.refreshUserRSS();
          this.display();
        })
      ).addButton(
        (button) => button.setIcon("copy").setTooltip("\u590D\u5236 RSS \u5730\u5740").onClick(async () => {
          const value = this.plugin.settings.rssUrl.trim();
          if (!value) {
            new import_obsidian2.Notice("\u8BF7\u5148\u83B7\u53D6 RSS \u5730\u5740");
            return;
          }
          await navigator.clipboard.writeText(value);
          new import_obsidian2.Notice("RSS \u5730\u5740\u5DF2\u590D\u5236");
        })
      );
    }
    new import_obsidian2.Setting(containerEl).setName("\u542F\u7528 Cubox \u63A8\u9001").setDesc("\u5F00\u542F\u540E\u4F1A\u628A\u56DE\u987E\u5185\u5BB9\u901A\u8FC7 Cubox API \u5199\u5165\u4F60\u7684 Cubox").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableCubox).onChange(async (value) => {
        this.plugin.settings.enableCubox = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (this.plugin.settings.enableCubox) {
      new import_obsidian2.Setting(containerEl).setName("Cubox API \u5730\u5740").setDesc("\u5728 Cubox \u6269\u5C55\u4E2D\u5FC3\u548C\u81EA\u52A8\u5316\u4E2D\u590D\u5236\u7684 API \u94FE\u63A5").addText((text) => {
        text.inputEl.setAttribute("type", "password");
        text.setPlaceholder("https://...").setValue(this.plugin.settings.cuboxApiUrl).onChange(async (value) => {
          this.plugin.settings.cuboxApiUrl = value.trim();
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Cubox \u6536\u85CF\u5939").setDesc("\u53EF\u9009\uFF0C\u4E0D\u586B\u5219\u8FDB\u5165\u6536\u96C6\u7BB1").addText(
        (text) => text.setValue(this.plugin.settings.cuboxFolder).onChange(async (value) => {
          this.plugin.settings.cuboxFolder = value.trim();
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian2.Setting(containerEl).setName("Cubox \u6807\u7B7E").setDesc("\u53EF\u9009\uFF0C\u9017\u53F7\u5206\u9694\uFF0C\u4F8B\u5982 Obsidian, \u56DE\u987E").addText(
        (text) => text.setValue(this.plugin.settings.cuboxTags.join(", ")).onChange(async (value) => {
          this.plugin.settings.cuboxTags = value.split(",").map((item) => item.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        })
      );
    }
    new import_obsidian2.Setting(containerEl).setName("\u63A8\u9001\u65F6\u95F4").setDesc("\u6BCF\u5929\u63A8\u9001\u65F6\u95F4\uFF0C\u683C\u5F0F\u4E3A HH:MM").addText((text) => {
      text.inputEl.type = "time";
      text.setValue(this.plugin.settings.pushTime || "08:00").onChange(async (value) => {
        this.plugin.settings.pushTime = value.trim() || "08:00";
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u65F6\u533A").setDesc("IANA \u65F6\u533A\uFF0C\u4F8B\u5982 Asia/Shanghai").addText(
      (text) => text.setValue(this.plugin.settings.timezone).onChange(async (value) => {
        this.plugin.settings.timezone = value.trim() || "Asia/Shanghai";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u9884\u63D0\u4EA4\u5929\u6570").setDesc(
      "\u6BCF\u6B21\u6253\u5F00 Obsidian \u65F6\uFF0C\u4F1A\u628A\u672A\u6765 N \u5929\u7684\u56DE\u987E\u5E93\u5B58\u8865\u9F50\u5230\u670D\u52A1\u7AEF\uFF081-30 \u5929\uFF09\u3002\u5373\u4F7F\u4F60\u540E\u7EED\u51E0\u5929\u4E0D\u6253\u5F00 Obsidian\uFF0C\u670D\u52A1\u5668\u4E5F\u53EF\u6309\u8BA1\u5212\u6301\u7EED\u63A8\u9001\u3002"
    ).addButton((button) => {
      button.buttonEl.addClass("obsidian-recall-step-btn");
      return button.setButtonText("-").onClick(async () => {
        this.plugin.settings.queueWindowDays = Math.max(1, (this.plugin.settings.queueWindowDays || 7) - 1);
        await this.plugin.saveSettings();
        this.display();
      });
    }).addText((text) => {
      text.inputEl.addClass("obsidian-recall-step-input");
      return text.setValue(String(this.plugin.settings.queueWindowDays || 7)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.queueWindowDays = Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : 7;
        await this.plugin.saveSettings();
      });
    }).addButton((button) => {
      button.buttonEl.addClass("obsidian-recall-step-btn");
      return button.setButtonText("+").onClick(async () => {
        this.plugin.settings.queueWindowDays = Math.min(30, (this.plugin.settings.queueWindowDays || 7) + 1);
        await this.plugin.saveSettings();
        this.display();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u6BCF\u65E5\u63A8\u9001\u6761\u6570").setDesc("\u6BCF\u5929\u63A8\u9001\u591A\u5C11\u6761\uFF0C\u8303\u56F4 1-20").addButton((button) => {
      button.buttonEl.addClass("obsidian-recall-step-btn");
      return button.setButtonText("-").onClick(async () => {
        this.plugin.settings.dailyPushCount = Math.max(1, (this.plugin.settings.dailyPushCount || 1) - 1);
        await this.plugin.saveSettings();
        this.display();
      });
    }).addText((text) => {
      text.inputEl.addClass("obsidian-recall-step-input");
      return text.setValue(String(this.plugin.settings.dailyPushCount)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.dailyPushCount = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 1;
        await this.plugin.saveSettings();
      });
    }).addButton((button) => {
      button.buttonEl.addClass("obsidian-recall-step-btn");
      return button.setButtonText("+").onClick(async () => {
        this.plugin.settings.dailyPushCount = Math.min(20, (this.plugin.settings.dailyPushCount || 1) + 1);
        await this.plugin.saveSettings();
        this.display();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u6392\u9664\u6587\u4EF6\u5939").setDesc("\u7528\u9017\u53F7\u5206\u9694\u591A\u4E2A\u6587\u4EF6\u5939\u524D\u7F00\uFF0C\u4F8B\u5982 Templates, Daily Notes").addText(
      (text) => text.setValue(this.plugin.settings.excludedFolders.join(", ")).onChange(async (value) => {
        this.plugin.settings.excludedFolders = value.split(",").map((item) => item.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u4FDD\u5B58\u5230\u670D\u52A1\u7AEF").setDesc("\u70B9\u51FB\u540E\u5C06\u5F53\u524D\u9875\u9762\u914D\u7F6E\u5199\u5165\u670D\u52A1\u7AEF").addButton(
      (button) => button.setButtonText("\u4FDD\u5B58\u8BBE\u7F6E").setCta().onClick(async () => {
        await this.plugin.saveRemoteSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u64CD\u4F5C").setDesc("\u5E38\u7528\u64CD\u4F5C").addButton(
      (button) => button.setButtonText("\u9000\u51FA\u4F1A\u8BDD").onClick(async () => {
        await this.plugin.logout();
      })
    ).addButton(
      (button) => button.setButtonText("\u8BFB\u53D6\u914D\u7F6E").onClick(async () => {
        await this.plugin.refreshRemoteSettings();
      })
    ).addButton(
      (button) => button.setButtonText("\u4FDD\u5B58\u914D\u7F6E").onClick(async () => {
        await this.plugin.saveRemoteSettings();
      })
    ).addButton(
      (button) => button.setButtonText("\u5BFC\u51FA\u914D\u5BF9\u7801").onClick(async () => {
        await this.plugin.showPairCodeExportModal();
      })
    ).addButton(
      (button) => button.setButtonText("\u5BFC\u5165\u914D\u5BF9\u7801").onClick(async () => {
        await this.plugin.showPairCodeImportModal();
      })
    ).addButton(
      (button) => button.setButtonText("\u7ACB\u5373\u540C\u6B65").onClick(async () => {
        await this.plugin.syncNow();
      })
    );
  }
};
function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
var PushHistoryModal = class extends import_obsidian2.Modal {
  constructor(app, client, items) {
    super(app);
    this.client = client;
    this.items = items;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-recall-history-modal");
    contentEl.createEl("h3", { text: "\u63A8\u9001\u5386\u53F2\uFF08\u6700\u8FD1 20 \u6761\uFF09" });
    if (this.items.length === 0) {
      contentEl.createEl("p", { text: "\u6682\u65E0\u63A8\u9001\u5386\u53F2\u3002" });
      return;
    }
    for (const item of this.items) {
      const row = contentEl.createDiv({ cls: "obsidian-recall-history-item" });
      row.createDiv({ text: item.note_title || "(\u65E0\u6807\u9898)" });
      row.createDiv({ text: item.note_path, cls: "obsidian-recall-history-path" });
      row.createDiv({
        text: `\u63A8\u9001\u65F6\u95F4\uFF1A${formatDateTime(item.pushed_at)}`,
        cls: "obsidian-recall-history-time"
      });
      const buttonRow = row.createDiv({ cls: "obsidian-recall-history-actions" });
      const detailButton = buttonRow.createEl("button", { text: "\u67E5\u770B\u8BE6\u60C5" });
      detailButton.onclick = async () => {
        var _a, _b;
        try {
          const detail = await this.client.getPushHistoryDetail(item.id);
          const body = ((_a = detail.content) == null ? void 0 : _a.trim()) || ((_b = detail.summary) == null ? void 0 : _b.trim()) || "(\u65E0\u5185\u5BB9)";
          new DetailModal(this.app, detail.note_title || "(\u65E0\u6807\u9898)", detail.note_path, body, detail.pushed_at).open();
        } catch (error) {
          new import_obsidian2.Notice(`\u8BFB\u53D6\u8BE6\u60C5\u5931\u8D25\uFF1A${formatError(error)}`);
        }
      };
    }
  }
};
var DetailModal = class extends import_obsidian2.Modal {
  constructor(app, titleText, pathText, bodyText, pushedAt) {
    super(app);
    this.titleText = titleText;
    this.pathText = pathText;
    this.bodyText = bodyText;
    this.pushedAt = pushedAt;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-recall-history-modal");
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.pathText, cls: "obsidian-recall-history-path" });
    contentEl.createEl("p", {
      text: `\u63A8\u9001\u65F6\u95F4\uFF1A${formatDateTime(this.pushedAt)}`,
      cls: "obsidian-recall-history-time"
    });
    contentEl.createEl("pre", { text: this.bodyText, cls: "obsidian-recall-history-body" });
  }
};
var PairCodeExportModal = class extends import_obsidian2.Modal {
  constructor(app, pairCode) {
    super(app);
    this.pairCode = pairCode;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-recall-history-modal");
    contentEl.createEl("h3", { text: "\u8BBE\u5907\u914D\u5BF9\u7801" });
    const desc = contentEl.createEl("p", { text: "\u5728\u53E6\u4E00\u53F0\u8BBE\u5907\u7C98\u8D34\u8BE5\u914D\u5BF9\u7801\uFF0C\u5373\u53EF\u5171\u7528\u540C\u4E00\u7528\u6237\u8EAB\u4EFD\u3002" });
    desc.addClass("obsidian-recall-history-path");
    const input = contentEl.createEl("textarea");
    input.value = this.pairCode;
    input.readOnly = true;
    input.style.width = "100%";
    input.style.minHeight = "100px";
    input.style.resize = "vertical";
    const row = contentEl.createDiv({ cls: "obsidian-recall-history-actions" });
    const copyButton = row.createEl("button", { text: "\u590D\u5236\u914D\u5BF9\u7801" });
    copyButton.onclick = async () => {
      await navigator.clipboard.writeText(this.pairCode);
      new import_obsidian2.Notice("\u914D\u5BF9\u7801\u5DF2\u590D\u5236");
    };
  }
};
var PairCodeImportModal = class extends import_obsidian2.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-recall-history-modal");
    contentEl.createEl("h3", { text: "\u5BFC\u5165\u914D\u5BF9\u7801" });
    const input = contentEl.createEl("textarea");
    input.placeholder = "\u7C98\u8D34\u914D\u5BF9\u7801\u6216 Token";
    input.style.width = "100%";
    input.style.minHeight = "100px";
    input.style.resize = "vertical";
    const row = contentEl.createDiv({ cls: "obsidian-recall-history-actions" });
    const submit = row.createEl("button", { text: "\u5BFC\u5165\u5E76\u540C\u6B65\u914D\u7F6E" });
    submit.onclick = async () => {
      try {
        await this.onSubmit(input.value);
        new import_obsidian2.Notice("\u914D\u5BF9\u6210\u529F");
        this.close();
      } catch (error) {
        new import_obsidian2.Notice(`\u5BFC\u5165\u5931\u8D25\uFF1A${formatError(error)}`);
      }
    };
  }
};
function encodeBase64URL(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeBase64URL(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - normalized.length % 4) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
function formatDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}
function formatDateLabel(value) {
  return value.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}
module.exports = ObsidianRecallPlugin;
