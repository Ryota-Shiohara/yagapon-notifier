# Discord履歴をローカルに出力する

既存のやがぽんのBotトークンを使って、Discordのメッセージ履歴をローカルのJSONへ保存するツールです。通知Botの起動・変更・再デプロイは不要です。

## 最初に実行する

Node.jsと、このリポジトリの依存関係が必要です。インストール済みなら追加インストールは不要です。この環境ではNode.js 22.12.0で検証しています。

リポジトリ直下の`.env`に`DISCORD_TOKEN`を設定します。設定済みならそのまま利用できます。環境変数の値は`.env`より優先されます。通知用の`BOT_NOTIFY_SECRET`などは不要です。

トークンはこのチャットやGitへ貼り付けず、コマンド引数にも指定しません。稼働中のBotのトークンをリセットする必要はありません。

PowerShellでリポジトリへ移動し、まずヘルプとサーバー一覧を表示します。引数を確実に渡すため、PowerShellでは`npm.cmd`を使用します。

```powershell
Set-Location 'C:\Ryota\Yagamy\yagapon-notifier'
npm.cmd run export:discord -- --help
npm.cmd run export:discord -- --list-guilds
```

一覧の左側に表示されるサーバーIDを使い、まず1サーバーで試します。保存先はGitリポジトリの外を指定してください。

```powershell
npm.cmd run export:discord -- --guild サーバーID --out "$env:USERPROFILE\Downloads\DiscordExports\yagapon-first"
```

Botが参加する全サーバーを取得する場合は次を実行します。

```powershell
npm.cmd run export:discord -- --all --out "$env:USERPROFILE\Downloads\DiscordExports\yagapon-all"
```

複数サーバーの指定は`--guild ID --guild ID`、親チャンネルの指定は`--channel ID --channel ID`の形式です。親チャンネルを指定すると、その配下のスレッドも対象になります。スレッド自体やカテゴリのIDは指定できません。

```powershell
npm.cmd run export:discord -- --guild サーバーID --channel 親チャンネルID --out "$env:USERPROFILE\Downloads\DiscordExports\yagapon-channel"
```

## 取得できるもの

- Botが閲覧できるテキスト・お知らせチャンネルと、ボイス・ステージチャンネルのテキスト履歴
- 閲覧できる進行中・アーカイブ済みスレッド、フォーラム・メディアチャンネルの投稿
- APIが返す本文・投稿者・日時・編集日時・添付URL・Embed・返信参照・リアクション集計・投票などのメッセージデータ
- サーバー・チャンネル・Botの所属ロール情報、取得条件、失敗した範囲

各メッセージには`discord_url`を追加します。それ以外のAPI応答フィールドも保存します。

**添付ファイルの実体はダウンロードしません。** 添付URLは期限切れになる可能性があるため、長期保存で画像・資料そのものも必要な場合は、別途ファイル保存への対応が必要です。

DM、削除済みメッセージ、過去の編集履歴、リアクションした人の完全な一覧、音声録音、Botが閲覧できない範囲は取得対象に含みません。サーバーを復元するための完全バックアップではなく、ナレッジ整理用のメッセージ履歴出力です。

## 権限と取得漏れの確認

Developer PortalのBot設定で**Message Content Intent**が有効である必要があります。起動時にアプリのフラグを確認し、無効なら履歴取得を開始しません。

各チャンネルのロール・個人別上書きを計算し、**チャンネルを見る（View Channel）**と**メッセージ履歴を読む（Read Message History）**の両方があるか確認します。ボイス・ステージでは**接続（Connect）**も確認します。履歴閲覧権限がない場合、APIが空の配列を返しても完了と誤認しないための確認です。実行中の権限変更や削除による失敗もレポートに残します。

非公開のアーカイブ済みスレッドを全件列挙するには**スレッドを管理（Manage Threads）**も必要です。403で拒否された場合は、Botが参加済みの非公開スレッドを取得する経路へ切り替えます。その場合は網羅できない範囲があるため`partial`として記録します。Botへ管理者権限を付与する必要はありません。

対象を`--channel`で絞った場合、取得対象はその親チャンネルと配下のスレッドです。`--no-threads`を付けた場合はスレッドの取得を省略します。

## 保存形式と再開

