import { requestUrl } from "obsidian";
import type { LocalNote } from "./sync";

export interface APIClientOptions {
	serverUrl: string;
	token?: string;
}

export interface LoginResponse {
	token: string;
	expires_at: string;
	user_id?: string;
}

export interface NoteHashItem {
	path: string;
	content_hash: string;
}

export interface SyncResponse {
	synced: number;
	skipped: number;
	batch_index: number;
}

export interface RemoteUserSettings {
	push_time: string;
	timezone: string;
	enable_rss: boolean;
	enable_cubox: boolean;
	cubox_api_url: string;
	cubox_folder: string;
	cubox_tags: string[];
	sync_mode: "local";
	daily_push_count: number;
	excluded_folders: string[];
	min_note_length: number;
	storage_used_bytes: number;
	storage_quota_bytes: number;
}

export interface UpdateUserSettingsRequest {
	push_time: string;
	timezone: string;
	enable_rss: boolean;
	enable_cubox: boolean;
	cubox_api_url: string;
	cubox_folder: string;
	cubox_tags: string[];
	sync_mode: "local";
	daily_push_count: number;
	excluded_folders: string[];
	min_note_length: number;
}

export interface PushHistoryItem {
	id: string;
	note_title: string;
	note_path: string;
	summary: string;
	pushed_at: string;
}

export interface PushHistoryResponse {
	total: number;
	items: PushHistoryItem[];
}

export interface PushHistoryDetailResponse {
	id: string;
	note_title: string;
	note_path: string;
	summary: string;
	content: string;
	pushed_at: string;
}

export interface QueueRecallItem {
	path: string;
	title: string;
	content: string;
	content_hash: string;
	note_updated_at: string;
	scheduled_date: string;
	slot_index: number;
}

export interface QueueRecallsResponse {
	queued: number;
	skipped: number;
}

export interface QueueStatusItem {
	scheduled_date: string;
	slot_index: number;
	path: string;
}

export interface QueueStatusResponse {
	daily_push_count: number;
	days: number;
	items: QueueStatusItem[];
}

export interface InstantPushRequest {
	path: string;
	title: string;
	content: string;
	content_hash: string;
	note_updated_at: string;
}

export interface InstantPushResponse {
	pushed: boolean;
	history_id?: string;
}

export interface UserRSSResponse {
	rss_url: string;
}

export class APIClient {
	constructor(private readonly options: APIClientOptions) {}

	async health(): Promise<boolean> {
		const response = await requestUrl({
			url: this.url("/healthz"),
			method: "GET"
		});
		return response.status === 200;
	}

	async login(email: string, password: string, deviceName: string): Promise<LoginResponse> {
		return this.request<LoginResponse>("POST", "/api/v1/auth/login", {
			email,
			password,
			device_name: deviceName
		});
	}

	async bootstrapAnonymous(clientID: string, deviceName: string): Promise<LoginResponse> {
		return this.request<LoginResponse>("POST", "/api/v1/auth/anonymous", {
			client_id: clientID,
			device_name: deviceName
		});
	}

	async logout(): Promise<void> {
		await this.request("POST", "/api/v1/auth/logout");
	}

	async getNoteHashes(): Promise<NoteHashItem[]> {
		return this.request<NoteHashItem[]>("GET", "/api/v1/notes/hashes");
	}

	async syncNotes(notes: LocalNote[], batchIndex: number, totalBatches: number): Promise<SyncResponse> {
		return this.request<SyncResponse>("POST", "/api/v1/notes/sync", {
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

	async markDeleted(paths: string[]): Promise<void> {
		if (paths.length === 0) {
			return;
		}
		await this.request("POST", "/api/v1/notes/deleted", { paths });
	}

	async getUserSettings(): Promise<RemoteUserSettings> {
		return this.request<RemoteUserSettings>("GET", "/api/v1/user/settings");
	}

	async updateUserSettings(payload: UpdateUserSettingsRequest): Promise<RemoteUserSettings> {
		return this.request<RemoteUserSettings>("PUT", "/api/v1/user/settings", payload);
	}

	async getPushHistory(page = 1, limit = 20): Promise<PushHistoryResponse> {
		const query = `?page=${page}&limit=${limit}`;
		return this.request<PushHistoryResponse>("GET", `/api/v1/push/history${query}`);
	}

	async getPushHistoryDetail(id: string): Promise<PushHistoryDetailResponse> {
		return this.request<PushHistoryDetailResponse>("GET", `/api/v1/push/history/${encodeURIComponent(id)}`);
	}

	async queueRecalls(items: QueueRecallItem[]): Promise<QueueRecallsResponse> {
		return this.request<QueueRecallsResponse>("POST", "/api/v1/recalls/queue", { items });
	}

	async getQueueStatus(days = 7): Promise<QueueStatusResponse> {
		return this.request<QueueStatusResponse>("GET", `/api/v1/recalls/queue/status?days=${days}`);
	}

	async pushInstant(payload: InstantPushRequest): Promise<InstantPushResponse> {
		return this.request<InstantPushResponse>("POST", "/api/v1/push/instant", payload);
	}

	async getUserRSS(): Promise<UserRSSResponse> {
		return this.request<UserRSSResponse>("GET", "/api/v1/user/rss");
	}

	async resetUserRSS(): Promise<UserRSSResponse> {
		return this.request<UserRSSResponse>("POST", "/api/v1/user/rss/reset", {});
	}

	private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await requestUrl({
			url: this.url(path),
			method,
			headers: this.headers(body !== undefined),
			body: body !== undefined ? JSON.stringify(body) : undefined
		});

		if (response.status >= 400) {
			let message = `Request failed with status ${response.status}`;
			try {
				const data = JSON.parse(response.text);
				if (typeof data?.message === "string" && data.message) {
					message = data.message;
				}
			} catch {
				// Ignore JSON parse errors and keep the default message.
			}
			throw new Error(message);
		}

		if (!response.text) {
			return undefined as T;
		}
		return JSON.parse(response.text) as T;
	}

	private headers(withJSON: boolean): Record<string, string> {
		const headers: Record<string, string> = {};
		if (withJSON) {
			headers["Content-Type"] = "application/json";
		}
		if (this.options.token) {
			headers.Authorization = `Bearer ${this.options.token}`;
		}
		return headers;
	}

	private url(path: string): string {
		const base = this.options.serverUrl.replace(/\/+$/, "");
		return `${base}${path}`;
	}
}
