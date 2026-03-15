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
