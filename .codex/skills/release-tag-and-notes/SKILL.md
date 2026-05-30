---
name: release-tag-and-notes
description: Git のリリースタグを決定・作成・push し、GitHub Release notes に対応内容を記入または更新する。ユーザーが「リリースタグを生成して push」「Release notes に対応内容を記入」「タグ作成からリリースノート更新まで」などを依頼したときに使う。
---
# リリースタグと Release notes を作成する

## 概要

現在のブランチと既存タグを確認し、次のリリースタグを注釈付きタグとして作成して `origin` に push する。その後、直前タグとの差分から GitHub Release notes を整理して作成または更新する。

## 前提

- 対象は現在の Git リポジトリ。
- リモートは原則 `origin`。
- GitHub Release の操作は `gh release` を使う。
- `.git` への書き込み、タグ push、GitHub API への接続で sandbox 制限やネットワーク制限に当たる場合は、同じコマンドを `require_escalated` で再実行する。

## 手順

### 1. 状態確認

まず作業ツリー、ブランチ、リモート、既存タグ、バージョン定義を確認する。

```bash
git status --short --branch
git remote -v
git tag --sort=-v:refname
git log --oneline --decorate -n 12
rg '"version"|^version =' package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
```

確認ポイント:

- 作業ツリーに未コミット変更がある場合、リリースタグ対象に含めるべきかユーザーに確認する。勝手にコミットや破棄をしない。
- `HEAD` と `origin/<branch>` がずれている場合、タグを打つ対象コミットを確認する。
- バージョンファイルと最新タグがずれている場合はユーザーへ明示する。ただし、既存運用でタグのみ先行している場合は、タグ作成だけで進めてよい。

### 2. 次のタグを決める

原則として、最新の SemVer タグから patch を 1 つ上げる。

例:

- 最新タグ `v0.2.4` -> 次タグ `v0.2.5`
- 最新タグが注釈付きタグなら、新しいタグも注釈付きタグにする

タグ形式は既存タグに合わせる。`v` prefix が既存にあるなら `v0.2.5` のように付ける。

### 3. タグ範囲を確認する

Release notes の対象差分を確認する。

```bash
git log --oneline <previous-tag>..<new-tag-or-HEAD>
git diff --stat <previous-tag>..<new-tag-or-HEAD>
```

タグ作成前なら `<new-tag-or-HEAD>` は `HEAD` でよい。タグ作成後は新タグ名で再確認する。

### 4. 注釈付きタグを作成する

```bash
git tag -a <new-tag> -m "Release <new-tag>"
git log --oneline --decorate -n 3
git for-each-ref refs/tags/<new-tag> --format '%(refname:short) %(objecttype) %(taggerdate:iso8601) %(subject)'
```

失敗した場合:

- `unable to create temporary file` や `unable to write tag file` は `.git` 書き込み制限の可能性が高い。同じ `git tag` コマンドを権限付きで再実行する。
- タグが既に存在する場合、上書きしない。既存タグの向き先を確認してユーザーに報告する。

### 5. タグを push する

```bash
git push origin <new-tag>
```

push 成功後、remote 側の rule bypass メッセージが出ても `new tag` として反映されていれば成功として扱う。

### 6. Release notes を作る

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

### 7. GitHub Release を作成または更新する

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

### 8. 反映確認

更新後に必ず GitHub 側の本文を再取得して確認する。

```bash
gh release view <new-tag> --repo <owner>/<repo> --json tagName,name,body,url
git status --short --branch
```

最後の報告には以下を含める。

- 作成・push したタグ名
- 対象コミット
- Release URL
- Release notes を更新済みであること
- 作業ツリーの状態

## 注意事項

- `git tag -f` や既存タグの移動は、ユーザーが明示的に依頼しない限り行わない。
- 未コミット変更を勝手に含めない。
- Release notes の本文に AI ツール名や生成元を入れない。
- GitHub Release の本文は日本語で、変更内容がユーザーに伝わる粒度にする。
