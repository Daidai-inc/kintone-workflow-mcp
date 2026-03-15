/**
 * kintone REST APIクライアント
 * APIトークン認証 / パスワード認証に対応
 */

import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

export interface KintoneConfig {
  baseUrl: string; // https://example.cybozu.com
  auth:
    | { type: "apiToken"; token: string }
    | { type: "password"; username: string; password: string };
}

export interface KintoneRecord {
  [fieldCode: string]: { value: unknown };
}

interface KintoneResponse {
  [key: string]: unknown;
}

export class KintoneClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  // レート制限
  private concurrentRequests = 0;
  private readonly maxConcurrent = 10;
  private lastRequestTime = 0;
  private readonly minInterval = 100; // ms
  private readonly maxRetries = 3;
  private waitQueue: (() => void)[] = [];

  constructor(config: KintoneConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
    };

    if (config.auth.type === "apiToken") {
      this.headers["X-Cybozu-API-Token"] = config.auth.token;
    } else {
      const credentials = Buffer.from(
        `${config.auth.username}:${config.auth.password}`
      ).toString("base64");
      this.headers["X-Cybozu-Authorization"] = credentials;
    }
  }

  // --- レコード操作 ---

  /** レコード1件取得 */
  async getRecord(appId: number, recordId: number): Promise<KintoneRecord> {
    const res = await this.request(
      "GET",
      `/k/v1/record.json?app=${appId}&id=${recordId}`
    );
    return res.record as KintoneRecord;
  }

  /** レコード検索（クエリ指定） */
  async getRecords(
    appId: number,
    query?: string,
    fields?: string[],
    limit = 100,
    offset = 0
  ): Promise<{ records: KintoneRecord[]; totalCount: string }> {
    const params = new URLSearchParams();
    params.set("app", String(appId));
    if (query) params.set("query", query);
    if (fields) params.set("fields", JSON.stringify(fields));
    params.set("totalCount", "true");
    // limitとoffsetはクエリ文字列に含める
    const fullQuery = query
      ? `${query} limit ${limit} offset ${offset}`
      : `limit ${limit} offset ${offset}`;
    params.set("query", fullQuery);

    const res = await this.request("GET", `/k/v1/records.json?${params}`);
    return res as { records: KintoneRecord[]; totalCount: string };
  }

  /** レコード1件作成 */
  async createRecord(
    appId: number,
    record: KintoneRecord
  ): Promise<{ id: string; revision: string }> {
    const res = await this.request("POST", "/k/v1/record.json", {
      app: appId,
      record,
    });
    return res as { id: string; revision: string };
  }

  /** レコード1件更新 */
  async updateRecord(
    appId: number,
    recordId: number,
    record: KintoneRecord,
    revision?: number
  ): Promise<{ revision: string }> {
    const body: Record<string, unknown> = {
      app: appId,
      id: recordId,
      record,
    };
    if (revision !== undefined) body.revision = revision;
    const res = await this.request("PUT", "/k/v1/record.json", body);
    return res as { revision: string };
  }

  /** レコード一括削除 */
  async deleteRecords(
    appId: number,
    ids: number[]
  ): Promise<Record<string, never>> {
    const res = await this.request("DELETE", "/k/v1/records.json", {
      app: appId,
      ids,
    });
    return res as Record<string, never>;
  }

  // --- コメント操作 ---

  /** コメント追加（メンション対応） */
  async addComment(
    appId: number,
    recordId: number,
    text: string,
    mentions?: { code: string; type: "USER" | "GROUP" | "ORGANIZATION" }[]
  ): Promise<{ id: string }> {
    const comment: Record<string, unknown> = { text };
    if (mentions && mentions.length > 0) {
      comment.mentions = mentions;
    }
    const res = await this.request("POST", "/k/v1/record/comment.json", {
      app: appId,
      record: recordId,
      comment,
    });
    return res as { id: string };
  }

  /** コメント取得 */
  async getComments(
    appId: number,
    recordId: number,
    order: "asc" | "desc" = "desc",
    limit = 10
  ): Promise<{ comments: unknown[]; older: boolean; newer: boolean }> {
    const params = `app=${appId}&record=${recordId}&order=${order}&limit=${limit}`;
    const res = await this.request(
      "GET",
      `/k/v1/record/comments.json?${params}`
    );
    return res as { comments: unknown[]; older: boolean; newer: boolean };
  }

  // --- プロセス管理 ---

  /** ステータス更新 */
  async updateStatus(
    appId: number,
    recordId: number,
    action: string,
    assignee?: string
  ): Promise<{ revision: string }> {
    const body: Record<string, unknown> = {
      app: appId,
      id: recordId,
      action,
    };
    if (assignee) body.assignee = assignee;
    const res = await this.request("PUT", "/k/v1/record/status.json", body);
    return res as { revision: string };
  }

  // --- アプリ情報 ---

  /** アプリ一覧取得 */
  async getApps(
    name?: string,
    limit = 100
  ): Promise<{ apps: unknown[] }> {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    params.set("limit", String(limit));
    const res = await this.request("GET", `/k/v1/apps.json?${params}`);
    return res as { apps: unknown[] };
  }

  /** フォームフィールド取得 */
  async getFormFields(
    appId: number
  ): Promise<{ properties: Record<string, unknown> }> {
    const res = await this.request(
      "GET",
      `/k/v1/app/form/fields.json?app=${appId}`
    );
    return res as { properties: Record<string, unknown> };
  }

  // --- 一括操作 ---

  /** レコード一括作成（最大100件） */
  async createRecords(
    appId: number,
    records: KintoneRecord[]
  ): Promise<{ ids: string[]; revisions: string[] }> {
    const res = await this.request("POST", "/k/v1/records.json", {
      app: appId,
      records,
    });
    return res as { ids: string[]; revisions: string[] };
  }

  /** レコード一括更新（最大100件） */
  async updateRecords(
    appId: number,
    records: { id: number; record: KintoneRecord; revision?: number }[]
  ): Promise<{ records: { id: string; revision: string }[] }> {
    const res = await this.request("PUT", "/k/v1/records.json", {
      app: appId,
      records: records.map((r) => ({
        id: r.id,
        record: r.record,
        ...(r.revision !== undefined ? { revision: r.revision } : {}),
      })),
    });
    return res as { records: { id: string; revision: string }[] };
  }

  // --- アプリ管理 ---

  /** アプリ作成（プレビュー環境に作成。deploy_appで本番反映） */
  async createApp(
    name: string,
    space?: number
  ): Promise<{ app: string; revision: string }> {
    const body: Record<string, unknown> = { name };
    if (space !== undefined) body.space = space;
    const res = await this.request("POST", "/k/v1/preview/app.json", body);
    return res as { app: string; revision: string };
  }

  /** フィールド追加（プレビュー環境。各プロパティにcodeを自動付与） */
  async addFields(
    appId: number,
    properties: Record<string, Record<string, unknown>>
  ): Promise<{ revision: string }> {
    // 各フィールドにcodeが含まれていなければキー名をcodeとして自動付与
    const props: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(properties)) {
      props[key] = { ...value, code: value.code ?? key };
    }
    const res = await this.request("POST", "/k/v1/preview/app/form/fields.json", {
      app: appId,
      properties: props,
    });
    return res as { revision: string };
  }

  /** アプリデプロイ（プレビュー→本番） */
  async deployApp(appId: number): Promise<void> {
    await this.request("POST", "/k/v1/preview/app/deploy.json", {
      apps: [{ app: appId }],
    });
  }

  /** デプロイ状態確認 */
  async getDeployStatus(appIds: number[]): Promise<{ apps: { app: string; status: string }[] }> {
    const params = appIds.map((id) => `apps=${id}`).join("&");
    const res = await this.request("GET", `/k/v1/preview/app/deploy.json?${params}`);
    return res as { apps: { app: string; status: string }[] };
  }

  // --- ファイル操作 ---

  /** ファイルアップロード（multipart/form-data） */
  async uploadFile(filePath: string, fileName?: string): Promise<{ fileKey: string }> {
    const fsModule = await import("fs");
    const pathModule = await import("path");
    const actualFileName = fileName ?? pathModule.basename(filePath);
    const fileData = fsModule.readFileSync(filePath);
    const blob = new Blob([fileData]);

    const formData = new FormData();
    formData.append("file", blob, actualFileName);

    const url = `${this.baseUrl}/k/v1/file.json`;
    const headers: Record<string, string> = {};
    // Content-Typeは設定しない（FormDataが自動設定）
    for (const [key, value] of Object.entries(this.headers)) {
      if (key.toLowerCase() !== "content-type") {
        headers[key] = value;
      }
    }

    const reqId = crypto.randomUUID();
    const startTime = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
    const elapsed = Date.now() - startTime;
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        request_id: reqId,
        level: response.ok ? "info" : "error",
        method: "POST",
        path: "/k/v1/file.json",
        status: response.status,
        elapsed_ms: elapsed,
        file_name: actualFileName,
      })
    );
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`kintone API error: ${response.status} ${response.statusText}\n${errorBody}`);
    }
    return (await response.json()) as { fileKey: string };
  }

  /** ファイルダウンロード */
  async downloadFile(fileKey: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`;
    const headers = { ...this.headers };
    delete headers["Content-Type"];

    const reqId = crypto.randomUUID();
    const startTime = Date.now();
    const response = await fetch(url, { method: "GET", headers });
    const elapsed = Date.now() - startTime;
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        request_id: reqId,
        level: response.ok ? "info" : "error",
        method: "GET",
        path: "/k/v1/file.json",
        status: response.status,
        elapsed_ms: elapsed,
      })
    );
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`kintone API error: ${response.status} ${response.statusText}\n${errorBody}`);
    }
    return await response.arrayBuffer();
  }

  // --- フィールド更新・削除 ---

  /** フィールド更新（プレビュー環境） */
  async updateFields(
    appId: number,
    properties: Record<string, Record<string, unknown>>
  ): Promise<{ revision: string }> {
    const res = await this.request("PUT", "/k/v1/preview/app/form/fields.json", {
      app: appId,
      properties,
    });
    return res as { revision: string };
  }

  /** フィールド削除（プレビュー環境） */
  async deleteFields(
    appId: number,
    fields: string[]
  ): Promise<{ revision: string }> {
    const res = await this.request("DELETE", "/k/v1/preview/app/form/fields.json", {
      app: appId,
      fields,
    });
    return res as { revision: string };
  }

  // --- ビュー管理 ---

  /** ビュー一覧取得 */
  async getViews(appId: number): Promise<{ views: Record<string, unknown> }> {
    const res = await this.request("GET", `/k/v1/app/views.json?app=${appId}`);
    return res as { views: Record<string, unknown> };
  }

  /** ビュー更新（プレビュー環境） */
  async updateViews(
    appId: number,
    views: Record<string, Record<string, unknown>>
  ): Promise<{ views: Record<string, unknown>; revision: string }> {
    const res = await this.request("PUT", "/k/v1/preview/app/views.json", {
      app: appId,
      views,
    });
    return res as { views: Record<string, unknown>; revision: string };
  }

  // --- アクセス権限 ---

  /** アプリのアクセス権限取得 */
  async getAppAcl(appId: number): Promise<{ rights: unknown[] }> {
    const res = await this.request("GET", `/k/v1/app/acl.json?app=${appId}`);
    return res as { rights: unknown[] };
  }

  /** アプリのアクセス権限更新 */
  async updateAppAcl(
    appId: number,
    rights: unknown[]
  ): Promise<{ revision: string }> {
    const res = await this.request("PUT", "/k/v1/app/acl.json", {
      app: appId,
      rights,
    });
    return res as { revision: string };
  }

  // --- レコードACL / フィールドACL ---

  /** レコードのアクセス権限取得 */
  async getRecordAcl(appId: number): Promise<{ rights: unknown[] }> {
    const res = await this.request("GET", `/k/v1/record/acl.json?app=${appId}`);
    return res as { rights: unknown[] };
  }

  /** レコードのアクセス権限更新（プレビュー環境） */
  async updateRecordAcl(appId: number, rights: unknown[]): Promise<{ revision: string }> {
    const res = await this.request("PUT", "/k/v1/preview/record/acl.json", {
      app: appId,
      rights,
    });
    return res as { revision: string };
  }

  /** フィールドのアクセス権限取得 */
  async getFieldAcl(appId: number): Promise<{ rights: unknown[] }> {
    const res = await this.request("GET", `/k/v1/field/acl.json?app=${appId}`);
    return res as { rights: unknown[] };
  }

  /** フィールドのアクセス権限更新（プレビュー環境） */
  async updateFieldAcl(appId: number, rights: unknown[]): Promise<{ revision: string }> {
    const res = await this.request("PUT", "/k/v1/preview/field/acl.json", {
      app: appId,
      rights,
    });
    return res as { revision: string };
  }

  // --- ユーザー/グループ/組織（Cybozu User API） ---

  /** ユーザー一覧取得 */
  async getUsers(offset = 0, limit = 100): Promise<{ users: unknown[] }> {
    const res = await this.request("GET", `/v1/users.json?offset=${offset}&size=${limit}`);
    return res as { users: unknown[] };
  }

  /** グループ一覧取得 */
  async getGroups(offset = 0, limit = 100): Promise<{ groups: unknown[] }> {
    const res = await this.request("GET", `/v1/groups.json?offset=${offset}&size=${limit}`);
    return res as { groups: unknown[] };
  }

  /** 組織一覧取得 */
  async getOrganizations(offset = 0, limit = 100): Promise<{ organizations: unknown[] }> {
    const res = await this.request("GET", `/v1/organizations.json?offset=${offset}&size=${limit}`);
    return res as { organizations: unknown[] };
  }

  // --- スペース管理 ---

  /** スペース情報取得 */
  async getSpace(spaceId: number): Promise<Record<string, unknown>> {
    const res = await this.request("GET", `/k/v1/space.json?id=${spaceId}`);
    return res;
  }

  /** スペースメンバー一覧 */
  async getSpaceMembers(spaceId: number): Promise<{ members: unknown[] }> {
    const res = await this.request("GET", `/k/v1/space/members.json?id=${spaceId}`);
    return res as { members: unknown[] };
  }

  /** スレッド追加 */
  async addSpaceThread(
    spaceId: number,
    name: string
  ): Promise<{ id: string }> {
    const res = await this.request("POST", "/k/v1/space/thread.json", {
      space: spaceId,
      name,
    });
    return res as { id: string };
  }

  /** スレッドにコメント追加 */
  async addThreadComment(
    spaceId: number,
    threadId: number,
    text: string
  ): Promise<{ id: string }> {
    const res = await this.request("POST", "/k/v1/space/thread/comment.json", {
      space: spaceId,
      thread: threadId,
      comment: { text },
    });
    return res as { id: string };
  }

  // --- アプリ詳細 ---

  /** アプリ1件の詳細情報取得 */
  async getApp(appId: number): Promise<Record<string, unknown>> {
    const res = await this.request("GET", `/k/v1/app.json?id=${appId}`);
    return res;
  }

  /** プロセス管理設定取得 */
  async getProcessStatus(appId: number): Promise<Record<string, unknown>> {
    const res = await this.request("GET", `/k/v1/app/status.json?app=${appId}`);
    return res;
  }

  /** プロセス管理設定更新（プレビュー環境） */
  async updateProcessStatus(appId: number, settings: Record<string, unknown>): Promise<{ revision: string }> {
    const res = await this.request("PUT", "/k/v1/preview/app/status.json", {
      app: appId,
      ...settings,
    });
    return res as { revision: string };
  }

  /** フォームレイアウト取得 */
  async getFormLayout(appId: number): Promise<{ layout: unknown[] }> {
    const res = await this.request("GET", `/k/v1/app/form/layout.json?app=${appId}`);
    return res as { layout: unknown[] };
  }

  /** フォームレイアウト更新（プレビュー環境） */
  async updateFormLayout(appId: number, layout: unknown[]): Promise<{ revision: string }> {
    const res = await this.request("PUT", "/k/v1/preview/app/form/layout.json", {
      app: appId,
      layout,
    });
    return res as { revision: string };
  }

  /** アプリコピー */
  async copyApp(originalAppId: number, name: string): Promise<{ app: string; revision: string }> {
    const res = await this.request("POST", "/k/v1/app.json", {
      name,
      originalAppId,
    });
    return res as { app: string; revision: string };
  }

  /** コメント削除 */
  async deleteComment(appId: number, recordId: number, commentId: number): Promise<Record<string, never>> {
    const res = await this.request("DELETE", "/k/v1/record/comment.json", {
      app: appId,
      record: recordId,
      comment: commentId,
    });
    return res as Record<string, never>;
  }

  /** 作業者変更 */
  async updateAssignees(
    appId: number,
    recordId: number,
    assignees: string[]
  ): Promise<{ revision: string }> {
    const res = await this.request("PUT", "/k/v1/record/assignees.json", {
      app: appId,
      id: recordId,
      assignees,
    });
    return res as { revision: string };
  }

  /** 複数レコードのステータス一括更新 */
  async bulkUpdateStatuses(
    appId: number,
    records: { id: number; action: string; assignee?: string }[]
  ): Promise<{ records: { id: string; revision: string }[] }> {
    const res = await this.request("PUT", "/k/v1/records/status.json", {
      app: appId,
      records: records.map((r) => ({
        id: r.id,
        action: r.action,
        ...(r.assignee ? { assignee: r.assignee } : {}),
      })),
    });
    return res as { records: { id: string; revision: string }[] };
  }

  /** 複数APIリクエストを一括実行（トランザクション的） */
  async bulkRequest(
    requests: { method: string; api: string; payload: unknown }[]
  ): Promise<{ results: unknown[] }> {
    const res = await this.request("POST", "/k/v1/bulkRequest.json", {
      requests: requests.map((r) => ({
        method: r.method,
        api: `/k/v1/${r.api}`,
        payload: r.payload,
      })),
    });
    return res as { results: unknown[] };
  }

  // --- カーソルAPI ---

  /** カーソル作成 */
  async createCursor(
    appId: number,
    query?: string,
    fields?: string[]
  ): Promise<{ id: string; totalCount: string }> {
    const body: Record<string, unknown> = { app: appId };
    if (query) body.query = query;
    if (fields) body.fields = fields;
    const res = await this.request("POST", "/k/v1/records/cursor.json", body);
    return res as { id: string; totalCount: string };
  }

  /** カーソルからレコード取得 */
  async getRecordsByCursor(
    cursorId: string
  ): Promise<{ records: KintoneRecord[]; next: boolean }> {
    const res = await this.request(
      "GET",
      `/k/v1/records/cursor.json?id=${encodeURIComponent(cursorId)}`
    );
    return res as { records: KintoneRecord[]; next: boolean };
  }

  /** カーソル削除 */
  async deleteCursor(cursorId: string): Promise<void> {
    await this.request("DELETE", "/k/v1/records/cursor.json", {
      id: cursorId,
    });
  }

  // --- 集計用ヘルパー ---

  /** 全レコード取得（カーソルAPIで10,000件超対応） */
  async getAllRecords(
    appId: number,
    query?: string,
    fields?: string[],
    maxRecords = 50000
  ): Promise<KintoneRecord[]> {
    let cursorId: string | undefined;
    try {
      const cursor = await this.createCursor(appId, query, fields);
      cursorId = cursor.id;
      const allRecords: KintoneRecord[] = [];

      while (true) {
        const result = await this.getRecordsByCursor(cursorId);
        allRecords.push(...result.records);
        if (allRecords.length > maxRecords) {
          // カーソルをクリーンアップしてからエラー
          try { await this.deleteCursor(cursorId); } catch { /* ignore */ }
          throw new Error(
            `取得件数が上限(${maxRecords}件)を超えました。queryで絞り込むか、export_csvを使用してください`
          );
        }
        if (!result.next) break;
      }
      // カーソルは全件取得後に自動削除されるが、念のため
      cursorId = undefined;
      return allRecords;
    } catch (e) {
      // エラー時はカーソルをクリーンアップ
      if (cursorId) {
        try {
          await this.deleteCursor(cursorId);
        } catch {
          // クリーンアップ失敗は無視
        }
      }
      throw e;
    }
  }

  // --- スキーマ取得 ---

  /** 全アプリのスキーマ（アプリ名+フィールド一覧）を取得 */
  async describeAllApps(): Promise<{ appId: string; name: string; fields: { code: string; type: string; label: string }[] }[]> {
    const appsResult = await this.getApps();
    const apps = appsResult.apps as { appId: string; name: string }[];
    const descriptions = [];

    for (const app of apps) {
      try {
        const fieldsResult = await this.getFormFields(Number(app.appId));
        const fields = Object.entries(fieldsResult.properties).map(([code, prop]) => ({
          code,
          type: (prop as Record<string, unknown>).type as string,
          label: (prop as Record<string, unknown>).label as string,
        }));
        descriptions.push({ appId: app.appId, name: app.name, fields });
      } catch {
        descriptions.push({ appId: app.appId, name: app.name, fields: [] });
      }
    }
    return descriptions;
  }

  // --- パス検証ヘルパー ---

  /** ファイルパスが許可ディレクトリ内かを検証する（シンボリックリンク対策付き） */
  static validateFilePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    const homeDir = os.homedir();
    const tmpDir = os.tmpdir();
    const allowedPrefixes = [tmpDir, "/tmp", homeDir];

    // ファイルが存在する場合はrealpathでシンボリックリンクを解決
    let checkPath = resolved;
    if (fs.existsSync(resolved)) {
      checkPath = fs.realpathSync(resolved);
    }

    const isAllowed = allowedPrefixes.some((prefix) =>
      checkPath.startsWith(prefix + path.sep) || checkPath === prefix
    );
    if (!isAllowed) {
      throw new Error(
        `セキュリティエラー: ファイルパス "${checkPath}" は許可されたディレクトリ（/tmp または HOME配下）の外です`
      );
    }
    return checkPath;
  }

  /** クエリ値のエスケープ（ダブルクォート） */
  static escapeQueryValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  // --- 内部メソッド ---

  /** 同時リクエスト数の上限待機 */
  private async waitForConcurrencySlot(): Promise<void> {
    if (this.concurrentRequests < this.maxConcurrent) return;
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /** 同時リクエスト枠を解放し、待機中のリクエストを再開 */
  private releaseConcurrencySlot(): void {
    this.concurrentRequests--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  /** リクエスト間の最小間隔を確保 */
  private async enforceMinInterval(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minInterval - elapsed)
      );
    }
    this.lastRequestTime = Date.now();
  }

  private async request(
    method: string,
    apiPath: string,
    body?: unknown
  ): Promise<KintoneResponse> {
    // 同時リクエスト数制限
    await this.waitForConcurrencySlot();
    // 最小間隔の確保
    await this.enforceMinInterval();
    this.concurrentRequests++;

    try {
      return await this.requestWithRetry(method, apiPath, body, 0);
    } finally {
      this.releaseConcurrencySlot();
    }
  }

  /** リトライ対象のステータスコード */
  private static readonly RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

  private async requestWithRetry(
    method: string,
    apiPath: string,
    body: unknown,
    retryCount: number,
    requestId?: string
  ): Promise<KintoneResponse> {
    const reqId = requestId ?? crypto.randomUUID();
    const url = `${this.baseUrl}${apiPath}`;
    const headers = { ...this.headers };
    // GETリクエストではContent-Typeを送らない（kintone APIが400を返す）
    if (method === "GET") {
      delete headers["Content-Type"];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const options: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body && (method === "POST" || method === "PUT" || method === "DELETE")) {
      options.body = JSON.stringify(body);
    }

    const startTime = Date.now();
    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      // 監査ログ出力（stderrへJSON）
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          request_id: reqId,
          level: response.ok ? "info" : "error",
          method,
          path: apiPath.split("?")[0],
          status: response.status,
          elapsed_ms: elapsed,
        })
      );

      // 429 / 502 / 503 / 504 → 指数バックオフでリトライ
      if (KintoneClient.RETRYABLE_STATUSES.has(response.status)) {
        if (retryCount >= this.maxRetries) {
          const errorBody = await response.text();
          throw new Error(
            `kintone APIエラー: ${this.maxRetries}回リトライ後も${response.status}。${method} ${apiPath.split("?")[0]}\n${errorBody}`
          );
        }
        // Retry-Afterヘッダーがあればその値を使用
        const retryAfter = response.headers.get("Retry-After");
        const backoffMs = retryAfter
          ? Number(retryAfter) * 1000
          : 1000 * Math.pow(2, retryCount);
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            request_id: reqId,
            level: "warn",
            event: "retryable_error",
            method,
            path: apiPath.split("?")[0],
            status: response.status,
            retry: retryCount + 1,
            backoff_ms: backoffMs,
          })
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.requestWithRetry(method, apiPath, body, retryCount + 1, reqId);
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `kintone API error: ${response.status} ${response.statusText}\n${errorBody}`
        );
      }
      return (await response.json()) as KintoneResponse;
    } catch (e) {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      // タイムアウト判定
      if (e instanceof DOMException && e.name === "AbortError") {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            request_id: reqId,
            level: "error",
            method,
            path: apiPath.split("?")[0],
            status: "timeout",
            elapsed_ms: elapsed,
          })
        );
        throw new Error(
          `kintone APIタイムアウト（30秒）: ${method} ${apiPath.split("?")[0]}`
        );
      }

      // その他のエラーでも監査ログを出力
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          request_id: reqId,
          level: "error",
          method,
          path: apiPath.split("?")[0],
          status: "error",
          elapsed_ms: elapsed,
        })
      );
      throw e;
    }
  }
}
