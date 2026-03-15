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
    app_id: z.number().describe("アプリID"),
    record_id: z.number().describe("レコードID"),
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
    app_id: z.number().describe("アプリID"),
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
    app_id: z.number().describe("アプリID"),
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
    app_id: z.number().describe("アプリID"),
    record_id: z.number().describe("レコードID"),
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
    app_id: z.number().describe("アプリID"),
    record_ids: z.array(z.number()).describe("削除するレコードIDの配列（最大100件）"),
  },
  async ({ app_id, record_ids }) => {
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
    app_id: z.number().describe("アプリID"),
    record_id: z.number().describe("レコードID"),
    text: z.string().describe("コメント本文"),
  },
  async ({ app_id, record_id, text }) => {
    const result = await client.addComment(app_id, record_id, text);
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
    app_id: z.number().describe("アプリID"),
    record_id: z.number().describe("レコードID"),
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
    app_id: z.number().describe("アプリID"),
    record_id: z.number().describe("レコードID"),
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
    app_id: z.number().describe("アプリID"),
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
    app_id: z.number().describe("アプリID"),
    records: z.array(z.record(z.string(), z.object({ value: z.unknown() }))).describe("レコードの配列"),
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
    app_id: z.number().describe("アプリID"),
    records: z.array(z.object({
      id: z.number().describe("レコードID"),
      record: z.record(z.string(), z.object({ value: z.unknown() })).describe("更新するフィールド"),
    })).describe("更新対象の配列"),
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
    app_id: z.number().describe("アプリID"),
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
      const conditions = chunk.map(v => `${target_key_field} = "${v}"`).join(" or ");
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

// --- サーバー起動 ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("kintone-workflow-mcp server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
