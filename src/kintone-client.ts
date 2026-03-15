/**
 * kintone REST APIクライアント
 * APIトークン認証 / パスワード認証に対応
 */

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

  /** コメント追加 */
  async addComment(
    appId: number,
    recordId: number,
    text: string
  ): Promise<{ id: string }> {
    const res = await this.request("POST", "/k/v1/record/comment.json", {
      app: appId,
      record: recordId,
      comment: { text },
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
    const fs = await import("fs");
    const path = await import("path");
    const actualFileName = fileName ?? path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
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

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
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

    const response = await fetch(url, { method: "GET", headers });
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

  // --- 集計用ヘルパー ---

  /** 全レコード取得（500件制限を超えて自動ページング） */
  async getAllRecords(
    appId: number,
    query?: string,
    fields?: string[]
  ): Promise<KintoneRecord[]> {
    const allRecords: KintoneRecord[] = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const result = await this.getRecords(appId, query, fields, limit, offset);
      allRecords.push(...result.records);
      if (result.records.length < limit) break;
      offset += limit;
      if (offset >= 10000) break; // kintone offset上限
    }
    return allRecords;
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

  // --- 内部メソッド ---

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<KintoneResponse> {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...this.headers };
    // GETリクエストではContent-Typeを送らない（kintone APIが400を返す）
    if (method === "GET") {
      delete headers["Content-Type"];
    }
    const options: RequestInit = {
      method,
      headers,
    };
    if (body && (method === "POST" || method === "PUT" || method === "DELETE")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `kintone API error: ${response.status} ${response.statusText}\n${errorBody}`
      );
    }
    return (await response.json()) as KintoneResponse;
  }
}
