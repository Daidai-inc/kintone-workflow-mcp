#!/usr/bin/env node
/**
 * kintone Workflow MCP Server
 * 公式kintone MCPを拡張し、レコード更新/削除、コメント、プロセス管理、
 * 複数アプリ横断クエリに対応するMCPサーバー
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { KintoneClient, type KintoneRecord } from "./kintone-client.js";

// 環境変数からkintone接続設定を取得
function createClient(): KintoneClient {
  const baseUrl = process.env.KINTONE_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "KINTONE_BASE_URL が設定されていません（例: https://example.cybozu.com）"
    );
  }

  const apiToken = process.env.KINTONE_API_TOKEN;
  const username = process.env.KINTONE_USERNAME;
  const password = process.env.KINTONE_PASSWORD;

  if (apiToken) {
    return new KintoneClient({ baseUrl, auth: { type: "apiToken", token: apiToken } });
  } else if (username && password) {
    return new KintoneClient({ baseUrl, auth: { type: "password", username, password } });
  } else {
    throw new Error(
      "認証情報が設定されていません。KINTONE_API_TOKEN または KINTONE_USERNAME + KINTONE_PASSWORD を設定してください"
    );
  }
}

const client = createClient();

const server = new McpServer({
  name: "kintone-workflow-mcp",
  version: "0.1.0",
});

// --- レコード取得 ---
server.tool(
  "get_record",
  "kintoneのレコードを1件取得する",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_id: z.number().int().positive().describe("レコードID"),
  },
  async ({ app_id, record_id }) => {
    const record = await client.getRecord(app_id, record_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
  }
);

// --- レコード検索 ---
server.tool(
  "search_records",
  "kintoneのレコードをクエリで検索する。クエリ構文: https://cybozu.dev/ja/kintone/docs/overview/query/",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    query: z.string().optional().describe("検索クエリ（例: 'ステータス in (\"未着手\") order by 更新日時 desc'）"),
    fields: z.array(z.string()).optional().describe("取得するフィールドコードの配列"),
    limit: z.number().optional().default(100).describe("取得件数（最大500）"),
  },
  async ({ app_id, query, fields, limit }) => {
    const result = await client.getRecords(app_id, query, fields, limit);
    return {
      content: [{
        type: "text" as const,
        text: `${result.totalCount}件中${result.records.length}件取得\n\n${JSON.stringify(result.records, null, 2)}`,
      }],
    };
  }
);

// --- レコード作成 ---
server.tool(
  "create_record",
  "kintoneにレコードを1件作成する",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record: z.record(z.string(), z.object({ value: z.unknown() })).describe("フィールドコードと値のオブジェクト"),
  },
  async ({ app_id, record }) => {
    const result = await client.createRecord(app_id, record as KintoneRecord);
    return {
      content: [{ type: "text" as const, text: `レコード作成完了: ID=${result.id}, revision=${result.revision}` }],
    };
  }
);

// --- レコード更新（公式MCPにない機能） ---
server.tool(
  "update_record",
  "kintoneのレコードを1件更新する",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_id: z.number().int().positive().describe("レコードID"),
    record: z.record(z.string(), z.object({ value: z.unknown() })).describe("更新するフィールドコードと値のオブジェクト"),
    revision: z.number().optional().describe("楽観ロック用リビジョン番号（省略時はロックなし）"),
  },
  async ({ app_id, record_id, record, revision }) => {
    const result = await client.updateRecord(app_id, record_id, record as KintoneRecord, revision);
    return {
      content: [{ type: "text" as const, text: `レコード更新完了: ID=${record_id}, revision=${result.revision}` }],
    };
  }
);

// --- レコード削除（公式MCPにない機能） ---
server.tool(
  "delete_records",
  "kintoneのレコードを削除する（複数件対応）",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_ids: z.array(z.number().int().positive()).max(100).describe("削除するレコードIDの配列（最大100件）"),
    dry_run: z.boolean().optional().default(false).describe("trueにすると削除対象の確認のみ行い、実際の削除は行わない"),
  },
  async ({ app_id, record_ids, dry_run }) => {
    if (dry_run) {
      return {
        content: [{ type: "text" as const, text: `以下の${record_ids.length}件が削除されます: ID=${record_ids.join(",")}` }],
      };
    }
    await client.deleteRecords(app_id, record_ids);
    return {
      content: [{ type: "text" as const, text: `${record_ids.length}件のレコードを削除しました` }],
    };
  }
);

// --- コメント追加（公式MCPにない機能） ---
server.tool(
  "add_comment",
  "kintoneレコードにコメントを追加する",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_id: z.number().int().positive().describe("レコードID"),
    text: z.string().describe("コメント本文"),
    mentions: z.array(z.object({
      code: z.string().describe("メンション対象のコード（ログイン名等）"),
      type: z.enum(["USER", "GROUP", "ORGANIZATION"]).describe("メンション対象の種類"),
    })).optional().describe("メンション対象の配列"),
  },
  async ({ app_id, record_id, text, mentions }) => {
    const result = await client.addComment(app_id, record_id, text, mentions);
    return {
      content: [{ type: "text" as const, text: `コメント追加完了: comment_id=${result.id}` }],
    };
  }
);

// --- コメント取得（公式MCPにない機能） ---
server.tool(
  "get_comments",
  "kintoneレコードのコメント一覧を取得する",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_id: z.number().int().positive().describe("レコードID"),
    order: z.enum(["asc", "desc"]).optional().default("desc").describe("並び順"),
    limit: z.number().optional().default(10).describe("取得件数（最大10）"),
  },
  async ({ app_id, record_id, order, limit }) => {
    const result = await client.getComments(app_id, record_id, order, limit);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.comments, null, 2) }],
    };
  }
);

// --- プロセス管理：ステータス更新（公式MCPにない機能） ---
server.tool(
  "update_status",
  "kintoneレコードのプロセス管理ステータスを更新する（承認フロー等）",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_id: z.number().int().positive().describe("レコードID"),
    action: z.string().describe("実行するアクション名（例: '承認する', '差し戻す'）"),
    assignee: z.string().optional().describe("次の作業者のログイン名"),
  },
  async ({ app_id, record_id, action, assignee }) => {
    const result = await client.updateStatus(app_id, record_id, action, assignee);
    return {
      content: [{ type: "text" as const, text: `ステータス更新完了: action="${action}", revision=${result.revision}` }],
    };
  }
);

// --- アプリ一覧取得 ---
server.tool(
  "get_apps",
  "kintoneのアプリ一覧を取得する",
  {
    name: z.string().optional().describe("アプリ名で絞り込み（部分一致）"),
  },
  async ({ name }) => {
    const result = await client.getApps(name);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.apps, null, 2) }],
    };
  }
);

// --- フォームフィールド取得 ---
server.tool(
  "get_form_fields",
  "kintoneアプリのフォームフィールド定義を取得する（フィールドコード、型、設定）",
  {
    app_id: z.number().int().positive().describe("アプリID"),
  },
  async ({ app_id }) => {
    const result = await client.getFormFields(app_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.properties, null, 2) }],
    };
  }
);

// --- 一括レコード作成 ---
server.tool(
  "bulk_create_records",
  "kintoneにレコードを一括作成する（最大100件）",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    records: z.array(z.record(z.string(), z.object({ value: z.unknown() }))).max(100).describe("レコードの配列（最大100件）"),
  },
  async ({ app_id, records }) => {
    const result = await client.createRecords(app_id, records as KintoneRecord[]);
    return {
      content: [{ type: "text" as const, text: `${result.ids.length}件のレコードを一括作成しました。IDs: ${result.ids.join(", ")}` }],
    };
  }
);

// --- 一括レコード更新 ---
server.tool(
  "bulk_update_records",
  "kintoneのレコードを一括更新する（最大100件）",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    records: z.array(z.object({
      id: z.number().int().positive().describe("レコードID"),
      record: z.record(z.string(), z.object({ value: z.unknown() })).describe("更新するフィールド"),
    })).max(100).describe("更新対象の配列（最大100件）"),
  },
  async ({ app_id, records }) => {
    const result = await client.updateRecords(app_id, records.map(r => ({
      id: r.id,
      record: r.record as KintoneRecord,
    })));
    return {
      content: [{ type: "text" as const, text: `${result.records.length}件のレコードを一括更新しました` }],
    };
  }
);

// --- 集計・レポート ---
server.tool(
  "aggregate_records",
  "kintoneのレコードを集計する。指定フィールドでグループ化し、数値フィールドを合計・平均・件数で集計。「今月の売上を部署別に集計して」等に使う",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    query: z.string().optional().describe("絞り込みクエリ（例: '登録日 >= \"2026-03-01\"'）"),
    group_by: z.string().describe("グループ化するフィールドコード（例: '部署'）"),
    aggregate_field: z.string().optional().describe("集計する数値フィールドコード（例: '金額'）"),
    aggregate_type: z.enum(["sum", "avg", "count", "min", "max"]).optional().default("sum").describe("集計方法"),
  },
  async ({ app_id, query, group_by, aggregate_field, aggregate_type }) => {
    const records = await client.getAllRecords(app_id, query);

    const groups: Record<string, { count: number; values: number[] }> = {};

    for (const record of records) {
      const groupValue = String((record[group_by]?.value as string) ?? "(空)");
      if (!groups[groupValue]) groups[groupValue] = { count: 0, values: [] };
      groups[groupValue].count++;

      if (aggregate_field && record[aggregate_field]) {
        const num = Number(record[aggregate_field].value);
        if (!isNaN(num)) groups[groupValue].values.push(num);
      }
    }

    let result = `集計結果（全${records.length}件、グループ: ${group_by}）\n\n`;

    for (const [key, data] of Object.entries(groups).sort((a, b) => b[1].count - a[1].count)) {
      result += `${key}: ${data.count}件`;
      if (aggregate_field && data.values.length > 0) {
        const sum = data.values.reduce((a, b) => a + b, 0);
        const avg = sum / data.values.length;
        const min = Math.min(...data.values);
        const max = Math.max(...data.values);

        switch (aggregate_type) {
          case "sum": result += ` / 合計: ${sum.toLocaleString()}`; break;
          case "avg": result += ` / 平均: ${avg.toLocaleString(undefined, { maximumFractionDigits: 1 })}`; break;
          case "count": break;
          case "min": result += ` / 最小: ${min.toLocaleString()}`; break;
          case "max": result += ` / 最大: ${max.toLocaleString()}`; break;
        }
      }
      result += "\n";
    }

    return { content: [{ type: "text" as const, text: result }] };
  }
);

// --- 複数アプリ横断クエリ ---
server.tool(
  "cross_app_lookup",
  "2つのkintoneアプリを横断して検索する。アプリAのレコードに紐づくアプリBのレコードを取得する。「案件アプリの顧客に紐づく請求書を全部出して」等に使う",
  {
    source_app_id: z.number().describe("検索元アプリID（例: 案件管理）"),
    source_query: z.string().optional().describe("検索元の絞り込みクエリ"),
    source_key_field: z.string().describe("検索元の結合キーフィールドコード（例: '顧客名'）"),
    target_app_id: z.number().describe("検索先アプリID（例: 請求書）"),
    target_key_field: z.string().describe("検索先の結合キーフィールドコード（例: '顧客名'）"),
    target_fields: z.array(z.string()).optional().describe("検索先から取得するフィールド"),
  },
  async ({ source_app_id, source_query, source_key_field, target_app_id, target_key_field, target_fields }) => {
    // 検索元のレコードを取得
    const sourceRecords = await client.getAllRecords(source_app_id, source_query);

    // 結合キーの値を収集
    const keyValues = [...new Set(
      sourceRecords
        .map(r => String(r[source_key_field]?.value ?? ""))
        .filter(v => v !== "")
    )];

    if (keyValues.length === 0) {
      return { content: [{ type: "text" as const, text: "検索元に該当するレコードがありませんでした" }] };
    }

    // 検索先をキー値で検索（10件ずつクエリを分割してOR検索）
    const allTargetRecords: KintoneRecord[] = [];
    const chunkSize = 10;

    for (let i = 0; i < keyValues.length; i += chunkSize) {
      const chunk = keyValues.slice(i, i + chunkSize);
      const conditions = chunk.map(v => `${target_key_field} = "${KintoneClient.escapeQueryValue(v)}"`).join(" or ");
      const targetRecords = await client.getAllRecords(target_app_id, conditions, target_fields);
      allTargetRecords.push(...targetRecords);
    }

    let result = `横断検索結果\n`;
    result += `検索元（アプリ${source_app_id}）: ${sourceRecords.length}件\n`;
    result += `結合キー: ${source_key_field} ↔ ${target_key_field}\n`;
    result += `検索先（アプリ${target_app_id}）: ${allTargetRecords.length}件ヒット\n\n`;
    result += JSON.stringify(allTargetRecords, null, 2);

    return { content: [{ type: "text" as const, text: result }] };
  }
);

// --- アプリ作成 ---
server.tool(
  "create_app",
  "kintoneに新しいアプリを作成する。フィールドも同時に定義できる。「営業管理アプリを作って」等に使う",
  {
    name: z.string().describe("アプリ名（例: '営業管理'）"),
    fields: z.array(z.object({
      code: z.string().describe("フィールドコード（英数字推奨）"),
      label: z.string().describe("フィールドラベル"),
      type: z.enum([
        "SINGLE_LINE_TEXT", "MULTI_LINE_TEXT", "RICH_TEXT", "NUMBER",
        "DATE", "DATETIME", "DROP_DOWN", "RADIO_BUTTON", "CHECK_BOX",
        "LINK", "USER_SELECT"
      ]).describe("フィールドタイプ"),
      required: z.boolean().optional().default(false).describe("必須かどうか"),
      options: z.array(z.string()).optional().describe("選択肢（DROP_DOWN, RADIO_BUTTON, CHECK_BOX用）"),
    })).optional().describe("フィールド定義の配列"),
    deploy: z.boolean().optional().default(true).describe("作成後に即デプロイするか"),
  },
  async ({ name, fields, deploy }) => {
    // アプリ作成
    const app = await client.createApp(name);
    const appId = Number(app.app);
    let result = `アプリ「${name}」を作成しました（ID: ${appId}）\n`;

    // フィールド追加
    if (fields && fields.length > 0) {
      const properties: Record<string, unknown> = {};
      for (const field of fields) {
        const prop: Record<string, unknown> = {
          type: field.type,
          code: field.code,
          label: field.label,
          required: field.required,
        };
        if (field.options && ["DROP_DOWN", "RADIO_BUTTON", "CHECK_BOX"].includes(field.type)) {
          const opts: Record<string, { label: string; index: string }> = {};
          field.options.forEach((opt, i) => {
            opts[opt] = { label: opt, index: String(i) };
          });
          prop.options = opts;
        }
        properties[field.code] = prop;
      }
      await client.addFields(appId, properties as Record<string, Record<string, unknown>>);
      result += `フィールド${fields.length}個を追加しました\n`;
    }

    // デプロイ
    if (deploy) {
      await client.deployApp(appId);
      // デプロイ完了を待つ（最大30秒）
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await client.getDeployStatus([appId]);
        if (status.apps[0]?.status === "SUCCESS") {
          result += `デプロイ完了。アプリURL: ${client["baseUrl"]}/k/${appId}/\n`;
          break;
        }
        if (status.apps[0]?.status === "FAIL") {
          result += `デプロイ失敗。手動で確認してください。\n`;
          break;
        }
      }
    }

    return { content: [{ type: "text" as const, text: result }] };
  }
);

// --- 全アプリスキーマ取得（AIがkintoneの中身を理解する入口） ---
server.tool(
  "describe_all_apps",
  "kintone環境にある全アプリの名前とフィールド一覧を取得する。AIがkintoneの構造を理解するために最初に呼ぶべきツール。「kintoneに何があるか教えて」「使えるアプリを一覧して」等に使う",
  {},
  async () => {
    const apps = await client.describeAllApps();

    let result = `kintone環境のアプリ一覧（${apps.length}件）\n\n`;

    for (const app of apps) {
      result += `━━━ アプリ${app.appId}: ${app.name} ━━━\n`;
      if (app.fields.length === 0) {
        result += `  （フィールド情報なし）\n`;
      } else {
        // システムフィールドを除外して表示
        const userFields = app.fields.filter(f =>
          !["RECORD_NUMBER", "CREATED_TIME", "UPDATED_TIME", "CREATOR", "MODIFIER", "STATUS", "STATUS_ASSIGNEE", "CATEGORY"].includes(f.type)
        );
        const systemFields = app.fields.filter(f =>
          ["RECORD_NUMBER", "CREATED_TIME", "UPDATED_TIME", "CREATOR", "MODIFIER", "STATUS", "STATUS_ASSIGNEE", "CATEGORY"].includes(f.type)
        );

        if (userFields.length > 0) {
          result += `  ユーザーフィールド:\n`;
          for (const f of userFields) {
            result += `    - ${f.label}（${f.code}）: ${f.type}\n`;
          }
        }
        result += `  システムフィールド: ${systemFields.map(f => f.label || f.code).join(", ")}\n`;
      }
      result += `  URL: ${process.env.KINTONE_BASE_URL}/k/${app.appId}/\n\n`;
    }

    result += `\nヒント: 特定のアプリを操作するにはapp_idを指定してください。\n`;
    result += `例: 「アプリ${apps[0]?.appId || "1"}のレコードを検索して」\n`;

    return { content: [{ type: "text" as const, text: result }] };
  }
);

// --- スマート検索（自然言語→kintoneクエリ変換） ---
server.tool(
  "smart_search",
  "自然言語でkintoneを検索する。日付や条件を自動でkintoneクエリに変換する。「先月の未完了案件」「金額100万以上の案件」「田中さん担当の案件」等に使う",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    natural_query: z.string().describe("自然言語の検索条件（例: '先月の未完了案件', '金額100万以上'）"),
    sort_by: z.string().optional().describe("ソートするフィールドコード"),
    sort_order: z.enum(["asc", "desc"]).optional().default("desc").describe("ソート順"),
    limit: z.number().optional().default(100).describe("取得件数"),
  },
  async ({ app_id, natural_query, sort_by, sort_order, limit }) => {
    // まずアプリのフィールド情報を取得
    const fieldsResult = await client.getFormFields(app_id);
    const fields = Object.entries(fieldsResult.properties).map(([code, prop]) => ({
      code,
      type: (prop as Record<string, unknown>).type as string,
      label: (prop as Record<string, unknown>).label as string,
    }));

    // フィールド情報を元に自然言語をkintoneクエリに変換するヒントを生成
    const fieldInfo = fields
      .filter(f => !["RECORD_NUMBER", "CREATOR", "MODIFIER", "STATUS_ASSIGNEE", "CATEGORY"].includes(f.type))
      .map(f => `${f.label}(${f.code}): ${f.type}`)
      .join(", ");

    // 日付ヘルパー
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];

    // よくあるパターンの自動変換
    let query = natural_query;
    let autoConverted = false;

    // 「先月」→ 日付範囲
    if (/先月/.test(natural_query)) {
      const dateField = fields.find(f => ["DATE", "DATETIME", "CREATED_TIME", "UPDATED_TIME"].includes(f.type));
      if (dateField) {
        query = `${dateField.code} >= "${lastMonthStart}" and ${dateField.code} <= "${lastMonthEnd}"`;
        autoConverted = true;
      }
    }
    // 「今月」→ 日付範囲
    if (/今月/.test(natural_query)) {
      const dateField = fields.find(f => ["DATE", "DATETIME", "CREATED_TIME", "UPDATED_TIME"].includes(f.type));
      if (dateField) {
        query = `${dateField.code} >= "${thisMonth}-01"`;
        autoConverted = true;
      }
    }
    // 「今日」→ 日付
    if (/今日/.test(natural_query)) {
      const dateField = fields.find(f => ["DATE", "DATETIME", "CREATED_TIME", "UPDATED_TIME"].includes(f.type));
      if (dateField) {
        query = `${dateField.code} = "${today}"`;
        autoConverted = true;
      }
    }

    // ソート
    if (sort_by) {
      query += ` order by ${sort_by} ${sort_order}`;
    }

    // 自動変換できなかった場合、クエリヒントと一緒にフィールド情報を返す
    if (!autoConverted) {
      // そのままクエリとして渡してみる（ユーザーがkintoneクエリを書いた場合）
      try {
        const result = await client.getRecords(app_id, query, undefined, limit);
        return {
          content: [{
            type: "text" as const,
            text: `検索結果: ${result.totalCount}件中${result.records.length}件\n\n${JSON.stringify(result.records, null, 2)}`,
          }],
        };
      } catch {
        // クエリ変換失敗 → フィールド情報を返してAIに変換を任せる
        return {
          content: [{
            type: "text" as const,
            text: `自然言語「${natural_query}」をkintoneクエリに自動変換できませんでした。\n\nこのアプリのフィールド:\n${fieldInfo}\n\n日付参考: 今日=${today}, 今月開始=${thisMonth}-01, 先月=${lastMonthStart}〜${lastMonthEnd}\n\nkintoneクエリ構文で再度search_recordsを呼んでください。\n例: search_records(app_id=${app_id}, query='フィールドコード = "値"')`,
          }],
        };
      }
    }

    const result = await client.getRecords(app_id, query, undefined, limit);

    let response = `検索: 「${natural_query}」\n`;
    response += `変換クエリ: ${query}\n`;
    response += `結果: ${result.totalCount}件中${result.records.length}件\n\n`;
    response += JSON.stringify(result.records, null, 2);

    return { content: [{ type: "text" as const, text: response }] };
  }
);

// --- ワークフロー実行（複数操作の連鎖） ---
server.tool(
  "execute_workflow",
  "複数のkintone操作を連鎖して実行する。「未対応案件を検索→担当者にリマインドコメント→ステータス更新」等の複合操作を1回で実行。",
  {
    app_id: z.number().describe("対象アプリID"),
    search_query: z.string().describe("対象レコードを絞り込むクエリ"),
    actions: z.array(z.object({
      type: z.enum(["comment", "update_field", "update_status"]).describe("アクションの種類"),
      comment_text: z.string().optional().describe("コメント本文（type=comment時）"),
      field_code: z.string().optional().describe("更新するフィールドコード（type=update_field時）"),
      field_value: z.string().optional().describe("更新する値（type=update_field時）"),
      status_action: z.string().optional().describe("プロセス管理のアクション名（type=update_status時）"),
    })).describe("実行するアクションの配列（順番に実行）"),
    dry_run: z.boolean().optional().default(false).describe("trueにすると対象レコードの確認のみ行い、実際の操作は行わない"),
  },
  async ({ app_id, search_query, actions, dry_run }) => {
    // 対象レコードを取得
    const records = await client.getAllRecords(app_id, search_query);

    if (records.length === 0) {
      return { content: [{ type: "text" as const, text: `対象レコード: 0件（クエリ: ${search_query}）\n操作はスキップしました。` }] };
    }

    let result = `対象レコード: ${records.length}件（クエリ: ${search_query}）\n`;

    if (dry_run) {
      result += `\n【ドライラン】実際の操作は行いません。\n`;
      result += `対象レコードID: ${records.map(r => (r["$id"] as { value: string })?.value || "?").join(", ")}\n`;
      result += `予定アクション:\n`;
      for (const action of actions) {
        switch (action.type) {
          case "comment": result += `  - コメント追加: "${action.comment_text}"\n`; break;
          case "update_field": result += `  - フィールド更新: ${action.field_code} = "${action.field_value}"\n`; break;
          case "update_status": result += `  - ステータス変更: "${action.status_action}"\n`; break;
        }
      }
      return { content: [{ type: "text" as const, text: result }] };
    }

    // 各レコードに対してアクションを実行
    let successCount = 0;
    let errorCount = 0;

    for (const record of records) {
      const recordId = Number((record["$id"] as { value: string })?.value);
      if (!recordId) continue;

      for (const action of actions) {
        try {
          switch (action.type) {
            case "comment":
              if (action.comment_text) {
                await client.addComment(app_id, recordId, action.comment_text);
              }
              break;
            case "update_field":
              if (action.field_code && action.field_value !== undefined) {
                await client.updateRecord(app_id, recordId, {
                  [action.field_code]: { value: action.field_value },
                });
              }
              break;
            case "update_status":
              if (action.status_action) {
                await client.updateStatus(app_id, recordId, action.status_action);
              }
              break;
          }
          successCount++;
        } catch (e) {
          errorCount++;
          result += `  エラー（レコード${recordId}）: ${(e as Error).message?.slice(0, 60)}\n`;
        }
      }
    }

    result += `\n実行完了: ${successCount}操作成功`;
    if (errorCount > 0) result += ` / ${errorCount}操作失敗`;

    return { content: [{ type: "text" as const, text: result }] };
  }
);

// --- ファイルアップロード ---
server.tool(
  "upload_file",
  "ローカルファイルをkintoneにアップロードしてfileKeyを返す。返されたfileKeyをレコードの添付ファイルフィールドに設定して使う。例: upload_file('/tmp/report.pdf') → fileKeyを取得 → create_record で添付",
  {
    file_path: z.string().describe("アップロードするファイルのパス（例: '/tmp/report.pdf'）"),
    file_name: z.string().optional().describe("kintone上でのファイル名（省略時はファイル名をそのまま使用）"),
  },
  async ({ file_path, file_name }) => {
    const safePath = KintoneClient.validateFilePath(file_path);
    const result = await client.uploadFile(safePath, file_name);
    return {
      content: [{ type: "text" as const, text: `ファイルアップロード完了\nfileKey: ${result.fileKey}\n\nこのfileKeyをレコードの添付ファイルフィールドに設定してください。\n例: create_record(app_id, { "添付ファイル": { value: [{ fileKey: "${result.fileKey}" }] } })` }],
    };
  }
);

// --- ファイルダウンロード ---
server.tool(
  "download_file",
  "kintoneからファイルをダウンロードして保存する。レコードの添付ファイルフィールドからfileKeyを取得して使う。例: get_record → 添付ファイルフィールドのfileKeyを確認 → download_file",
  {
    file_key: z.string().describe("ダウンロードするファイルのfileKey"),
    save_path: z.string().describe("保存先のファイルパス（例: '/tmp/downloaded_file.pdf'）"),
  },
  async ({ file_key, save_path }) => {
    const safePath = KintoneClient.validateFilePath(save_path);
    const fs = await import("fs");
    const data = await client.downloadFile(file_key);
    fs.writeFileSync(safePath, Buffer.from(data));
    return {
      content: [{ type: "text" as const, text: `ファイルダウンロード完了: ${safePath}（${data.byteLength}バイト）` }],
    };
  }
);

// --- フィールド更新 ---
server.tool(
  "update_fields",
  "kintoneアプリのフィールド設定を変更する（ラベル、必須/任意、選択肢等）。プレビュー環境に反映後、自動デプロイする。例: フィールドのラベルを「氏名」→「お名前」に変更",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    properties: z.record(z.string(), z.record(z.string(), z.unknown())).describe("フィールドコードをキーとした更新内容（例: { 'name': { label: 'お名前', required: true } }）"),
    deploy: z.boolean().optional().default(true).describe("変更後に自動デプロイするか"),
  },
  async ({ app_id, properties, deploy }) => {
    const result = await client.updateFields(app_id, properties);
    let text = `フィールド更新完了（revision: ${result.revision}）\n更新フィールド: ${Object.keys(properties).join(", ")}`;

    if (deploy) {
      await client.deployApp(app_id);
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await client.getDeployStatus([app_id]);
        if (status.apps[0]?.status === "SUCCESS") {
          text += "\nデプロイ完了";
          break;
        }
        if (status.apps[0]?.status === "FAIL") {
          text += "\nデプロイ失敗。手動で確認してください。";
          break;
        }
      }
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// --- フィールド削除 ---
server.tool(
  "delete_fields",
  "kintoneアプリのフィールドを削除する。プレビュー環境に反映後、自動デプロイする。注意: 削除するとそのフィールドのデータも失われる",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    field_codes: z.array(z.string()).describe("削除するフィールドコードの配列（例: ['old_field1', 'old_field2']）"),
    deploy: z.boolean().optional().default(true).describe("変更後に自動デプロイするか"),
  },
  async ({ app_id, field_codes, deploy }) => {
    const result = await client.deleteFields(app_id, field_codes);
    let text = `フィールド削除完了（revision: ${result.revision}）\n削除フィールド: ${field_codes.join(", ")}`;

    if (deploy) {
      await client.deployApp(app_id);
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await client.getDeployStatus([app_id]);
        if (status.apps[0]?.status === "SUCCESS") {
          text += "\nデプロイ完了";
          break;
        }
        if (status.apps[0]?.status === "FAIL") {
          text += "\nデプロイ失敗。手動で確認してください。";
          break;
        }
      }
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// --- ビュー一覧取得 ---
server.tool(
  "get_views",
  "kintoneアプリのビュー（一覧）定義を取得する。フィルタ条件・表示フィールド・ソート順を確認できる",
  {
    app_id: z.number().int().positive().describe("アプリID"),
  },
  async ({ app_id }) => {
    const result = await client.getViews(app_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.views, null, 2) }],
    };
  }
);

// --- ビュー作成 ---
server.tool(
  "create_view",
  "kintoneアプリに新しいビュー（一覧）を作成する。フィルタ条件・表示フィールド・ソート順を指定可能。例: '未完了案件' ビューを作成",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    name: z.string().describe("ビュー名（例: '未完了案件一覧'）"),
    type: z.enum(["LIST", "CALENDAR", "CUSTOM"]).optional().default("LIST").describe("ビューの種類"),
    fields: z.array(z.string()).optional().describe("表示するフィールドコードの配列"),
    filter_cond: z.string().optional().describe("フィルタ条件（kintoneクエリ構文。例: 'ステータス in (\"未着手\", \"対応中\")'）"),
    sort: z.string().optional().describe("ソート条件（例: '更新日時 desc'）"),
    deploy: z.boolean().optional().default(true).describe("作成後に自動デプロイするか"),
  },
  async ({ app_id, name, type, fields, filter_cond, sort, deploy }) => {
    // 既存ビューを取得して最大indexを確認
    const existing = await client.getViews(app_id);
    const existingViews = existing.views as Record<string, Record<string, unknown>>;
    let maxIndex = 0;
    for (const view of Object.values(existingViews)) {
      const idx = Number(view.index ?? 0);
      if (idx > maxIndex) maxIndex = idx;
    }

    const viewDef: Record<string, unknown> = {
      type,
      name,
      index: String(maxIndex + 1),
    };
    if (fields) viewDef.fields = fields;
    if (filter_cond) viewDef.filterCond = filter_cond;
    if (sort) viewDef.sort = sort;

    const views: Record<string, Record<string, unknown>> = {
      [name]: viewDef as Record<string, unknown>,
    };

    const result = await client.updateViews(app_id, views);
    let text = `ビュー「${name}」を作成しました（revision: ${result.revision}）`;

    if (deploy) {
      await client.deployApp(app_id);
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await client.getDeployStatus([app_id]);
        if (status.apps[0]?.status === "SUCCESS") {
          text += "\nデプロイ完了";
          break;
        }
        if (status.apps[0]?.status === "FAIL") {
          text += "\nデプロイ失敗。手動で確認してください。";
          break;
        }
      }
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// --- アクセス権限取得 ---
server.tool(
  "get_app_permissions",
  "kintoneアプリのアクセス権限設定を確認する。誰がどの操作（閲覧・追加・編集・削除）を行えるかを表示",
  {
    app_id: z.number().int().positive().describe("アプリID"),
  },
  async ({ app_id }) => {
    const result = await client.getAppAcl(app_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.rights, null, 2) }],
    };
  }
);

// --- アクセス権限更新 ---
server.tool(
  "update_app_permissions",
  "kintoneアプリのアクセス権限を設定する。ユーザー/グループ/組織単位で閲覧・追加・編集・削除権限を制御。例: 特定グループに閲覧のみ許可",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    rights: z.array(z.object({
      entity: z.object({
        type: z.enum(["USER", "GROUP", "ORGANIZATION"]).describe("エンティティの種類"),
        code: z.string().describe("ユーザー/グループ/組織のコード"),
      }).describe("権限を設定する対象"),
      appEditable: z.boolean().optional().describe("アプリ管理権限"),
      recordViewable: z.boolean().optional().describe("レコード閲覧権限"),
      recordAddable: z.boolean().optional().describe("レコード追加権限"),
      recordEditable: z.boolean().optional().describe("レコード編集権限"),
      recordDeletable: z.boolean().optional().describe("レコード削除権限"),
    })).describe("権限設定の配列"),
  },
  async ({ app_id, rights }) => {
    const result = await client.updateAppAcl(app_id, rights);
    return {
      content: [{ type: "text" as const, text: `アクセス権限を更新しました（revision: ${result.revision}）` }],
    };
  }
);

// --- スペース情報取得 ---
server.tool(
  "get_space",
  "kintoneスペースの情報を取得する。スペース名、メンバー、スレッド一覧等を確認できる",
  {
    space_id: z.number().describe("スペースID"),
  },
  async ({ space_id }) => {
    const space = await client.getSpace(space_id);
    let text = `スペース情報\n`;
    text += JSON.stringify(space, null, 2);

    // メンバー一覧も取得
    try {
      const members = await client.getSpaceMembers(space_id);
      text += `\n\nメンバー（${members.members.length}名）:\n`;
      text += JSON.stringify(members.members, null, 2);
    } catch {
      text += `\n\nメンバー情報の取得に失敗しました`;
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// --- スレッドコメント追加 ---
server.tool(
  "add_thread_comment",
  "kintoneスペースのスレッドにコメントを投稿する。チームへの通知や情報共有に使う",
  {
    space_id: z.number().describe("スペースID"),
    thread_id: z.number().describe("スレッドID"),
    text: z.string().describe("コメント本文"),
  },
  async ({ space_id, thread_id, text }) => {
    const result = await client.addThreadComment(space_id, thread_id, text);
    return {
      content: [{ type: "text" as const, text: `スレッドコメント投稿完了（comment_id: ${result.id}）` }],
    };
  }
);

// --- レコード変更履歴（コメント+リビジョンから疑似取得） ---
server.tool(
  "get_record_history",
  "kintoneレコードの変更履歴を表示する。コメント履歴とリビジョン情報を組み合わせて時系列で表示。「このレコードの経緯を教えて」等に使う",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_id: z.number().int().positive().describe("レコードID"),
  },
  async ({ app_id, record_id }) => {
    // レコード本体（リビジョン、作成者、更新者、作成日時、更新日時）
    const record = await client.getRecord(app_id, record_id);

    // コメント取得（新しい順、最大10件）
    const comments = await client.getComments(app_id, record_id, "asc", 10);

    let text = `レコード ${record_id} の変更履歴\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    // レコード基本情報
    const creator = record["作成者"] ?? record["CREATOR"] ?? record["$creator"];
    const createdTime = record["作成日時"] ?? record["CREATED_TIME"] ?? record["$created_time"];
    const modifier = record["更新者"] ?? record["MODIFIER"] ?? record["$modifier"];
    const updatedTime = record["更新日時"] ?? record["UPDATED_TIME"] ?? record["$updated_time"];
    const revision = record["$revision"];

    if (createdTime) {
      text += `作成: ${(createdTime as { value: unknown }).value}`;
      if (creator) text += ` by ${JSON.stringify((creator as { value: unknown }).value)}`;
      text += `\n`;
    }
    if (updatedTime) {
      text += `最終更新: ${(updatedTime as { value: unknown }).value}`;
      if (modifier) text += ` by ${JSON.stringify((modifier as { value: unknown }).value)}`;
      text += `\n`;
    }
    if (revision) {
      text += `リビジョン: ${(revision as { value: unknown }).value}（${Number((revision as { value: string }).value) - 1}回変更）\n`;
    }

    // コメント履歴
    if ((comments.comments as unknown[]).length > 0) {
      text += `\nコメント履歴:\n`;
      for (const comment of comments.comments as { id: string; text: string; createdAt: string; creator: { name: string } }[]) {
        text += `  [${comment.createdAt}] ${comment.creator?.name ?? "?"}: ${comment.text}\n`;
      }
    } else {
      text += `\nコメント: なし\n`;
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// --- CSVエクスポート ---
server.tool(
  "export_csv",
  "kintoneのレコードをCSV形式で出力する。検索結果をファイルに保存するか、テキストとして返す。「このアプリのデータをCSVでエクスポートして」等に使う",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    query: z.string().optional().describe("絞り込みクエリ"),
    fields: z.array(z.string()).optional().describe("出力するフィールドコードの配列（省略時は全フィールド）"),
    save_path: z.string().optional().describe("保存先ファイルパス（省略時はテキストとして返す）"),
    encoding: z.enum(["utf8", "sjis"]).optional().default("utf8").describe("文字エンコーディング"),
  },
  async ({ app_id, query, fields, save_path, encoding }) => {
    // フィールド情報を取得
    const fieldsResult = await client.getFormFields(app_id);
    const allFieldCodes = Object.keys(fieldsResult.properties);
    const outputFields = fields ?? allFieldCodes;

    // ラベル行を作成
    const labels = outputFields.map(code => {
      const prop = fieldsResult.properties[code] as Record<string, unknown> | undefined;
      return (prop?.label as string) ?? code;
    });

    // レコード取得
    const records = await client.getAllRecords(app_id, query, outputFields);

    // CSV生成
    const escapeCSV = (val: string): string => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const lines: string[] = [];
    lines.push(labels.map(l => escapeCSV(l)).join(","));

    for (const record of records) {
      const row = outputFields.map(code => {
        const field = record[code];
        if (!field) return "";
        const value = field.value;
        if (value === null || value === undefined) return "";
        if (Array.isArray(value)) {
          // 配列型（チェックボックス、ユーザー選択等）
          return escapeCSV(value.map(v => typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)).join(";"));
        }
        if (typeof value === "object") {
          return escapeCSV(JSON.stringify(value));
        }
        return escapeCSV(String(value));
      });
      lines.push(row.join(","));
    }

    const csvContent = lines.join("\n");

    if (save_path) {
      const validatedSavePath = KintoneClient.validateFilePath(save_path);
      const fs = await import("fs");
      if (encoding === "sjis") {
        // Shift_JISは非対応（Node.jsネイティブでは難しい）のでUTF-8 BOM付きで保存
        const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
        const content = Buffer.from(csvContent, "utf-8");
        fs.writeFileSync(validatedSavePath, Buffer.concat([bom, content]));
      } else {
        const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
        const content = Buffer.from(csvContent, "utf-8");
        fs.writeFileSync(validatedSavePath, Buffer.concat([bom, content]));
      }
      return {
        content: [{ type: "text" as const, text: `CSV出力完了: ${validatedSavePath}\n${records.length}件のレコードをエクスポートしました` }],
      };
    }

    return {
      content: [{ type: "text" as const, text: `CSV出力（${records.length}件）:\n\n${csvContent}` }],
    };
  }
);

// --- アプリ詳細取得 ---
server.tool(
  "get_app_detail",
  "kintoneアプリ1件の詳細情報を取得する。アプリ名、作成者、スペースID、説明等を確認できる。例: 「このアプリの管理者は誰？」「アプリの説明を見せて」",
  {
    app_id: z.number().int().positive().describe("アプリID"),
  },
  async ({ app_id }) => {
    const app = await client.getApp(app_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(app, null, 2) }],
    };
  }
);

// --- プロセス管理設定取得 ---
server.tool(
  "get_process_settings",
  "kintoneアプリのプロセス管理（ワークフロー）設定を取得する。ステータス一覧、遷移条件、各ステータスの作業者を確認できる。例: 「この案件の承認フローはどうなってる？」「どんなステータスがある？」",
  {
    app_id: z.number().int().positive().describe("アプリID"),
  },
  async ({ app_id }) => {
    const status = await client.getProcessStatus(app_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
    };
  }
);

// --- 作業者変更 ---
server.tool(
  "update_assignees",
  "kintoneレコードのプロセス管理の作業者を変更する。ステータスは変えずに担当者だけ変更したい場合に使う。例: 「この案件の担当を田中さんに変えて」「作業者を佐藤さんと鈴木さんにして」",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    record_id: z.number().int().positive().describe("レコードID"),
    assignees: z.array(z.string()).describe("新しい作業者のログイン名の配列（例: ['tanaka', 'suzuki']）"),
  },
  async ({ app_id, record_id, assignees }) => {
    const result = await client.updateAssignees(app_id, record_id, assignees);
    return {
      content: [{ type: "text" as const, text: `作業者変更完了: レコード${record_id}の作業者を[${assignees.join(", ")}]に変更しました（revision: ${result.revision}）` }],
    };
  }
);

// --- ステータス一括更新 ---
server.tool(
  "bulk_update_statuses",
  "複数レコードのプロセス管理ステータスを一括更新する。例: 「未処理の案件を全部承認して」「選択した5件をまとめて差し戻して」",
  {
    app_id: z.number().int().positive().describe("アプリID"),
    records: z.array(z.object({
      id: z.number().int().positive().describe("レコードID"),
      action: z.string().describe("実行するアクション名（例: '承認する'）"),
      assignee: z.string().optional().describe("次の作業者のログイン名"),
    })).max(100).describe("ステータス更新対象の配列（最大100件）"),
  },
  async ({ app_id, records }) => {
    const result = await client.bulkUpdateStatuses(app_id, records);
    return {
      content: [{ type: "text" as const, text: `ステータス一括更新完了: ${result.records.length}件のレコードを更新しました` }],
    };
  }
);

// --- バルクリクエスト ---
server.tool(
  "bulk_request",
  "複数のkintone API操作をまとめて実行する（トランザクション的）。1つでも失敗すると全てロールバックされる。例: 「レコード作成してからステータスを変更する」をアトミックに実行",
  {
    requests: z.array(z.object({
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTPメソッド"),
      api: z.string().describe("APIエンドポイント（k/v1/以降。例: 'record.json'）"),
      payload: z.unknown().describe("リクエストボディ"),
    })).describe("実行するAPIリクエストの配列（最大20件）"),
  },
  async ({ requests }) => {
    const result = await client.bulkRequest(requests);
    return {
      content: [{ type: "text" as const, text: `バルクリクエスト完了: ${result.results.length}件の操作を実行しました\n\n${JSON.stringify(result.results, null, 2)}` }],
    };
  }
);

// --- ユーザー一覧取得 ---
server.tool(
  "get_users",
  "kintone環境のユーザー一覧を取得する",
  {
    offset: z.number().int().optional().default(0).describe("取得開始位置"),
    limit: z.number().int().optional().default(100).describe("取得件数"),
  },
  async ({ offset, limit }) => {
    const result = await client.getUsers(offset, limit);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.users, null, 2) }],
    };
  }
);

// --- グループ一覧取得 ---
server.tool(
  "get_groups",
  "kintone環境のグループ一覧を取得する",
  {
    offset: z.number().int().optional().default(0).describe("取得開始位置"),
    limit: z.number().int().optional().default(100).describe("取得件数"),
  },
  async ({ offset, limit }) => {
    const result = await client.getGroups(offset, limit);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.groups, null, 2) }],
    };
  }
);

// --- 組織一覧取得 ---
server.tool(
  "get_organizations",
  "kintone環境の組織一覧を取得する",
  {
    offset: z.number().int().optional().default(0).describe("取得開始位置"),
    limit: z.number().int().optional().default(100).describe("取得件数"),
  },
  async ({ offset, limit }) => {
    const result = await client.getOrganizations(offset, limit);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.organizations, null, 2) }],
    };
  }
);

// --- レコードACL取得 ---
server.tool(
  "get_record_permissions",
  "kintoneアプリのレコード単位のアクセス権限設定を取得する",
  {
    app_id: z.number().int().positive().describe("アプリID"),
  },
  async ({ app_id }) => {
    const result = await client.getRecordAcl(app_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.rights, null, 2) }],
    };
  }
);

// --- フィールドACL取得 ---
server.tool(
  "get_field_permissions",
  "kintoneアプリのフィールド単位のアクセス権限設定を取得する",
  {
    app_id: z.number().int().positive().describe("アプリID"),
  },
  async ({ app_id }) => {
    const result = await client.getFieldAcl(app_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.rights, null, 2) }],
    };
  }
);

// --- スレッド作成 ---
server.tool(
  "create_thread",
  "kintoneスペースに新しいスレッドを作成する",
  {
    space_id: z.number().int().positive().describe("スペースID"),
    name: z.string().describe("スレッド名"),
  },
  async ({ space_id, name }) => {
    const result = await client.addSpaceThread(space_id, name);
    return {
      content: [{ type: "text" as const, text: `スレッド作成完了: thread_id=${result.id}` }],
    };
  }
);

// --- サーバー起動 ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("kintone-workflow-mcp server started");

  // Graceful shutdown
  const shutdown = () => {
    console.error("kintone-workflow-mcp server shutting down...");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
