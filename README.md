# kintone Workflow MCP

> kintone公式MCPでは足りない機能を補完する拡張MCPサーバー。レコードCRUD、コメント、承認フロー、アプリ管理、ビュー、権限、ファイル操作、スペース、集計・分析、自然言語検索に対応。35ツール搭載。

## 公式MCPとの違い

[kintone公式MCP](https://github.com/kintone/mcp-server)は基本的なCRUDに対応していますが、業務で必要な多くの操作ができません:

| カテゴリ | 操作 | 公式MCP (6ツール) | 本サーバー (35ツール) |
|---------|------|:-:|:-:|
| 基本操作 | レコード取得・検索・作成 | o | o |
| 基本操作 | レコード更新・削除 | x | o |
| 一括操作 | 一括作成・一括更新 | x | o |
| コメント | コメント追加・取得 | x | o |
| プロセス管理 | ステータス更新・作業者変更・一括ステータス更新 | x | o |
| プロセス管理 | プロセス設定取得 | x | o |
| アプリ情報 | アプリ一覧・詳細・フィールド取得 | 一部 | o |
| アプリ管理 | アプリ作成・フィールド追加/変更/削除 | x | o |
| アプリ管理 | バルクリクエスト（トランザクション的実行） | x | o |
| ビュー | ビュー取得・作成 | x | o |
| 権限 | アクセス権限取得・更新 | x | o |
| ファイル | アップロード・ダウンロード | x | o |
| スペース | スペース情報取得・スレッドコメント | x | o |
| 集計・分析 | 集計・横断検索・変更履歴・CSVエクスポート | x | o |
| 自然言語 | 全アプリスキーマ取得・スマート検索・ワークフロー実行 | x | o |

## セットアップ

### 1. インストール

```bash
git clone https://github.com/AINAGOC/kintone-workflow-mcp.git
cd kintone-workflow-mcp
npm install
npm run build
```

### 2. 環境変数

```bash
# kintoneのURL
export KINTONE_BASE_URL=https://your-domain.cybozu.com

# 認証（どちらか一方）
export KINTONE_API_TOKEN=your-api-token
# または
export KINTONE_USERNAME=your-username
export KINTONE_PASSWORD=your-password
```

APIトークンはアプリ単位で発行されます。複数アプリを横断する場合はパスワード認証を使ってください。

### 3. Claude Desktopで使う

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "kintone-workflow": {
      "command": "node",
      "args": ["/path/to/kintone-workflow-mcp/dist/index.js"],
      "env": {
        "KINTONE_BASE_URL": "https://your-domain.cybozu.com",
        "KINTONE_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### 4. Claude Codeで使う

```bash
claude mcp add kintone-workflow -- node /path/to/kintone-workflow-mcp/dist/index.js
```

## 使用例

Claude DesktopやClaude Codeから自然言語で話しかけるだけで操作できます:

```
「kintoneに何があるか教えて」
→ describe_all_apps で全アプリのスキーマを自動取得

「先月の未完了案件を見せて」
→ smart_search で自然言語をkintoneクエリに自動変換して検索

「売上を部署別に集計して」
→ aggregate_records でグループ集計を実行

「未対応案件を検索して、担当者にリマインドコメントして、ステータスを対応中にして」
→ execute_workflow で検索→コメント→ステータス更新を一括実行

「営業管理アプリを作って。顧客名、金額、ステータスのフィールドで」
→ create_app でアプリ作成+フィールド定義+デプロイまで自動実行
```

## ツール一覧（35ツール）

### 基本操作（5）
- `get_record` — レコード1件取得
- `search_records` — クエリで検索（kintoneクエリ構文対応）
- `create_record` — レコード作成
- `update_record` — レコード更新（楽観ロック対応）
- `delete_records` — レコード削除（一括対応、最大100件）

### 一括操作（2）
- `bulk_create_records` — レコード一括作成（最大100件）
- `bulk_update_records` — レコード一括更新（最大100件）

### コメント（2）
- `add_comment` — レコードにコメント追加
- `get_comments` — コメント一覧取得（ソート・件数指定可）

### プロセス管理（4）
- `update_status` — ステータス更新（承認・差戻し等のアクション実行）
- `get_process_settings` — プロセス管理設定取得（ステータス一覧・遷移条件・作業者）
- `update_assignees` — 作業者変更（ステータスを変えずに担当者のみ変更）
- `bulk_update_statuses` — 複数レコードのステータスを一括更新

### アプリ情報（3）
- `get_apps` — アプリ一覧取得（名前で絞り込み可能）
- `get_app_detail` — アプリ1件の詳細情報（作成者、スペースID、説明等）
- `get_form_fields` — フォームフィールド定義取得（フィールドコード・型・設定）

### アプリ管理（4）
- `create_app` — アプリ新規作成（フィールド定義+自動デプロイ）
- `update_fields` — フィールド設定変更（ラベル・必須/任意・選択肢等）
- `delete_fields` — フィールド削除（自動デプロイ対応）
- `bulk_request` — 複数API操作をまとめて実行（1つでも失敗すると全ロールバック）

### ビュー管理（2）
- `get_views` — ビュー（一覧）定義取得
- `create_view` — ビュー作成（フィルタ条件・表示フィールド・ソート指定可）

### 権限管理（2）
- `get_app_permissions` — アクセス権限設定の確認
- `update_app_permissions` — アクセス権限の設定（ユーザー/グループ/組織単位）

### ファイル操作（2）
- `upload_file` — ローカルファイルをkintoneにアップロード（fileKeyを返す）
- `download_file` — kintoneからファイルをダウンロードして保存

### スペース（2）
- `get_space` — スペース情報取得（メンバー一覧含む）
- `add_thread_comment` — スレッドにコメント投稿

### 集計・分析（4）
- `aggregate_records` — レコード集計（グループ化+合計/平均/件数/最小/最大）
- `cross_app_lookup` — 2つのアプリを横断検索（結合キーで紐づけ）
- `get_record_history` — レコードの変更履歴表示（コメント+リビジョン）
- `export_csv` — レコードをCSV出力（ファイル保存 or テキスト返却）

### 自然言語（3）
- `describe_all_apps` — 全アプリのスキーマを一括取得（AIが最初に呼ぶべきツール）
- `smart_search` — 自然言語でkintone検索（「先月の未完了案件」等を自動クエリ変換）
- `execute_workflow` — 複数操作の連鎖実行（検索→コメント→ステータス更新等をドライラン可能）

## セキュリティ機能

- 30秒タイムアウト: 全API呼び出しに30秒のタイムアウトを設定。無応答のまま待ち続けることを防止
- 監査ログ: 全API呼び出しをstderrにJSON形式で出力（メソッド、エンドポイント、所要時間、成否を記録）
- パストラバーサル対策: ファイルアップロード/ダウンロード時にパスを検証し、`..` による意図しないディレクトリアクセスを防止
- クエリインジェクション対策: クエリ値のエスケープ処理により、検索条件の改ざんを防止

## 必要環境

- Node.js 18以上
- kintoneアカウント（[開発者ライセンス](https://cybozu.dev/ja/kintone/developer-license/)で無料取得可能）

## 制限事項

- 一括取得は最大500件/回（kintone API制限）。`getAllRecords`内部メソッドではオフセット自動ページングで全件取得
- 一括作成/更新は最大100件/回
- 一括削除は最大100件/回
- バルクリクエストは最大20件/回
- 日次リクエスト上限: Standard 10,000件/日/アプリ
- offset上限: 10,000件（10,000件超のデータはカーソルAPI対応を予定）
- smart_searchの自然言語変換は「先月」「今月」「今日」等の基本パターンのみ自動対応。複雑な条件はフィールド情報を返してAIに変換を委任
- ファイルダウンロード時のShift_JIS変換は非対応（UTF-8 BOM付きで保存）

## ライセンス

Apache-2.0
