# impression-collector

特定の人物についての印象を匿名で収集する Web フォームです。

## 必要なもの

- Node.js v18 以降
- npm

## セットアップ

### 1. 依存パッケージをインストール

```bash
npm install
```

### 2. 環境変数を設定

`.env.example` をコピーして `.env` を作成し、パスワードを設定します。

```bash
cp .env.example .env
```

`.env` をテキストエディタで開き、以下の値を変更してください。

```
ADMIN_PASSWORD=（管理画面のパスワードを設定）
SESSION_SECRET=（ランダムな長い文字列を設定）
PORT=3000
```

### 3. サーバーを起動

```bash
npm start
```

開発中はファイル変更を自動検知する `nodemon` を使えます。

```bash
npm run dev
```

### 4. ブラウザでアクセス

| URL | 内容 |
|-----|------|
| `http://localhost:3000/` | 回答ページ（一般公開用） |
| `http://localhost:3000/admin` | 管理画面（パスワード必要） |

## ファイル構成

```
impression-collector/
├── server.js          # Express サーバー
├── package.json
├── .env               # 環境変数（要作成）
├── .env.example       # 環境変数のサンプル
├── public/
│   ├── index.html     # 回答ページ
│   ├── style.css      # スタイル
│   └── app.js         # フロントエンド JS
├── admin/
│   └── index.html     # 管理画面
└── database/
    └── responses.db   # SQLite（初回起動時に自動生成）
```

## データについて

- 記録されるのは「質問番号・回答テキスト・回答日時」のみです
- IP アドレス・Cookie 等の個人情報は一切保存しません
- セッショントークンは回答セットをまとめるための内部 ID であり、個人と紐づきません

## 管理画面

- URL: `http://localhost:3000/admin`
- パスワードは `.env` の `ADMIN_PASSWORD` で設定
- 質問ごとにタブで回答を閲覧できます
- 「CSV エクスポート」ボタンで全回答をダウンロードできます（Excel 対応 UTF-8 BOM 付き）
