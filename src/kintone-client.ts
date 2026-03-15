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

  // --- 内部メソッド ---

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<KintoneResponse> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: this.headers,
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
