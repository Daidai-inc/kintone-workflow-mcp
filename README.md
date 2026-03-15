# kintone Workflow MCP

> kintone公式MCPでは足りない機能を補完する拡張MCPサーバー。レコード更新・削除、コメント操作、承認フロー（プロセス管理）に対応。

## 公式MCPとの違い

[kintone公式MCP](https://github.com/kintone/mcp-server)は基本的なCRUDに対応していますが、以下の操作ができません:

| 操作 | 公式MCP | 本サーバー |
|------|--------|-----------|
| レコード取得 | 対応 | 対応 |
| レコード検索 | 対応 | 対応 |
| レコード作成 | 対応 | 対応 |
| レコード更新 | 未対応 | 対応 |
| レコード削除 | 未対応 | 対応 |
| コメント追加 | 未対応 | 対応 |
| コメント取得 | 未対応 | 対応 |
| プロセス管理（承認フロー） | 未対応 | 対応 |
| アプリ一覧 | 対応 | 対応 |
| フォームフィールド取得 | 対応 | 対応 |

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

Claude DesktopやClaude Codeから自然言語で操作できます:

```
「アプリ5のレコード一覧を見せて」
→ search_records が呼ばれる

「レコード42のステータスを"承認する"に変更して」
→ update_status が呼ばれる

「レコード100に"対応完了しました"とコメントして」
→ add_comment が呼ばれる

「顧客名が"株式会社テスト"のレコードを検索して」
→ search_records(query: '顧客名 = "株式会社テスト"') が呼ばれる
```

## ツール一覧（10ツール）

### 基本操作
- `get_record` — レコード1件取得
- `search_records` — クエリで検索（kintoneクエリ構文対応）
- `create_record` — レコード作成
- `update_record` — レコード更新（楽観ロック対応）
- `delete_records` — レコード削除（一括対応、最大100件）

### コメント
- `add_comment` — レコードにコメント追加
- `get_comments` — コメント一覧取得

### プロセス管理
- `update_status` — ステータス更新（承認・差戻し等のアクション実行）

### アプリ情報
- `get_apps` — アプリ一覧取得（名前で絞り込み可能）
- `get_form_fields` — フォームフィールド定義取得

## 必要環境

- Node.js 18以上
- kintoneアカウント（[開発者ライセンス](https://cybozu.dev/ja/kintone/developer-license/)で無料取得可能）

## 制限事項

- 一括取得は最大500件/回（kintone API制限）
- 一括削除は最大100件/回
- 日次リクエスト上限: Standard 10,000件/日/アプリ
- offset上限: 10,000件（大量データはカーソルAPI対応を予定）

## ライセンス

Apache-2.0
