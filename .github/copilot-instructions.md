# FlickTerm

macOS 向けの軽量ターミナルアプリ。バックエンドは Rust / Tauri 2、フロントエンドは素の HTML / CSS / TypeScript と xterm.js で構成する。

## 構成

- `src-tauri/`: Rust / Tauri アプリ本体。アプリのライフサイクル、Tauri コマンド、設定（`settings.rs`）、コマンド履歴、シェル連携、PTY 管理（portable-pty）。
- `src/renderer/`: UI。`renderer.ts` がターミナル描画・タブ・クイックコマンド・キー操作を担う。
- `src/shared/`: Rust 側と共有する IPC ペイロードやタブ・コマンドの TypeScript 型。
- `scripts/`: リリース補助スクリプト（`release-version.mjs`、`create-updater-json.mjs`）。
- `.github/workflows/release.yml`: `v*.*.*` タグ push で macOS アーティファクトを GitHub Releases に公開する。
- `.rulesync/`: AI エージェント向け rules / skills の唯一の編集元（後述）。

## 開発コマンド

ツールチェーンは `mise.toml` で固定している（Node / pnpm / Rust）。`mise exec -- <cmd>` で実行するか、`make setup` で一括セットアップする。

- `pnpm install`: 依存関係のインストール
- `pnpm dev`: Tauri 開発モードで起動
- `pnpm typecheck`: TypeScript の型チェック
- `pnpm build:renderer`: レンダラーのビルド
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust テスト
- `make check`: 上記の typecheck / renderer build / cargo test をまとめて実行
- `pnpm build`: macOS アプリバンドルのビルド

コードを変更したら、少なくとも `pnpm typecheck` と、Rust を触った場合は `cargo test` を通す。

## コミット・PR の規約

- コミットメッセージは Conventional Commits 形式で、要約は日本語で書く（例: `fix(terminal): Cmd+V の貼り付けで許可ポップアップを出さない`）。
- 目的の異なる変更は 1 つのコミットに混ぜず、分割する。
- コミット・push・タグ作成・Release 作成はユーザーの明示的な依頼があるときだけ行う。
- コミットメッセージ、PR、Release notes に AI ツール名や生成元を書かない。
- 詳細な手順は `git-commit-and-push` skill に従う。

## バージョンとリリースの規約

- バージョン定義は `package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` の 4 ファイルにあり、常に同じ値にする。手で個別に書き換えず、`pnpm version:set X.Y.Z` でまとめて更新し、`pnpm version:check X.Y.Z` で確認する。
- リリースタグ `vX.Y.Z` は、バージョン定義を `X.Y.Z` に更新したリリースコミット（`chore(release): vX.Y.Z`）以降に付ける。タグだけを先行させない。
- Release ワークフローは「Verify version matches tag」ステップでタグとバージョン定義の一致を検証し、不一致ならビルド前に失敗する。
- タグ作成から Release notes 作成までの手順は `release-tag-and-notes` skill に従う。

## AI エージェント設定（rulesync）

- rules と skills の編集元は `.rulesync/rules/` と `.rulesync/skills/` だけ。`AGENTS.md`、`.github/copilot-instructions.md`、`.github/skills/`、`.agents/skills/` は `pnpm rulesync` による生成物なので直接編集しない。
- `.rulesync/` を変更したら `pnpm rulesync` を実行して生成物を更新し、生成物も一緒にコミットする。`pnpm rulesync:check` で生成物が最新かを確認できる。

---

You must always answer in Japanese. On the other hand, reasoning (thinking) should be in English to improve token efficiency.