```text
保存先/
  manifest.json                 # Bot ID、取得条件、初回開始時刻と上限ID
  report.json                   # 今回の実行結果と要確認の範囲
  guilds/
    サーバーID/
      guild.json                # サーバーの情報
      bot-member.json           # Botの所属ロールなど
      channels.json             # APIが返した親チャンネル一覧
      export-channels.json      # 今回の取得対象（スレッドを含む）
      channels/
        チャンネルID/
          channel.json
          pages/
            0000000001.json     # 最大100件のmessages配列と再開位置
            0000000002.json
```

名前ではなくIDをディレクトリ名に使用します。メッセージは新しい順で、1ページ最大100件です。APIが空の配列を返した最後のページには`complete: true`を記録します。JSONを読むときは各ページの`messages`配列を使用してください。

Ctrl+Cで停止した後も、**同じ対象指定・同じ保存先で同じコマンドを再実行**すれば、確定済みページの続きから再開します。保存は一時ファイルを経由して確定させるため、途中のページは再取得します。完了したチャンネルは履歴を再取得しません。

条件やBotが異なる保存先への追記は拒否します。新しい条件で取りたい場合や、初回開始後の投稿も含めて取り直したい場合は、新しい保存先を指定してください。

初回開始時刻より前のメッセージIDに範囲を固定します。ただしAPIの応答は取得時点の内容なので、実行中の編集・削除やスレッド状態の変更まで固定した厳密な時点バックアップではありません。

強制終了などで`.export.lock`が残った場合は、別の出力プロセスが同じ保存先で動いていないことを確認し、保存先の`.export.lock`だけを削除して再開します。JSONファイルや出力フォルダ全体は削除しません。

## 結果の読み方

| status        | 終了コード | 意味                                                  |
| ------------- | ---------- | ----------------------------------------------------- |
| `complete`    | 0          | 指定した範囲で取得を完了                              |
| `partial`     | 2          | 一部を取得できなかった。`report.json`の`issues`を確認 |
| `failed`      | 1          | 設定・認証・通信・保存処理などで中断                  |
| `interrupted` | 130        | Ctrl+Cなどで中断。保存済みページから再開可能          |

出力条件の不一致や初期化前の設定エラーでは、既存の`report.json`を上書きしません。コンソールのエラーを確認してください。再実行で`partial`の範囲を再試行できます。Botの権限自体は自動変更しません。

## 通信とトークンの扱いを確認する

- 通信処理: [discordExportClient.ts](../src/tools/discordExportClient.ts)
- 対象の列挙・権限計算・保存処理: [discordExportArchive.ts](../src/tools/discordExportArchive.ts)
- コマンド引数・環境変数読込: [exportDiscord.ts](../src/tools/exportDiscord.ts)

通信先は`https://discord.com/api/v10`に固定し、許可した履歴・情報取得経路へのGETだけを使用します。リダイレクトは拒否します。投稿・削除・参加・アーカイブ解除・外部アップロード・分析サービスへの送信は実装していません。添付URLへの通信も行いません。

トークンはメモリ上で保持し、DiscordへのAuthorizationヘッダーにのみ設定します。ファイルへ保存せず、応答本文・リクエストヘッダー・ネットワーク例外をログへ出しません。ただしトークン自体の権限が読み取り専用に変わるわけではありません。

全てのリクエストを直列に実行し、既定で350ms以上の間隔を空けます。Discordのレート制限ヘッダーと429応答の待機時間も守ります。5xxと通信失敗は最大5回再試行し、繰り返す429や401では全体を中断します。通知Botとは同じトークンのAPI上限を共有するため、通知が少ない時間帯に実行し、必要なら`--delay-ms 1000`などで間隔を広げてください。

出力には本文や個人情報が含まれます。保存先はGitリポジトリの外を推奨し、リポジトリ内の`exports/`もGit除外済みです。ナレッジベースへは内容を確認して必要な情報を整理した後に登録します。

## 検証

```powershell
npm test
```

出力ツールのテストは模擬APIと専用の一時ディレクトリを使います。実トークンもDiscordへの実通信も使用しません。途中再開、権限不足、スレッド列挙、レート制限、トークンを含むエラーの非表示などを確認します。

仕様の参照先: [メッセージ取得](https://docs.discord.com/developers/resources/message#get-channel-messages)、[スレッド取得](https://docs.discord.com/developers/resources/channel#list-public-archived-threads)、[権限計算](https://docs.discord.com/developers/topics/permissions#permission-overwrites)、[アプリ情報](https://docs.discord.com/developers/resources/application#get-current-application)、[レート制限](https://docs.discord.com/developers/topics/rate-limits)。
