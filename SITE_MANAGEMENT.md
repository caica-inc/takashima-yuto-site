# 高嶌悠人：更新・公開ガイド

確認日：2026-09-10。サイトの編集箇所と公開先をまとめた運用ガイドです。

## 管理先

- GitHub：https://github.com/caica-inc/takashima-yuto-site
- 本番の基準ブランチ：`main`（変更前にVercelのProduction Branch設定と照合）
- 構成：静的HTML
- Vercel：チーム `caica-6eca556c` / プロジェクト `takashima-yuto`（[確認できたデプロイ](https://vercel.com/caica-6eca556c/takashima-yuto/9EQJk5wyVxkYhA2k7JyX4s8SdXKy)）

上記のVercel対応はGitHubのコミットステータスで確認しました。Vercel管理画面のRoot Directory、Production Branch、独自ドメイン、環境変数は別途照合が必要です。

## 編集する場所

| 変更したい内容 | ファイル・フォルダ |
| --- | --- |
| 文章・レイアウト・動き | `index.html` |
| アイコン | `favicon.svg` |

画像・PDFなどを追加するときの配置先：`images/（新規画像追加時の標準位置）`。追加したファイルを実際にページから参照してください。フォルダを作っただけでは表示は変わりません。

## 共通の更新手順

1. このガイドと案件固有の指示を確認し、変更するページと内容を決める。
2. `main` の最新状態から `update/内容-日付` の作業ブランチを作る。
3. 上の正本ファイルを編集し、変更をコミットしてPull Requestを作る。
4. VercelのPreviewで文章・リンク・画像・スマートフォン表示を確認する。フォームやログインに変更がある場合は、その動作も確認する。
5. 確認できた変更を `main` にマージする。VercelのProduction Branchがmainに設定されていれば、本番へ自動反映される。
6. Vercelの完了表示と公開ページを確認する。

AIへの依頼例：

> このリポジトリの SITE_MANAGEMENT.md を読み、指定したページの「変更前」を「変更後」に修正してください。関連ページも確認し、変更内容と確認結果を知らせてください。

## Vercel設定の基準

| 項目 | このサイトの基準 |
| --- | --- |
| Git Repository | `caica-inc/takashima-yuto-site` |
| Root Directory | リポジトリ直下（`.`） |
| Framework Preset | Other |
| Build Command | 指定なし（Overrideを無効にする） |
| Output Directory | ルート（ビルドなし） |
| Production Branch | `main` |

Vercel設定を変更する前に現状と照合します。構成が異なるサイトへ同じBuild CommandやOutput Directoryを一律適用しないでください。

## このサイト固有の注意点

- index (1).html は本番の正本として扱わず、現行の index.html を編集する。既存の副本は役割確認前に削除しない。
- GitHub名とVercel名（takashima-yuto）が異なる。既存リンクを維持し、管理表で対応を明記する。

## ファイルの入れ方

- サイト一式を別の親フォルダで包んで追加せず、既存リポジトリ内の同じパスへ反映する。
- `index-final.html` や日付違いのZIPを増やす代わりに、Gitの履歴とブランチで版を管理する。
- APIキー・パスワード・顧客データのバックアップを公開用ファイルへ入れない。秘密情報はVercelの環境変数等、用途に合った管理先を使う。
- 新しいVercelプロジェクトを更新のたびに作らない。通常はこのリポジトリに接続した既存プロジェクトを使う。
- 不具合時は直前の変更をrevertし、必要に応じてVercelの以前の正常なデプロイへ戻す。データベース変更は別途確認する。

## 今回の反映範囲

このガイド・READMEの入口・Pull Requestのひな形を追加しました。サイト本体のファイル配置、デザイン、Vercelの設定、ドメインは変更していません。
