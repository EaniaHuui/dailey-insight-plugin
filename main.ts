import { App, ItemView, MarkdownRenderer, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { APIClient, type PushHistoryItem, type QueueRecallItem } from "./api";
import { sha256Hex } from "./crypto";
import { normalizeSettings, type LocalPushHistoryItem, type RecallItemState, type RecallSettings } from "./settings";
import { type LocalNote } from "./sync";

const RECALL_MAIN_VIEW = "insight-flow-main-view";
const RECALL_SIDEBAR_VIEW = "insight-flow-sidebar-view";

type TodayRecallItem = {
	path: string;
	title: string;
	content: string;
	slotIndex: number;
	status: "queued" | "done";
	sourceDate: string;
	file?: TFile | null;
};

class ObsidianRecallPlugin extends Plugin {
	settings: RecallSettings = normalizeSettings({});
	private activeRecallPath = "";

	async onload(): Promise<void> {
		try {
			await this.loadSettings();
			await this.recordDebug("onload:start");

			this.registerView(RECALL_MAIN_VIEW, (leaf) => new RecallReaderView(leaf, this));
			this.registerView(RECALL_SIDEBAR_VIEW, (leaf) => new RecallSidebarView(leaf, this));

			this.addRibbonIcon("history", "Dailey Insight", async () => {
				await this.openRecallReaderView();
			});
			this.addRibbonIcon("rocket", "一键推送当前笔记", async () => {
				await this.pushActiveNoteNow();
			});

			this.addCommand({
			id: "insight-flow-clear-token",
			name: "清空 Dailey Insight Token",
			callback: async () => {
				this.settings.token = "";
				await this.saveSettings();
				new Notice("Token 已清空");
			}
		});

		this.addCommand({
			id: "insight-flow-open-today",
			name: "打开今日推荐",
			callback: async () => {
				await this.openRecallReaderView();
			}
		});

		this.addCommand({
			id: "insight-flow-open-sidebar",
			name: "打开今日推荐侧边栏",
			callback: async () => {
				await this.openRecallSidebarView(true);
			}
		});

		this.addCommand({
			id: "insight-flow-sync-now",
			name: "立即同步笔记",
			callback: async () => {
				await this.syncNow();
			}
		});
		this.addCommand({
			id: "insight-flow-push-active-note",
			name: "一键推送当前笔记",
			callback: async () => {
				await this.pushActiveNoteNow();
			}
		});

		this.addCommand({
			id: "insight-flow-test-connection",
			name: "测试服务端连接",
			callback: async () => {
				await this.testConnection();
			}
		});

		this.addCommand({
			id: "insight-flow-logout",
			name: "退出当前会话",
			callback: async () => {
				await this.logout();
			}
		});

		this.addCommand({
			id: "insight-flow-push-history",
			name: "查看推送历史",
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
			console.error("Dailey Insight 加载失败", error);
			try {
				await this.recordDebug(`onload:error:${formatError(error)}`, true);
			} catch {
				// ignore debug persistence errors
			}
			new Notice(`Dailey Insight 加载失败：${formatError(error)}`);
		}
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(RECALL_MAIN_VIEW);
		this.app.workspace.detachLeavesOfType(RECALL_SIDEBAR_VIEW);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async logout(): Promise<void> {
		if (!this.settings.token) {
			new Notice("当前未登录");
			return;
		}

		try {
			await this.client().logout();
		} catch {
			// Token is already invalid on the server. Clear it locally anyway.
		}

		this.settings.token = "";
		await this.saveSettings();
		new Notice("已退出登录");
	}

	async testConnection(): Promise<void> {
		try {
			const healthy = await this.client().health();
			new Notice(healthy ? "服务端连接正常" : "服务端返回了异常响应");
		} catch (error) {
			new Notice(`连接失败：${formatError(error)}`);
		}
	}

	async saveRemoteSettings(): Promise<void> {
		if (!this.settings.token) {
			new Notice("请先完成初始化或配置 Token，再保存设置");
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
			this.settings.enableRSS = response.enable_rss ?? this.settings.enableRSS;
			this.settings.enableCubox = response.enable_cubox ?? this.settings.enableCubox;
			this.settings.cuboxFolder = response.cubox_folder || this.settings.cuboxFolder;
			this.settings.cuboxTags = response.cubox_tags ?? this.settings.cuboxTags;
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
			new Notice("已保存");
		} catch (error) {
			new Notice(`保存设置失败：${formatError(error)}`);
		}
	}

	async refreshRemoteSettings(): Promise<void> {
		if (!this.settings.token) {
			new Notice("请先完成初始化或配置 Token，再读取服务端设置");
			return;
		}

		try {
			await this.pullRemoteSettings();
			await this.saveSettings();
			new Notice("已从服务端读取最新设置");
		} catch (error) {
			new Notice(`读取服务端设置失败：${formatError(error)}`);
		}
	}

	async refreshUserRSS(): Promise<void> {
		if (!this.settings.token) {
			new Notice("请先完成初始化或配置 Token，再获取 RSS 地址");
			return;
		}
		if (!this.settings.enableRSS) {
			new Notice("请先开启 RSS 推送");
			return;
		}
		try {
			const response = await this.client().getUserRSS();
			this.settings.rssUrl = response.rss_url || "";
			await this.saveSettings();
			new Notice("RSS 地址已更新");
		} catch (error) {
			new Notice(`读取 RSS 地址失败：${formatError(error)}`);
		}
	}

	async resetUserRSS(): Promise<void> {
		if (!this.settings.token) {
			new Notice("请先完成初始化或配置 Token，再重置 RSS 地址");
			return;
		}
		if (!this.settings.enableRSS) {
			new Notice("请先开启 RSS 推送");
			return;
		}
		try {
			const response = await this.client().resetUserRSS();
			this.settings.rssUrl = response.rss_url || "";
			await this.saveSettings();
			new Notice("RSS 地址已重置");
		} catch (error) {
			new Notice(`重置 RSS 地址失败：${formatError(error)}`);
		}
	}

	async viewPushHistory(): Promise<void> {
		if (!this.settings.token) {
			new Notice("请先完成初始化或配置 Token，再查看推送历史");
			return;
		}

		try {
			const history = await this.client().getPushHistory(1, 20);
			const modal = new PushHistoryModal(this.app, this.client(), history.items);
			modal.open();
		} catch (error) {
			new Notice(`读取推送历史失败：${formatError(error)}`);
		}
	}

	async syncNow(): Promise<void> {
		if (!this.settings.token) {
			await this.recordDebug("sync:missing-token");
			new Notice("请先完成初始化或配置 Token，再同步笔记");
			return;
		}

		try {
			await this.runLocalSyncMode();
		} catch (error) {
			await this.recordDebug(`sync:error:${formatError(error)}`, true);
			new Notice(`同步失败：${formatError(error)}`);
		}
	}

	async pushActiveNoteNow(): Promise<void> {
		if (!this.settings.token) {
			new Notice("请先完成初始化或配置 Token，再执行一键推送");
			return;
		}

		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			new Notice("请先打开一个 Markdown 笔记");
			return;
		}
		if (this.shouldSkip(file.path)) {
			new Notice("当前笔记命中过滤规则，无法推送");
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		if (!content.trim()) {
			new Notice("当前笔记内容为空，无法推送");
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
				this.settings.lastSyncAt = new Date().toISOString();
				this.settings.lastSyncCount = 1;
				await this.saveSettings();
				await this.refreshRecallViews();
				new Notice("已立即推送当前笔记");
				return;
			}
			new Notice("立即推送失败");
		} catch (error) {
			await this.recordDebug(`push-active:error:${formatError(error)}`, true);
			new Notice(`一键推送失败：${formatError(error)}`);
		}
	}

	private async runLocalSyncMode(): Promise<void> {
		await this.recordDebug("sync:local:start");
		const queueDays = Math.max(1, Math.min(30, this.settings.queueWindowDays || 7));
		this.settings.queueWindowDays = queueDays;
		new Notice(`开始补齐未来 ${queueDays} 天推荐队列`);

		const localNotes = await this.collectLocalNotes();
		await this.recordDebug(`sync:local:collected:${localNotes.length}`);
		if (localNotes.length === 0) {
			new Notice("没有找到符合条件的笔记");
			return;
		}

		await this.pushCurrentSettingsToServer();
		const queueStatus = await this.client().getQueueStatus(queueDays);
		const dailyCount = Math.max(1, Math.min(20, queueStatus.daily_push_count || this.settings.dailyPushCount || 1));
		this.settings.dailyPushCount = dailyCount;
		this.applyQueueMetrics(queueStatus);

		const plans = this.buildQueuePlans(localNotes, dailyCount, queueStatus.items, queueDays);
		if (plans.length === 0) {
			this.settings.lastSyncAt = new Date().toISOString();
			this.settings.lastSyncCount = 0;
			await this.saveSettings();
			new Notice(`未来 ${queueDays} 天队列已满，无需补充`);
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
			new Notice("没有可用于本地抽取的笔记");
		}
		this.settings.lastSyncAt = new Date().toISOString();
		this.settings.lastSyncCount = response.queued;
		this.settings.debugLastError = "";
		await this.saveSettings();
		await this.recordDebug(`sync:local:done:queued=${response.queued}:skipped=${response.skipped}`);

		new Notice(`队列补充完成：新增 ${response.queued} 条，跳过 ${response.skipped} 条`);
	}

	private async runStartupFlow(): Promise<void> {
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
			console.error("Dailey Insight startup flow failed", error);
		}
	}

	private ensureClientID(): string {
		const current = this.settings.clientId?.trim();
		if (current) {
			return current;
		}
		const generated =
			typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
				? crypto.randomUUID()
				: `client-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
		this.settings.clientId = generated;
		return generated;
	}

	private async bootstrapAnonymousSession(): Promise<void> {
		if (!this.settings.serverUrl) {
			return;
		}
		const clientID = this.ensureClientID();
		const response = await this.client().bootstrapAnonymous(clientID, `Obsidian ${this.app.vault.getName()}`);
		this.settings.token = response.token;
		await this.saveSettings();
	}

	private buildPairCode(): string {
		const payload = {
			v: 1,
			server_url: this.settings.serverUrl.trim(),
			token: this.settings.token.trim()
		};
		return `orc1.${encodeBase64URL(JSON.stringify(payload))}`;
	}

	async showPairCodeExportModal(): Promise<void> {
		const token = this.settings.token.trim();
		if (!token) {
			new Notice("当前没有可导出的 Token");
			return;
		}
		new PairCodeExportModal(this.app, this.buildPairCode()).open();
	}

	async showPairCodeImportModal(): Promise<void> {
		new PairCodeImportModal(this.app, async (code) => {
			await this.importPairCode(code);
		}).open();
	}

	private async importPairCode(rawCode: string): Promise<void> {
		const code = rawCode.trim();
		if (!code) {
			throw new Error("配对码为空");
		}

		let serverURL = "";
		let token = "";
		if (code.startsWith("orc1.")) {
			const decoded = decodeBase64URL(code.slice("orc1.".length));
			const payload = JSON.parse(decoded) as { server_url?: string; token?: string };
			serverURL = String(payload.server_url ?? "").trim();
			token = String(payload.token ?? "").trim();
		} else if (code.startsWith("{")) {
			const payload = JSON.parse(code) as { server_url?: string; token?: string };
			serverURL = String(payload.server_url ?? "").trim();
			token = String(payload.token ?? "").trim();
		} else {
			token = code;
		}

		if (!token) {
			throw new Error("配对码里没有 Token");
		}
		if (serverURL) {
			this.settings.serverUrl = serverURL;
		}
		this.settings.token = token;
		await this.saveSettings();
		await this.pullRemoteSettings();
		await this.saveSettings();
	}

	private async pullRemoteSettings(): Promise<void> {
		if (!this.settings.token) {
			return;
		}

		try {
			const remote = await this.client().getUserSettings();
			this.settings.pushTime = remote.push_time || this.settings.pushTime;
			this.settings.timezone = remote.timezone || this.settings.timezone;
			this.settings.enableRSS = remote.enable_rss ?? this.settings.enableRSS;
			this.settings.enableCubox = remote.enable_cubox ?? this.settings.enableCubox;
			this.settings.cuboxFolder = remote.cubox_folder || this.settings.cuboxFolder;
			this.settings.cuboxTags = remote.cubox_tags ?? this.settings.cuboxTags;
			this.settings.syncMode = "local";
			this.settings.dailyPushCount = remote.daily_push_count || this.settings.dailyPushCount;
			this.settings.excludedFolders = remote.excluded_folders ?? this.settings.excludedFolders;
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

	private async recordDebug(message: string, isError = false): Promise<void> {
		const entry = `${new Date().toISOString()} ${message}`;
		this.settings.debugLog = [...this.settings.debugLog.slice(-19), entry];
		if (isError) {
			this.settings.debugLastError = entry;
		}
		await this.saveData(this.settings);
	}

	private async collectLocalNotes(): Promise<LocalNote[]> {
		const files = this.app.vault.getMarkdownFiles();
		const notes: LocalNote[] = [];

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

	private async pushCurrentSettingsToServer(): Promise<void> {
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
		this.settings.enableRSS = response.enable_rss ?? this.settings.enableRSS;
		this.settings.enableCubox = response.enable_cubox ?? this.settings.enableCubox;
		this.settings.cuboxFolder = response.cubox_folder || this.settings.cuboxFolder;
		this.settings.cuboxTags = response.cubox_tags ?? this.settings.cuboxTags;
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

	private pickLocalRecallNote(notes: LocalNote[]): LocalNote | null {
		const history = this.normalizePushedHistory([...this.settings.pushedHistory, ...this.settings.queuedHistory]);
		const pick = (days: number): LocalNote[] => {
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

	private buildQueuePlans(
		notes: LocalNote[],
		dailyCount: number,
		existing: Array<{ scheduled_date: string; slot_index: number; path: string }>,
		queueDays: number
	): QueueRecallItem[] {
		const plan: QueueRecallItem[] = [];
		const existingKey = new Set(existing.map((item) => `${item.scheduled_date}#${item.slot_index}`));
		const recentHistory = this.normalizePushedHistory([...this.settings.pushedHistory, ...this.settings.queuedHistory]);
		const candidatePool = notes.filter((note) => !this.wasPushedRecently(note.path, recentHistory, 90));
		const fallbackPool = candidatePool.length > 0 ? candidatePool : notes;
		let rollingPool = [...fallbackPool];

		for (let day = 0; day < queueDays; day++) {
			const date = new Date();
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

	private pickNextQueueSlot(
		existing: Array<{ scheduled_date: string; slot_index: number; path: string }>,
		dailyCount: number,
		queueDays: number
	): { scheduledDate: string; slotIndex: number } | null {
		const existingKey = new Set(existing.map((item) => `${item.scheduled_date}#${item.slot_index}`));
		for (let day = 0; day < queueDays; day++) {
			const date = new Date();
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

	private randomNote(notes: LocalNote[]): LocalNote | null {
		if (notes.length === 0) {
			return null;
		}
		const index = Math.floor(Math.random() * notes.length);
		return notes[index] ?? null;
	}

	private wasPushedRecently(path: string, history: LocalPushHistoryItem[], days: number): boolean {
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		return history.some((item) => {
			if (item.path !== path) {
				return false;
			}
			const pushedAt = new Date(item.pushedAt).getTime();
			return Number.isFinite(pushedAt) && pushedAt >= cutoff;
		});
	}

	private normalizePushedHistory(history: LocalPushHistoryItem[]): LocalPushHistoryItem[] {
		const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
		const latestByPath = new Map<string, LocalPushHistoryItem>();

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

	private shouldSkip(path: string): boolean {
		const segments = path.split("/");
		const fileName = segments[segments.length - 1] ?? path;
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

	private client(): APIClient {
		return new APIClient({
			serverUrl: this.settings.serverUrl,
			token: this.settings.token
		});
	}

	async openRecallReaderView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(RECALL_MAIN_VIEW);
		for (const extraLeaf of leaves.slice(1)) {
			extraLeaf.detach();
		}
		const leaf = leaves[0] ?? this.app.workspace.getLeaf(true);
		if (!leaves[0]) {
			await leaf.setViewState({
				type: RECALL_MAIN_VIEW,
				active: true
			});
		}
		this.app.workspace.revealLeaf(leaf);
		await this.refreshRecallViews();
	}

	async openRecallSidebarView(reveal = false): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(RECALL_SIDEBAR_VIEW);
		for (const extraLeaf of leaves.slice(1)) {
			extraLeaf.detach();
		}
		const existing = leaves[0];
		const leaf = existing ?? this.app.workspace.getRightLeaf(true);
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

	async refreshRecallViews(): Promise<void> {
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

	setActiveRecallPath(path: string): void {
		this.activeRecallPath = path;
	}

	consumeActiveRecallPath(): string {
		const path = this.activeRecallPath;
		this.activeRecallPath = "";
		return path;
	}

	async getTodayRecallItems(): Promise<TodayRecallItem[]> {
		const today = this.getLocalDateString();
		const queuedToday = this.settings.queuedHistory.filter((item) => item.pushedAt.startsWith(today));
		const queuedIndex = new Map<string, number>();
		queuedToday.forEach((item, index) => {
			if (!queuedIndex.has(item.path)) {
				queuedIndex.set(item.path, index + 1);
			}
		});

		const pushedToday = this.settings.pushedHistory.filter((item) => item.pushedAt.startsWith(today));
		const pushedIndex = new Map<string, number>();
		pushedToday
			.slice()
			.reverse()
			.forEach((item, index) => {
				if (!pushedIndex.has(item.path)) {
					pushedIndex.set(item.path, index + 1);
				}
			});

		const mergedPaths = new Set<string>([
			...Array.from(queuedIndex.keys()),
			...Array.from(pushedIndex.keys())
		]);

		const items: TodayRecallItem[] = [];
		for (const path of mergedPaths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				continue;
			}
			const content = await this.app.vault.cachedRead(file);
			items.push({
				path,
				title: file.basename,
				content,
				slotIndex: queuedIndex.get(path) ?? pushedIndex.get(path) ?? 999,
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

	getFutureInventoryCount(days = 7): number {
		const start = this.startOfLocalDay(new Date());
		start.setDate(start.getDate() + 1);
		const end = new Date(start);
		end.setDate(end.getDate() + days);
		return this.settings.queuedHistory.filter((item) => {
			const date = new Date(item.pushedAt);
			return date >= start && date < end;
		}).length;
	}

	getRecallState(date: string, path: string): RecallItemState {
		return (
			this.settings.recallStates[this.recallStateKey(date, path)] ?? {
				read: false,
				snoozed: false,
				revisit: false,
				updatedAt: ""
			}
		);
	}

	async updateRecallState(date: string, path: string, patch: Partial<RecallItemState>): Promise<void> {
		const key = this.recallStateKey(date, path);
		const current = this.getRecallState(date, path);
		this.settings.recallStates[key] = {
			...current,
			...patch,
			updatedAt: new Date().toISOString()
		};
		await this.saveSettings();
		await this.refreshRecallViews();
	}

	getTodayProgress(items: TodayRecallItem[]): { total: number; read: number; remaining: number } {
		const today = this.getLocalDateString();
		const read = items.filter((item) => this.getRecallState(today, item.path).read).length;
		return {
			total: items.length,
			read,
			remaining: Math.max(0, items.length - read)
		};
	}

	findNextUnreadIndex(items: TodayRecallItem[]): number {
		const today = this.getLocalDateString();
		return items.findIndex((item) => !this.getRecallState(today, item.path).read);
	}

	async revealSourceNote(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice("原笔记不存在或已被移动");
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		this.app.workspace.revealLeaf(leaf);
	}

	async maybeAutoOpenTodayRecall(): Promise<void> {
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

	private recallStateKey(date: string, path: string): string {
		return `${date}::${path}`;
	}

	private startOfLocalDay(value: Date): Date {
		const copy = new Date(value);
		copy.setHours(0, 0, 0, 0);
		return copy;
	}

	private getLocalDateString(): string {
		const value = this.startOfLocalDay(new Date());
		const year = value.getFullYear();
		const month = String(value.getMonth() + 1).padStart(2, "0");
		const day = String(value.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	private applyQueueMetrics(status: { daily_push_count: number; items: Array<{ scheduled_date: string }> }): void {
		const items = status.items ?? [];
		const uniqueDays = new Set(items.map((item) => item.scheduled_date).filter(Boolean));
		const sortedDays = Array.from(uniqueDays).sort((a, b) => a.localeCompare(b));
		this.settings.queueCoveredDays = sortedDays.length;
		this.settings.queueLastDate = sortedDays.length > 0 ? sortedDays[sortedDays.length - 1] : "";
		this.settings.queueItemCount = items.length;
		this.settings.queueDailyCount = Math.max(1, Math.min(20, status.daily_push_count || this.settings.dailyPushCount || 1));
	}

	private shouldReplaceSecret(localValue: string, remoteValue: string): boolean {
		const remoteTrimmed = remoteValue.trim();
		if (!remoteTrimmed) {
			return false;
		}
		if (remoteTrimmed.includes("*")) {
			return false;
		}
		return !localValue.trim();
	}
}

class RecallReaderView extends ItemView {
	private currentIndex = 0;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: ObsidianRecallPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return RECALL_MAIN_VIEW;
	}

	getDisplayText(): string {
		return "今日推荐";
	}

	getIcon(): string {
		return "history";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("insight-flow-reader-view");
		this.applyBottomOverlayOffset(contentEl);

		const items = await this.plugin.getTodayRecallItems();
		const progress = this.plugin.getTodayProgress(items);
		const firstUnread = this.plugin.findNextUnreadIndex(items);
		if (items.length === 0) {
			renderRecallEmptyState(contentEl, this.plugin, "今天还没有可阅读的推荐内容。");
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

		const today = formatDateLabel(new Date());
		const current = items[this.currentIndex];
		const state = this.plugin.getRecallState(current.sourceDate, current.path);

		const shell = contentEl.createDiv({ cls: "insight-flow-reader-shell" });
		const header = shell.createDiv({ cls: "insight-flow-reader-header" });
		const titleBlock = header.createDiv();
		titleBlock.createEl("div", { text: "今日推荐", cls: "insight-flow-eyebrow" });
		titleBlock.createEl("h2", { text: today, cls: "insight-flow-reader-title" });

		const progressBar = shell.createDiv({ cls: "insight-flow-progress" });
		const progressFill = progressBar.createDiv({ cls: "insight-flow-progress-fill" });
		const progressPercent = items.length === 0 ? 0 : ((this.currentIndex + 1) / items.length) * 100;
		progressFill.style.width = `${progressPercent}%`;
		header.createDiv({
			cls: "insight-flow-progress-meta",
			text: `进度 ${this.currentIndex + 1}/${items.length}`
		});

		const card = shell.createDiv({ cls: "insight-flow-card" });
		const cardTop = card.createDiv({ cls: "insight-flow-card-top" });
		const titleWrap = cardTop.createDiv();
		titleWrap.createEl("h3", { text: current.title, cls: "insight-flow-card-title" });
		const pathEl = titleWrap.createDiv({ text: current.path, cls: "insight-flow-card-path" });
		pathEl.title = current.path;
		const badgeRow = cardTop.createDiv({ cls: "insight-flow-card-badges" });
		if (state.revisit) {
			badgeRow.createSpan({ text: "已加入再推荐", cls: "insight-flow-badge insight-flow-badge-accent" });
		} else if (state.snoozed) {
			badgeRow.createSpan({ text: "稍后再看", cls: "insight-flow-badge" });
		} else if (state.read) {
			badgeRow.createSpan({ text: "已读", cls: "insight-flow-badge insight-flow-badge-muted" });
		}

		const body = card.createDiv({ cls: "insight-flow-card-body markdown-rendered" });
		await MarkdownRenderer.render(this.app, current.content, body, current.path, this.plugin);

		if (progress.read >= progress.total) {
			const completion = card.createDiv({ cls: "insight-flow-completion" });
			completion.createDiv({ text: "今天的推荐已经处理完了。", cls: "insight-flow-completion-title" });
			completion.createDiv({ text: `未来 7 天库存 ${this.plugin.getFutureInventoryCount(7)} 条` });
		}

		const footer = shell.createDiv({ cls: "insight-flow-toolbar" });
		const prevButton = footer.createEl("button", { text: "上一条" });
		prevButton.disabled = this.currentIndex <= 0;
		prevButton.onclick = async () => {
			this.currentIndex = Math.max(0, this.currentIndex - 1);
			await this.render();
		};

		const nextButton = footer.createEl("button", { text: "下一条" });
		nextButton.disabled = this.currentIndex >= items.length - 1;
		nextButton.onclick = async () => {
			this.currentIndex = Math.min(items.length - 1, this.currentIndex + 1);
			await this.render();
		};

		const readButton = footer.createEl("button", { text: state.read ? "已读完成" : "标记已读" });
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

		const snoozeButton = footer.createEl("button", { text: state.snoozed ? "已稍后" : "稍后再看" });
		snoozeButton.onclick = async () => {
			await this.plugin.updateRecallState(current.sourceDate, current.path, {
				snoozed: !state.snoozed,
				read: false
			});
			await this.render();
		};

		const revisitButton = footer.createEl("button", { text: state.revisit ? "已加入再推荐" : "加入再推荐" });
		revisitButton.onclick = async () => {
			await this.plugin.updateRecallState(current.sourceDate, current.path, {
				revisit: !state.revisit
			});
			await this.render();
		};

		const sourceButton = footer.createEl("button", { text: "打开原笔记" });
		sourceButton.onclick = async () => {
			await this.plugin.revealSourceNote(current.path);
		};
	}

	private applyBottomOverlayOffset(contentEl: HTMLElement): void {
		const isMobileWidth = window.matchMedia("(max-width: 768px)").matches;
		const fallback = isMobileWidth ? 58 : 12;
		if (!isMobileWidth) {
			contentEl.style.setProperty("--recall-status-offset", `${fallback}px`);
			return;
		}
		const statusBar = document.querySelector(".status-bar") as HTMLElement | null;
		const statusHeight = statusBar?.getBoundingClientRect().height ?? 0;
		const offset = Math.max(fallback, Math.ceil(statusHeight + 12));
		contentEl.style.setProperty("--recall-status-offset", `${offset}px`);
	}
}

class RecallSidebarView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private readonly plugin: ObsidianRecallPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return RECALL_SIDEBAR_VIEW;
	}

	getDisplayText(): string {
		return "推荐队列";
	}

	getIcon(): string {
		return "panel-right-open";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("insight-flow-sidebar-view");

		const items = await this.plugin.getTodayRecallItems();
		const progress = this.plugin.getTodayProgress(items);

		const wrap = contentEl.createDiv({ cls: "insight-flow-sidebar-shell" });
		wrap.createEl("h3", { text: "每日推荐", cls: "insight-flow-sidebar-title" });

		const stats = wrap.createDiv({ cls: "insight-flow-sidebar-stats" });
		stats.createDiv({ text: `今日队列：${progress.total} 条` });
		stats.createDiv({ text: `已读：${progress.read} 条` });
		stats.createDiv({ text: `剩余：${progress.remaining} 条` });
		stats.createDiv({ text: `未来 7 天库存：${this.plugin.getFutureInventoryCount(7)} 条` });

		const actionRow = wrap.createDiv({ cls: "insight-flow-sidebar-actions" });
		const openButton = actionRow.createEl("button", { text: "打开今日推荐" });
		openButton.addClass("mod-cta");
		openButton.onclick = async () => {
			await this.plugin.openRecallReaderView();
		};

		const refreshButton = actionRow.createEl("button", { text: "刷新队列" });
		refreshButton.onclick = async () => {
			await this.plugin.refreshRecallViews();
		};

		if (items.length === 0) {
			wrap.createDiv({ text: "今天还没有可阅读的推荐内容。", cls: "insight-flow-sidebar-empty" });
			return;
		}

		const list = wrap.createDiv({ cls: "insight-flow-sidebar-list" });
		for (const item of items) {
			const state = this.plugin.getRecallState(item.sourceDate, item.path);
			const row = list.createDiv({ cls: "insight-flow-sidebar-item" });
			row.tabIndex = 0;
			const top = row.createDiv({ cls: "insight-flow-sidebar-item-top" });
			top.createSpan({ text: item.title, cls: "insight-flow-sidebar-item-title" });
			top.createSpan({
				text: state.read ? "已读" : state.snoozed ? "稍后" : "未读",
				cls: "insight-flow-sidebar-item-state"
			});
			row.createDiv({ text: item.path, cls: "insight-flow-sidebar-item-path" });
			const openItem = async (): Promise<void> => {
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
}

function renderRecallEmptyState(containerEl: HTMLElement, plugin: ObsidianRecallPlugin, message: string): void {
	const shell = containerEl.createDiv({ cls: "insight-flow-reader-shell" });
	const card = shell.createDiv({ cls: "insight-flow-card insight-flow-card-empty" });
	card.createEl("h3", { text: "今日推荐", cls: "insight-flow-card-title" });
	card.createDiv({ text: message, cls: "insight-flow-empty-text" });
	const actions = card.createDiv({ cls: "insight-flow-toolbar" });
	const syncButton = actions.createEl("button", { text: "立即补齐队列" });
	syncButton.addClass("mod-cta");
	syncButton.onclick = async () => {
		await plugin.syncNow();
		await plugin.refreshRecallViews();
	};
}

class RecallSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: ObsidianRecallPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("insight-flow-settings");
		containerEl.createEl("h2", { text: "Dailey Insight 设置" });
		containerEl.createEl("p", {
			text: "用于从本地抽取笔记并预提交到服务端，按计划生成每日推荐（RSS 可订阅）。"
		});

		const statusLines = [
			this.plugin.settings.token ? "登录状态：已登录" : "登录状态：未登录",
			`同步模式：本地抽取（${Math.max(1, Math.min(30, this.plugin.settings.queueWindowDays || 7))}天滚动预提交）`,
			`推送通道：RSS ${this.plugin.settings.enableRSS ? "开启" : "关闭"} · Cubox ${this.plugin.settings.enableCubox ? "开启" : "关闭"}`,
			this.plugin.settings.lastSyncAt
				? `上次同步：${new Date(this.plugin.settings.lastSyncAt).toLocaleString()}`
				: "上次同步：暂无",
			`最近补充条目：${this.plugin.settings.lastSyncCount} 条`,
			`库存覆盖：${this.plugin.settings.queueCoveredDays} 天 · 每天 ${this.plugin.settings.queueDailyCount} 条`,
			this.plugin.settings.queueLastDate ? `已排队到：${this.plugin.settings.queueLastDate}` : "已排队到：暂无",
			`队列总条目：${this.plugin.settings.queueItemCount}`,
			this.plugin.settings.debugLastError ? `最近错误：${this.plugin.settings.debugLastError}` : "最近错误：无"
		];
		containerEl.createEl("div", {
			cls: "insight-flow-settings-summary",
			text: statusLines.join("\n")
		});

		new Setting(containerEl)
			.setName("服务器地址")
			.setDesc("Dailey Insight 服务端地址")
			.addText((text) =>
				text
					.setPlaceholder("https://your-recall-server.example")
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (value) => {
						this.plugin.settings.serverUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("访问 Token")
			.setDesc("首次安装会自动生成。可手动修改，用于多设备共用同一用户身份。")
			.addText((text) => {
				text.inputEl.setAttribute("type", "text");
				text
					.setPlaceholder("token")
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value.trim();
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button
					.setIcon("copy")
					.setTooltip("复制 Token")
					.onClick(async () => {
						const token = this.plugin.settings.token.trim();
						if (!token) {
							new Notice("当前没有可复制的 Token");
							return;
						}
						await navigator.clipboard.writeText(token);
						new Notice("Token 已复制");
					})
			);

		new Setting(containerEl)
			.setName("启用 RSS 推送")
			.setDesc("开启后会写入 RSS 条目并可在客户端订阅")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableRSS).onChange(async (value) => {
					this.plugin.settings.enableRSS = value;
					if (!value) {
						this.plugin.settings.rssUrl = "";
					}
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (this.plugin.settings.enableRSS) {
			new Setting(containerEl)
				.setName("RSS 地址")
				.setDesc("每个用户独立的私有订阅地址（只读）")
				.addText((text) => {
					text
						.setPlaceholder("（尚未获取 RSS 地址）")
						.setValue(this.plugin.settings.rssUrl.trim())
						.setDisabled(true);
					text.inputEl.addClass("insight-flow-rss-input");
				})
				.addButton((button) =>
					button
						.setButtonText("获取")
						.onClick(async () => {
							await this.plugin.refreshUserRSS();
							this.display();
						})
				)
				.addButton((button) =>
					button
						.setIcon("copy")
						.setTooltip("复制 RSS 地址")
						.onClick(async () => {
							const value = this.plugin.settings.rssUrl.trim();
							if (!value) {
								new Notice("请先获取 RSS 地址");
								return;
							}
							await navigator.clipboard.writeText(value);
							new Notice("RSS 地址已复制");
						})
				);
		}

		new Setting(containerEl)
			.setName("启用 Cubox 推送")
			.setDesc("开启后会把推荐内容通过 Cubox API 写入你的 Cubox")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableCubox).onChange(async (value) => {
					this.plugin.settings.enableCubox = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (this.plugin.settings.enableCubox) {
			new Setting(containerEl)
				.setName("Cubox API 地址")
				.setDesc("在 Cubox 扩展中心和自动化中复制的 API 链接")
				.addText((text) => {
					text.inputEl.setAttribute("type", "password");
					text
						.setPlaceholder("https://...")
						.setValue(this.plugin.settings.cuboxApiUrl)
						.onChange(async (value) => {
							this.plugin.settings.cuboxApiUrl = value.trim();
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl)
				.setName("Cubox 收藏夹")
				.setDesc("可选，不填则进入收集箱")
				.addText((text) =>
					text.setValue(this.plugin.settings.cuboxFolder).onChange(async (value) => {
						this.plugin.settings.cuboxFolder = value.trim();
						await this.plugin.saveSettings();
					})
				);

			new Setting(containerEl)
				.setName("Cubox 标签")
				.setDesc("可选，逗号分隔，例如 Obsidian, 推荐")
				.addText((text) =>
					text.setValue(this.plugin.settings.cuboxTags.join(", ")).onChange(async (value) => {
						this.plugin.settings.cuboxTags = value
							.split(",")
							.map((item) => item.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					})
				);
		}

		new Setting(containerEl)
			.setName("推送时间")
			.setDesc("每天推送时间，格式为 HH:MM")
			.addText((text) => {
				text.inputEl.type = "time";
				text
					.setValue(this.plugin.settings.pushTime || "08:00")
					.onChange(async (value) => {
						this.plugin.settings.pushTime = value.trim() || "08:00";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("时区")
			.setDesc("IANA 时区，例如 Asia/Shanghai")
			.addText((text) =>
				text.setValue(this.plugin.settings.timezone).onChange(async (value) => {
					this.plugin.settings.timezone = value.trim() || "Asia/Shanghai";
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("预提交天数")
			.setDesc(
					"每次打开 Obsidian 时，会把未来 N 天的推荐库存补齐到服务端（1-30 天）。即使你后续几天不打开 Obsidian，服务器也可按计划持续推送。"
			)
			.addButton((button) => {
				button.buttonEl.addClass("insight-flow-step-btn");
				return button.setButtonText("-").onClick(async () => {
					this.plugin.settings.queueWindowDays = Math.max(1, (this.plugin.settings.queueWindowDays || 7) - 1);
					await this.plugin.saveSettings();
					this.display();
				});
			})
			.addText((text) => {
				text.inputEl.addClass("insight-flow-step-input");
				return text.setValue(String(this.plugin.settings.queueWindowDays || 7)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.queueWindowDays = Number.isFinite(parsed)
						? Math.max(1, Math.min(30, parsed))
						: 7;
					await this.plugin.saveSettings();
				});
			})
			.addButton((button) => {
				button.buttonEl.addClass("insight-flow-step-btn");
				return button.setButtonText("+").onClick(async () => {
					this.plugin.settings.queueWindowDays = Math.min(30, (this.plugin.settings.queueWindowDays || 7) + 1);
					await this.plugin.saveSettings();
					this.display();
				});
			});
		new Setting(containerEl)
			.setName("每日推送条数")
			.setDesc("每天推送多少条，范围 1-20")
			.addButton((button) => {
				button.buttonEl.addClass("insight-flow-step-btn");
				return button.setButtonText("-").onClick(async () => {
					this.plugin.settings.dailyPushCount = Math.max(1, (this.plugin.settings.dailyPushCount || 1) - 1);
					await this.plugin.saveSettings();
					this.display();
				});
			})
			.addText((text) => {
				text.inputEl.addClass("insight-flow-step-input");
				return text.setValue(String(this.plugin.settings.dailyPushCount)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.dailyPushCount = Number.isFinite(parsed)
						? Math.max(1, Math.min(20, parsed))
						: 1;
					await this.plugin.saveSettings();
				});
			})
			.addButton((button) => {
				button.buttonEl.addClass("insight-flow-step-btn");
				return button.setButtonText("+").onClick(async () => {
					this.plugin.settings.dailyPushCount = Math.min(20, (this.plugin.settings.dailyPushCount || 1) + 1);
					await this.plugin.saveSettings();
					this.display();
				});
			});
		new Setting(containerEl)
			.setName("排除文件夹")
			.setDesc("用逗号分隔多个文件夹前缀，例如 Templates, Daily Notes")
			.addText((text) =>
				text.setValue(this.plugin.settings.excludedFolders.join(", ")).onChange(async (value) => {
					this.plugin.settings.excludedFolders = value
						.split(",")
						.map((item) => item.trim())
						.filter(Boolean);
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("保存到服务端")
			.setDesc("点击后将当前页面配置写入服务端")
			.addButton((button) =>
				button
					.setButtonText("保存设置")
					.setCta()
					.onClick(async () => {
						await this.plugin.saveRemoteSettings();
					})
			);

		new Setting(containerEl)
			.setName("操作")
			.setDesc("常用操作")
			.addButton((button) =>
				button.setButtonText("退出会话").onClick(async () => {
					await this.plugin.logout();
				})
			)
			.addButton((button) =>
				button.setButtonText("读取配置").onClick(async () => {
					await this.plugin.refreshRemoteSettings();
				})
			)
			.addButton((button) =>
				button.setButtonText("保存配置").onClick(async () => {
					await this.plugin.saveRemoteSettings();
				})
			)
			.addButton((button) =>
				button.setButtonText("导出配对码").onClick(async () => {
					await this.plugin.showPairCodeExportModal();
				})
			)
			.addButton((button) =>
				button.setButtonText("导入配对码").onClick(async () => {
					await this.plugin.showPairCodeImportModal();
				})
			)
			.addButton((button) =>
				button.setButtonText("立即同步").onClick(async () => {
					await this.plugin.syncNow();
				})
			);
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

class PushHistoryModal extends Modal {
	constructor(
		app: App,
		private readonly client: APIClient,
		private readonly items: PushHistoryItem[]
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("insight-flow-history-modal");
		contentEl.createEl("h3", { text: "推送历史（最近 20 条）" });

		if (this.items.length === 0) {
			contentEl.createEl("p", { text: "暂无推送历史。" });
			return;
		}

		for (const item of this.items) {
			const row = contentEl.createDiv({ cls: "insight-flow-history-item" });
			row.createDiv({ text: item.note_title || "(无标题)" });
			row.createDiv({ text: item.note_path, cls: "insight-flow-history-path" });
			row.createDiv({
				text: `推送时间：${formatDateTime(item.pushed_at)}`,
				cls: "insight-flow-history-time"
			});

			const buttonRow = row.createDiv({ cls: "insight-flow-history-actions" });
			const detailButton = buttonRow.createEl("button", { text: "查看详情" });
			detailButton.onclick = async () => {
				try {
					const detail = await this.client.getPushHistoryDetail(item.id);
					const body = detail.content?.trim() || detail.summary?.trim() || "(无内容)";
					new DetailModal(this.app, detail.note_title || "(无标题)", detail.note_path, body, detail.pushed_at).open();
				} catch (error) {
					new Notice(`读取详情失败：${formatError(error)}`);
				}
			};
		}
	}
}

class DetailModal extends Modal {
	constructor(
		app: App,
		private readonly titleText: string,
		private readonly pathText: string,
		private readonly bodyText: string,
		private readonly pushedAt: string
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("insight-flow-history-modal");
		contentEl.createEl("h3", { text: this.titleText });
		contentEl.createEl("p", { text: this.pathText, cls: "insight-flow-history-path" });
		contentEl.createEl("p", {
			text: `推送时间：${formatDateTime(this.pushedAt)}`,
			cls: "insight-flow-history-time"
		});
		contentEl.createEl("pre", { text: this.bodyText, cls: "insight-flow-history-body" });
	}
}

class PairCodeExportModal extends Modal {
	constructor(app: App, private readonly pairCode: string) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("insight-flow-history-modal");
		contentEl.createEl("h3", { text: "设备配对码" });
		const desc = contentEl.createEl("p", { text: "在另一台设备粘贴该配对码，即可共用同一用户身份。" });
		desc.addClass("insight-flow-history-path");

		const input = contentEl.createEl("textarea");
		input.value = this.pairCode;
		input.readOnly = true;
		input.style.width = "100%";
		input.style.minHeight = "100px";
		input.style.resize = "vertical";

		const row = contentEl.createDiv({ cls: "insight-flow-history-actions" });
		const copyButton = row.createEl("button", { text: "复制配对码" });
		copyButton.onclick = async () => {
			await navigator.clipboard.writeText(this.pairCode);
			new Notice("配对码已复制");
		};
	}
}

class PairCodeImportModal extends Modal {
	constructor(app: App, private readonly onSubmit: (code: string) => Promise<void>) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("insight-flow-history-modal");
		contentEl.createEl("h3", { text: "导入配对码" });

		const input = contentEl.createEl("textarea");
		input.placeholder = "粘贴配对码或 Token";
		input.style.width = "100%";
		input.style.minHeight = "100px";
		input.style.resize = "vertical";

		const row = contentEl.createDiv({ cls: "insight-flow-history-actions" });
		const submit = row.createEl("button", { text: "导入并同步配置" });
		submit.onclick = async () => {
			try {
				await this.onSubmit(input.value);
				new Notice("配对成功");
				this.close();
			} catch (error) {
				new Notice(`导入失败：${formatError(error)}`);
			}
		};
	}
}

function encodeBase64URL(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64URL(value: string): string {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padLength = (4 - (normalized.length % 4)) % 4;
	const padded = normalized + "=".repeat(padLength);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}

function formatDateTime(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}
	return parsed.toLocaleString();
}

function formatDateLabel(value: Date): string {
	return value.toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	});
}

export = ObsidianRecallPlugin;
