/**
 * kintone Workflow MCP E2Eテスト
 * KintoneClientを直接importして全ツールをカバーするテスト
 *
 * 実行: node test/e2e.mjs
 */

import { KintoneClient } from "../dist/kintone-client.js";

// --- 設定 ---
const BASE_URL = process.env.KINTONE_BASE_URL || "https://pj43gdty3535.cybozu.com";
const USERNAME = process.env.KINTONE_USERNAME || "falcaofalcaofalcao86@gmail.com";
const PASSWORD = process.env.KINTONE_PASSWORD || "Dogosta0328";

const client = new KintoneClient({
  baseUrl: BASE_URL,
  auth: { type: "password", username: USERNAME, password: PASSWORD },
});

// --- テストユーティリティ ---
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    const result = await fn();
    passed++;
    const detail = result ? `: ${result}` : "";
    console.log(`  \u2713 ${name}${detail}`);
    return true;
  } catch (e) {
    failed++;
    const msg = e.message?.slice(0, 120) || String(e);
    console.log(`  \u2717 ${name}: ${msg}`);
    failures.push({ name, error: msg });
    return false;
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

// --- テスト用データ ---
const TIMESTAMP = Date.now();
const APP_NAME = `E2Eテスト_${TIMESTAMP}`;
let testAppId = null;
let createdRecordIds = [];

// ===========================================================
// メイン
// ===========================================================
async function main() {
  console.log(`=== kintone Workflow MCP E2Eテスト（35ツール） ===`);
  console.log(`環境: ${BASE_URL}`);
  console.log(`実行日時: ${new Date().toISOString()}\n`);

  // -------------------------------------------------------
  // 1. アプリ管理フロー
  // -------------------------------------------------------
  section("アプリ管理");

  // createApp
  await test("createApp", async () => {
    const result = await client.createApp(APP_NAME);
    testAppId = Number(result.app);
    return `ID=${testAppId}`;
  });

  if (!testAppId) {
    console.log("\n  アプリ作成に失敗したため、以降のテストをスキップします");
    printSummary();
    process.exit(1);
  }

  // addFields（3フィールド）
  await test("addFields: 3フィールド", async () => {
    const properties = {
      title: {
        type: "SINGLE_LINE_TEXT",
        code: "title",
        label: "タイトル",
        required: true,
      },
      department: {
        type: "DROP_DOWN",
        code: "department",
        label: "部署",
        options: {
          営業部: { label: "営業部", index: "0" },
          開発部: { label: "開発部", index: "1" },
          総務部: { label: "総務部", index: "2" },
        },
      },
      amount: {
        type: "NUMBER",
        code: "amount",
        label: "金額",
      },
    };
    const result = await client.addFields(testAppId, properties);
    return `revision=${result.revision}`;
  });

  // deployApp
  await test("deployApp", async () => {
    await client.deployApp(testAppId);
    // デプロイ完了を待機（最大30秒）
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const status = await client.getDeployStatus([testAppId]);
      if (status.apps[0]?.status === "SUCCESS") {
        return "デプロイ完了";
      }
      if (status.apps[0]?.status === "FAIL") {
        throw new Error("デプロイ失敗");
      }
    }
    throw new Error("デプロイタイムアウト");
  });

  // getApp
  await test("getApp", async () => {
    const app = await client.getApp(testAppId);
    return `name=${app.name}`;
  });

  // getFormFields
  await test("getFormFields", async () => {
    const result = await client.getFormFields(testAppId);
    const fieldCodes = Object.keys(result.properties);
    return `${fieldCodes.length}フィールド (${fieldCodes.filter(c => ["title", "department", "amount"].includes(c)).join(", ")})`;
  });

  // getApps
  await test("getApps", async () => {
    const result = await client.getApps(APP_NAME);
    return `${result.apps.length}件ヒット`;
  });

  // -------------------------------------------------------
  // 2. レコード操作フロー
  // -------------------------------------------------------
  section("レコード操作");

  // createRecords（5件一括）
  const departments = ["営業部", "開発部", "総務部", "営業部", "開発部"];
  const amounts = [100000, 200000, 150000, 300000, 250000];

  await test("createRecords: 5件一括", async () => {
    const records = departments.map((dept, i) => ({
      title: { value: `テスト案件${i + 1}_${TIMESTAMP}` },
      department: { value: dept },
      amount: { value: String(amounts[i]) },
    }));
    const result = await client.createRecords(testAppId, records);
    createdRecordIds = result.ids.map(Number);
    return `IDs=[${result.ids.join(", ")}]`;
  });

  // getRecord
  await test("getRecord", async () => {
    const record = await client.getRecord(testAppId, createdRecordIds[0]);
    return `title=${record.title?.value}`;
  });

  // getRecords（search_records）
  await test("getRecords (search)", async () => {
    const result = await client.getRecords(testAppId, `department in ("営業部")`, undefined, 100);
    return `${result.totalCount}件（営業部）`;
  });

  // updateRecord
  await test("updateRecord", async () => {
    const result = await client.updateRecord(testAppId, createdRecordIds[0], {
      title: { value: `更新済み案件_${TIMESTAMP}` },
      amount: { value: "999999" },
    });
    return `revision=${result.revision}`;
  });

  // updateRecords（一括更新）
  await test("updateRecords: 一括更新", async () => {
    const updates = createdRecordIds.slice(1, 3).map((id) => ({
      id,
      record: { amount: { value: "500000" } },
    }));
    const result = await client.updateRecords(testAppId, updates);
    return `${result.records.length}件更新`;
  });

  // createRecord（1件作成 → 後で削除用）
  let deleteTargetId = null;
  await test("createRecord: 1件作成（削除テスト用）", async () => {
    const result = await client.createRecord(testAppId, {
      title: { value: `削除用_${TIMESTAMP}` },
      department: { value: "総務部" },
      amount: { value: "1" },
    });
    deleteTargetId = Number(result.id);
    return `ID=${result.id}`;
  });

  // deleteRecords
  if (deleteTargetId) {
    await test("deleteRecords", async () => {
      await client.deleteRecords(testAppId, [deleteTargetId]);
      return `ID=${deleteTargetId}を削除`;
    });
  }

  // -------------------------------------------------------
  // 3. コメント操作
  // -------------------------------------------------------
  section("コメント操作");

  let commentId = null;
  await test("addComment", async () => {
    const result = await client.addComment(
      testAppId,
      createdRecordIds[0],
      `E2Eテストコメント ${new Date().toISOString()}`
    );
    commentId = result.id;
    return `comment_id=${result.id}`;
  });

  await test("getComments", async () => {
    const result = await client.getComments(testAppId, createdRecordIds[0], "desc", 10);
    return `${result.comments.length}件取得`;
  });

  // -------------------------------------------------------
  // 4. 集計・分析
  // -------------------------------------------------------
  section("集計・分析");

  // getAllRecords
  await test("getAllRecords（カーソルAPI）", async () => {
    const records = await client.getAllRecords(testAppId);
    return `${records.length}件取得`;
  });

  // aggregate（部署別集計）
  await test("aggregate: 部署別集計", async () => {
    const records = await client.getAllRecords(testAppId);
    // クライアント側で集計をシミュレート（aggregate_recordsツールのロジック）
    const groups = {};
    for (const record of records) {
      const dept = String(record.department?.value ?? "(空)");
      if (!groups[dept]) groups[dept] = { count: 0, sum: 0 };
      groups[dept].count++;
      const amt = Number(record.amount?.value);
      if (!isNaN(amt)) groups[dept].sum += amt;
    }
    const summary = Object.entries(groups)
      .map(([k, v]) => `${k}:${v.count}件/合計${v.sum.toLocaleString()}`)
      .join(", ");
    return summary;
  });

  // -------------------------------------------------------
  // 5. ビュー管理
  // -------------------------------------------------------
  section("ビュー管理");

  await test("getViews", async () => {
    const result = await client.getViews(testAppId);
    const viewNames = Object.keys(result.views);
    return `${viewNames.length}ビュー`;
  });

  await test("createView", async () => {
    // 既存ビューのindex確認
    const existing = await client.getViews(testAppId);
    let maxIndex = 0;
    for (const view of Object.values(existing.views)) {
      const idx = Number(view.index ?? 0);
      if (idx > maxIndex) maxIndex = idx;
    }
    const viewName = `営業部一覧_${TIMESTAMP}`;
    const views = {
      [viewName]: {
        type: "LIST",
        name: viewName,
        index: String(maxIndex + 1),
        fields: ["title", "department", "amount"],
        filterCond: 'department in ("営業部")',
        sort: "amount desc",
      },
    };
    const result = await client.updateViews(testAppId, views);
    // デプロイ
    await client.deployApp(testAppId);
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const status = await client.getDeployStatus([testAppId]);
      if (status.apps[0]?.status === "SUCCESS") break;
      if (status.apps[0]?.status === "FAIL") throw new Error("ビューデプロイ失敗");
    }
    return `revision=${result.revision}`;
  });

  // -------------------------------------------------------
  // 6. 権限
  // -------------------------------------------------------
  section("権限");

  await test("getAppAcl", async () => {
    const result = await client.getAppAcl(testAppId);
    return `${result.rights.length}件のACLエントリ`;
  });

  // -------------------------------------------------------
  // 7. プロセス管理
  // -------------------------------------------------------
  section("プロセス管理");

  await test("getProcessStatus", async () => {
    const result = await client.getProcessStatus(testAppId);
    const enabled = result.enable;
    return `enable=${enabled}`;
  });

  // -------------------------------------------------------
  // 8. CSVエクスポート
  // -------------------------------------------------------
  section("CSVエクスポート");

  await test("export_csv（テキスト出力モード）", async () => {
    // export_csvツールのロジックを再現
    const fieldsResult = await client.getFormFields(testAppId);
    const outputFields = ["title", "department", "amount"];
    const labels = outputFields.map((code) => {
      const prop = fieldsResult.properties[code];
      return prop?.label ?? code;
    });
    const records = await client.getAllRecords(testAppId, undefined, outputFields);
    const escapeCSV = (val) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };
    const lines = [];
    lines.push(labels.map((l) => escapeCSV(l)).join(","));
    for (const record of records) {
      const row = outputFields.map((code) => {
        const field = record[code];
        if (!field) return "";
        const value = field.value;
        if (value === null || value === undefined) return "";
        return escapeCSV(String(value));
      });
      lines.push(row.join(","));
    }
    const csv = lines.join("\n");
    const lineCount = lines.length - 1; // ヘッダー除く
    return `${lineCount}レコード, ${csv.length}文字`;
  });

  // -------------------------------------------------------
  // 9. セキュリティ
  // -------------------------------------------------------
  section("セキュリティ");

  // validateFilePath: 正常パス
  await test("validateFilePath: 正常パス（/tmp/test.csv）", async () => {
    const result = KintoneClient.validateFilePath("/tmp/test.csv");
    return `resolved=${result}`;
  });

  // validateFilePath: HOMEディレクトリ
  await test("validateFilePath: HOMEパス", async () => {
    const home = process.env.HOME || "/Users/test";
    const result = KintoneClient.validateFilePath(`${home}/test.csv`);
    return `resolved=${result}`;
  });

  // validateFilePath: 不正パス
  await test("validateFilePath: 不正パス（/etc/passwd）→ エラー期待", async () => {
    try {
      KintoneClient.validateFilePath("/etc/passwd");
      throw new Error("エラーが発生しなかった");
    } catch (e) {
      if (e.message.includes("セキュリティエラー")) {
        return "正しくブロック";
      }
      throw e;
    }
  });

  // validateFilePath: パストラバーサル
  await test("validateFilePath: パストラバーサル（/tmp/../etc/passwd）→ エラー期待", async () => {
    try {
      KintoneClient.validateFilePath("/tmp/../etc/passwd");
      throw new Error("エラーが発生しなかった");
    } catch (e) {
      if (e.message.includes("セキュリティエラー")) {
        return "正しくブロック";
      }
      throw e;
    }
  });

  // escapeQueryValue
  await test("escapeQueryValue", async () => {
    const tests = [
      { input: 'hello"world', expected: 'hello\\"world' },
      { input: "back\\slash", expected: "back\\\\slash" },
      { input: 'both\\"test', expected: 'both\\\\\\"test' },
      { input: "normal", expected: "normal" },
    ];
    for (const t of tests) {
      const result = KintoneClient.escapeQueryValue(t.input);
      if (result !== t.expected) {
        throw new Error(`"${t.input}" -> "${result}" (expected "${t.expected}")`);
      }
    }
    return `${tests.length}パターンOK`;
  });

  // -------------------------------------------------------
  // 10. 追加ツール
  // -------------------------------------------------------
  section("追加ツール");

  // describeAllApps
  await test("describeAllApps", async () => {
    const apps = await client.describeAllApps();
    return `${apps.length}アプリ取得`;
  });

  // getDeployStatus
  await test("getDeployStatus", async () => {
    const result = await client.getDeployStatus([testAppId]);
    return `status=${result.apps[0]?.status}`;
  });

  // getRecordHistory（コメント+レコード情報）
  await test("getRecordHistory（レコード+コメント）", async () => {
    const record = await client.getRecord(testAppId, createdRecordIds[0]);
    const comments = await client.getComments(testAppId, createdRecordIds[0], "asc", 10);
    const revision = record["$revision"]?.value;
    return `revision=${revision}, comments=${comments.comments.length}`;
  });

  // bulkRequest
  await test("bulkRequest", async () => {
    const result = await client.bulkRequest([
      {
        method: "GET",
        api: `record.json`,
        payload: { app: testAppId, id: createdRecordIds[0] },
      },
    ]);
    return `${result.results.length}件実行`;
  });

  // -------------------------------------------------------
  // サマリー
  // -------------------------------------------------------
  printSummary();
}

function printSummary() {
  const total = passed + failed;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`結果: ${passed}/${total} passed (${failed} failed)`);
  if (failures.length > 0) {
    console.log(`\n失敗したテスト:`);
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }
  if (testAppId) {
    console.log(`\nテスト用アプリ: ${BASE_URL}/k/${testAppId}/`);
  }
  console.log();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- 実行 ---
main().catch((e) => {
  console.error("致命的エラー:", e);
  process.exit(1);
});
