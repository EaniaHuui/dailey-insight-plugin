export interface RecallSettings {
	serverUrl: string;
	clientId: string;
	token: string;
	pushTime: string;
	timezone: string;
	dailyPushCount: number;
	queueWindowDays: number;
	rssUrl: string;
	enableRSS: boolean;
	enableCubox: boolean;
	cuboxApiUrl: string;
	cuboxFolder: string;
	cuboxTags: string[];
	syncMode: "local";
	excludedFolders: string[];
	lastSyncAt: string;
	lastSyncCount: number;
	queueCoveredDays: number;
	queueLastDate: string;
	queueItemCount: number;
	queueDailyCount: number;
	pushedHistory: LocalPushHistoryItem[];
	queuedHistory: LocalPushHistoryItem[];
	lastAutoOpenDate: string;
	recallStates: Record<string, RecallItemState>;
	debugLog: string[];
	debugLastError: string;
}

export interface LocalPushHistoryItem {
	path: string;
	pushedAt: string;
}

export interface RecallItemState {
	read: boolean;
	snoozed: boolean;
	revisit: boolean;
	updatedAt: string;
}

const DEFAULT_SETTINGS: RecallSettings = {
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

export function normalizeSettings(settings: Partial<RecallSettings>): RecallSettings {
	return {
		...DEFAULT_SETTINGS,
		...settings,
		cuboxTags: settings.cuboxTags ?? DEFAULT_SETTINGS.cuboxTags,
		excludedFolders: settings.excludedFolders ?? DEFAULT_SETTINGS.excludedFolders,
		pushedHistory: settings.pushedHistory ?? DEFAULT_SETTINGS.pushedHistory,
		queuedHistory: settings.queuedHistory ?? DEFAULT_SETTINGS.queuedHistory,
		recallStates: settings.recallStates ?? DEFAULT_SETTINGS.recallStates,
		debugLog: settings.debugLog ?? DEFAULT_SETTINGS.debugLog,
		debugLastError: settings.debugLastError ?? DEFAULT_SETTINGS.debugLastError
	};
}
