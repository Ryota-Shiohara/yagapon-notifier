import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import {
  DiscordExportClient,
  DiscordExportHttpError,
  ExportInterruptedError,
  ExportSetupError,
} from './discordExportClient';
import {
  listExportGuilds,
  runDiscordExport,
  validateSnowflake,
} from './discordExportArchive';

export const EXPORT_HELP = `Discord履歴のローカル出力（Bot専用・読み取り専用）

使い方:
  npm run export:discord -- --list-guilds
  npm run export:discord -- --guild SERVER_ID --out DIRECTORY
  npm run export:discord -- --all --out DIRECTORY

オプション:
  --guild ID       サーバーID（複数回指定可。--allと併用不可）
  --all            Botが参加する全サーバーを対象にする
  --channel ID     親チャンネルIDで絞る（複数回指定可。配下のスレッドも対象）
  --out DIRECTORY  保存先。同じ条件・保存先で再実行すると保存済みページから再開
  --no-threads     スレッドを取得しない
  --delay-ms N     APIリクエスト間隔。350以上の整数（既定: 350）
  --list-guilds    サーバー一覧のみ表示する（出力ファイルを作らない）
  --help          この説明を表示する（通信・トークン読込を行わない）

DISCORD_TOKENを環境変数またはリポジトリ直下の.envに設定してください。
トークンをコマンド引数へ渡すオプションはありません。
添付ファイルはURL・メタデータを保存します。実ファイルはダウンロードしません。
`;

export function parseExportArgs(args: string[]): {
  help: boolean;
  listGuilds: boolean;
  all: boolean;
  out: string;
  guildIds: string[];
  channelIds: string[];
  includeThreads: boolean;
  delayMs: number;
} {
  const result = {
    help: false,
    listGuilds: false,
    all: false,
    out: '',
    guildIds: [] as string[],
    channelIds: [] as string[],
    includeThreads: true,
    delayMs: 350,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--list-guilds') result.listGuilds = true;
    else if (arg === '--all') result.all = true;
    else if (arg === '--no-threads') result.includeThreads = false;
    else if (['--out', '--guild', '--channel', '--delay-ms'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new Error(`${arg}の値を指定してください。`);
      if (arg === '--out') result.out = value;
      else if (arg === '--guild')
        result.guildIds.push(validateSnowflake(value));
      else if (arg === '--channel')
        result.channelIds.push(validateSnowflake(value));
      else {
        if (
          !/^\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) < 350
        ) {
          throw new Error('--delay-msは350以上の整数を指定してください。');
        }
        result.delayMs = Number(value);
      }
    } else
      throw new Error(
        '不明なオプションです。--helpで使い方を確認してください。'
      );
  }
  if (result.help) return result;
  if (result.all && result.guildIds.length)
    throw new Error('--allと--guildは併用できません。');
  if (result.listGuilds) {
    if (
      result.all ||
      result.guildIds.length ||
      result.channelIds.length ||
      result.out
    ) {
      throw new Error('--list-guildsは対象指定・保存先指定と併用できません。');
    }
    return result;
  }
  if (!result.out || (!result.all && !result.guildIds.length)) {
    throw new Error('--outと、--guildまたは--allを指定してください。');
  }
  return result;
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseExportArgs>;
  try {
    args = parseExportArgs(process.argv.slice(2));
  } catch (error) {
    // 引数検証のエラーには入力値を含めず、原因だけを表示する。
    console.error(error instanceof Error ? error.message : '引数が不正です。');
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(EXPORT_HELP);
    return;
  }
  // Bot本体のconfigは読み込まず、このツールに必要なトークンだけを利用する。
  loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token)
    throw new ExportSetupError(
      'DISCORD_TOKENが未設定です。.envまたは環境変数に設定してください。'
    );
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const api = new DiscordExportClient(token, {
      signal: controller.signal,
      delayMs: args.delayMs,
    });
    if (args.listGuilds) {
      const guilds = await listExportGuilds(api);
      for (const guild of guilds) console.log(`${guild.id}\t${guild.name}`);
      console.log(`${guilds.length}サーバー`);
      return;
    }
    const report = await runDiscordExport(api, {
      ...args,
      signal: controller.signal,
      log: console.log,
    });
    console.log(
      `結果: ${report.status} / ${report.completedChannels}チャンネル / ${report.messages}件 / 要確認 ${report.issues.length}件`
    );
    console.log(`保存先: ${path.resolve(args.out)}`);
    if (report.status === 'failed') {
      for (const item of report.issues) console.error(item.message);
    }
    process.exitCode = { complete: 0, partial: 2, interrupted: 130, failed: 1 }[
      report.status
    ];
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // 生の例外はトークンを含む可能性があるため表示しない。
    if (
      error instanceof ExportSetupError ||
      error instanceof DiscordExportHttpError ||
      error instanceof ExportInterruptedError
    ) {
      console.error(error.message);
    } else {
      console.error(
        '実行に失敗しました。--helpで指定を確認し、DISCORD_TOKENと保存先の設定を確認してください。'
      );
    }
    process.exitCode = error instanceof ExportInterruptedError ? 130 : 1;
  });
}
