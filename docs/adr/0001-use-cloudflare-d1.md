# ADR-0001: Use Cloudflare D1 as Primary Database

## Status

Accepted

## Context

PRPing は Cloudflare Workers 上で動作する GitHub App で、`/remind <memo>` コマンドによるリマインダーを保存・取得・削除する。データベースの要件:

- テーブル 1〜2 個（reminders, processed_deliveries）
- UPSERT / SELECT / DELETE のみ
- 書き込み頻度は低い（コマンド実行時 + issue close / PR merge 時）
- データ量は小さい

候補として D1（Cloudflare）と Turso（libSQL）を比較した。

## Decision Drivers

- Workers との統合の容易さ
- セットアップの手軽さ
- ベンダーロックインの許容度
- 将来の移行コスト

## Considered Options

### Option 1: Cloudflare D1

- **Pros**: wrangler.toml に binding を書くだけ。SDK 不要、認証不要。Workers との相性が最も良い
- **Cons**: Cloudflare にロックイン。D1 API は CF 専用

### Option 2: Turso (libSQL)

- **Pros**: オープンソース（libSQL）。ベンダーロック低。ローカル SQLite でも動く。Drizzle 対応が厚い
- **Cons**: `@libsql/client` の HTTP ドライバが必要。URL + auth token の管理が追加

## Decision

**Cloudflare D1** を採用する。

## Rationale

1. DB 層が 3 関数のみで、将来の差し替えコストが極めて低い
2. PRPing は Workers の webhook ハンドラとして自然な構成であり、Workers から離れる動機が薄い
3. この規模では Turso の利点（ベンダー非依存、Embedded Replicas 等）が活きない
4. ゼロ設定の手軽さが v1 の立ち上げ速度に直結する

## Consequences

### Positive

- インフラ設定が最小限（wrangler.toml のみ）
- 追加の認証情報管理が不要
- Workers のランタイムからゼロレイテンシでアクセス

### Negative

- Cloudflare Workers にロックイン（ただし DB 層が薄いので移行は容易）
- D1 のエコシステムは Turso/libSQL より小さい

## Related Decisions

- デプロイ先として Cloudflare Workers を採用（wrangler.toml で確定済み）
