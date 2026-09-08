---
name: release-tag-and-notes
description: Git のリリースタグを決定・作成・push し、GitHub Release notes に対応内容を記入または更新する。ユーザーが「リリースタグを生成して push」「Release notes に対応内容を記入」「タグ作成からリリースノート更新まで」などを依頼したときに使う。
---
# リリースタグと Release notes を作成する

## 概要

現在のブランチと既存タグを確認し、次のリリースバージョンを決める。バージョン定義ファイルを新バージョンに更新してコミット・push したうえで、そのコミットに注釈付きタグを作成して `origin` に push する。その後、直前タグとの差分から GitHub Release notes を整理して作成または更新する。

## 前提

- 対象は現在の Git リポジトリ。
- リモートは原則 `origin`。
- GitHub Release の操作は `gh release` を使う。
- バージョン定義は `package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` の 4 ファイルにあり、`scripts/release-version.mjs`（`pnpm version:set` / `pnpm version:check`）でまとめて更新・検証する。
- タグとバージョン定義が一致していないと Release ワークフロー（`.github/workflows/release.yml`）の「Verify version matches tag」ステップで失敗する。タグだけを先行させる運用は行わない。
- `.git` への書き込み、タグ push、GitHub API への接続で sandbox 制限やネットワーク制限に当たる場合は、同じコマンドを `require_escalated` で再実行する。

## 手順

### 1. 状態確認

まず作業ツリー、ブランチ、リモート、既存タグ、バージョン定義を確認する。

```bash
git status --short --branch
git remote -v
git tag --sort=-v:refname
git log --oneline --decorate -n 12
pnpm version:check
```

確認ポイント:

- 作業ツリーに未コミット変更がある場合、リリースタグ対象に含めるべきかユーザーに確認する。勝手にコミットや破棄をしない。
- `HEAD` と `origin/<branch>` がずれている場合、タグを打つ対象コミットを確認する。
- `pnpm version:check`（引数なし）は 4 ファイルのバージョンが互いに一致しているかを確認する。ずれている場合は原因を確認し、ユーザーへ明示する。
- 現在のバージョン定義が最新タグより古い場合（例: ファイルは `0.2.2`、最新タグは `v0.2.18`）は、次タグのバージョンへ一気に更新して揃える。

### 2. 次のタグを決める

原則として、最新の SemVer タグから patch を 1 つ上げる。

例:

- 最新タグ `v0.2.4` -> 次タグ `v0.2.5`
- 最新タグが注釈付きタグなら、新しいタグも注釈付きタグにする

タグ形式は既存タグに合わせる。`v` prefix が既存にあるなら `v0.2.5` のように付ける。

### 3. バージョン定義を更新してコミット・push する

タグを作成する前に、必ずバージョン定義を新バージョンへ更新する。

```bash
pnpm version:set <X.Y.Z>
pnpm version:check <X.Y.Z>
git diff --stat
```

`pnpm version:set` は `package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を同時に書き換える。`git diff` でこの 4 ファイルだけが変わっていることを確認したら、リリースコミットとして単独でコミットし、push する。

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore(release): v<X.Y.Z>"
git push origin <branch>
```

確認ポイント:

- 他の変更をリリースコミットに混ぜない。
- 既にバージョン定義が新バージョンになっている場合（別コミットで更新済み）は、`pnpm version:check <X.Y.Z>` が通ることを確認して次へ進む。

### 4. タグ範囲を確認する

Release notes の対象差分を確認する。

```bash
git log --oneline <previous-tag>..<new-tag-or-HEAD>
git diff --stat <previous-tag>..<new-tag-or-HEAD>
```

タグ作成前なら `<new-tag-or-HEAD>` は `HEAD` でよい。タグ作成後は新タグ名で再確認する。

### 5. 注釈付きタグを作成する

タグはリリースコミット（`chore(release): v<X.Y.Z>`）またはそれ以降のコミットに付ける。作成直前に `pnpm version:check <X.Y.Z>` が通ることを再確認する。

```bash
git tag -a <new-tag> -m "Release <new-tag>"
git log --oneline --decorate -n 3
git for-each-ref refs/tags/<new-tag> --format '%(refname:short) %(objecttype) %(taggerdate:iso8601) %(subject)'
```

失敗した場合:

- `unable to create temporary file` や `unable to write tag file` は `.git` 書き込み制限の可能性が高い。同じ `git tag` コマンドを権限付きで再実行する。
- タグが既に存在する場合、上書きしない。既存タグの向き先を確認してユーザーに報告する。

### 6. タグを push する

```bash
git push origin <new-tag>
```

push 成功後、remote 側の rule bypass メッセージが出ても `new tag` として反映されていれば成功として扱う。

### 7. Release notes を作る

直前タグから新タグまでのコミットをもとに、ユーザー向けの対応内容に整理する。

推奨構成:

```markdown
## 対応内容

### 追加
- ...

### 改善
- ...

### 修正
- ...

### 含まれるコミット
- <short-sha> <subject>
```

分類の目安:

- `feat` は主に `追加`
- `fix` は `修正`
- `chore` やドキュメント・開発環境整備は内容に応じて `改善` または `修正`
- セキュリティ修正は `修正` に含め、必要なら「検証を強化」などユーザー向けに書く

コミット一覧をそのまま貼るだけで終わらせず、対応内容を先に要約する。

### 8. GitHub Release を作成または更新する

まず現在の Release を確認する。

```bash
gh release view <new-tag> --repo <owner>/<repo> --json tagName,name,body,url,isDraft,isPrerelease
```

既に Release がある場合:

```bash
gh release edit <new-tag> --repo <owner>/<repo> --title "<new-tag>" --notes '<release-notes-body>'
```

Release がない場合:

```bash
gh release create <new-tag> --repo <owner>/<repo> --title "<new-tag>" --notes '<release-notes-body>'
```

`gh release view` がネットワーク制限で失敗した場合は、権限付きで再実行する。`gh` 認証が切れている場合は、認証が必要なことをユーザーに伝える。

### 9. 反映確認

更新後に必ず GitHub 側の本文を再取得して確認する。

```bash
gh release view <new-tag> --repo <owner>/<repo> --json tagName,name,body,url
git status --short --branch
```

最後の報告には以下を含める。

- 更新したバージョンとリリースコミット
- 作成・push したタグ名
- 対象コミット
- Release URL
- Release notes を更新済みであること
- 作業ツリーの状態

## 注意事項

- タグとバージョン定義（`package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json`）は必ず一致させる。バージョン更新を省略してタグだけを作成しない。
- `git tag -f` や既存タグの移動は、ユーザーが明示的に依頼しない限り行わない。
- 未コミット変更を勝手に含めない。
- Release notes の本文に AI ツール名や生成元を入れない。
- GitHub Release の本文は日本語で、変更内容がユーザーに伝わる粒度にする。
