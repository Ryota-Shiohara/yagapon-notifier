import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DiscordExportHttpError,
  ExportApi,
  ExportInterruptedError,
  ExportSetupError,
} from './discordExportClient';

interface DiscordObject {
  id: string;
  [key: string]: unknown;
}

export interface ExportGuild extends DiscordObject {
  name: string;
}

interface ExportChannel extends DiscordObject {
  type: number;
  name?: string;
  parent_id?: string;
  thread_metadata?: { archive_timestamp: string };
  permission_overwrites?: {
    id: string;
    type: number;
    allow: string;
    deny: string;
  }[];
}

interface GuildDetails extends DiscordObject {
  owner_id: string;
  roles: { id: string; permissions: string }[];
}

interface BotMember {
  roles: string[];
}

interface ThreadList {
  threads: ExportChannel[];
  has_more?: boolean;
}

export interface ExportOptions {
  out: string;
  guildIds: string[]; // 空配列ならBotが参加する全サーバー
  channelIds: string[]; // 親チャンネルの絞り込み。配下のスレッドも含む。
  includeThreads: boolean;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

interface Selection {
  guildIds: string[];
  channelIds: string[];
  includeThreads: boolean;
}

interface Manifest {
  schemaVersion: 1;
  botId: string;
  startedAt: string;
  before: string;
  selection: Selection;
  api: 'https://discord.com/api/v10';
  attachmentFilesDownloaded: false;
}

interface MessagePage {
  schemaVersion: 1;
  guildId: string;
  channelId: string;
  snapshotBefore: string;
  page: number;
  requestedBefore: string;
  nextBefore: string;
  totalMessages: number;
  complete: boolean;
  fetchedAt: string;
  messages: DiscordObject[];
}

export interface ExportReport {
  startedAt: string;
  finishedAt?: string;
  status: 'complete' | 'partial' | 'interrupted' | 'failed';
  snapshotBefore?: string;
  guilds: number;
  completedChannels: number;
  messages: number;
  issues: { scope: string; message: string }[];
}

const MESSAGE_CHANNEL_TYPES = new Set([0, 2, 5, 10, 11, 12, 13]);
const THREAD_PARENT_TYPES = new Set([0, 5, 15, 16]);
const HISTORY_PERMISSIONS = (1n << 10n) | (1n << 16n); // VIEW_CHANNEL / READ_MESSAGE_HISTORY

export function canReadHistory(
  guild: GuildDetails,
  member: BotMember,
  botId: string,
  channel: ExportChannel
): boolean {
  if (guild.owner_id === botId) return true;
  if (
    !Array.isArray(guild.roles) ||
    !Array.isArray(member.roles) ||
    !guild.roles.some((role) => role.id === guild.id)
  ) {
    throw new Error('Botのロール権限を確認できません。');
  }
  const roleIds = new Set([guild.id, ...member.roles]);
  if ([...roleIds].some((id) => !guild.roles.some((role) => role.id === id))) {
    throw new Error('Botのロールがサーバーの権限一覧にありません。');
  }
  let permissions = guild.roles
    .filter((role) => roleIds.has(role.id))
    .reduce((bits, role) => bits | BigInt(role.permissions), 0n);
  if (permissions & (1n << 3n)) return true; // ADMINISTRATOR
  const overwrites = channel.permission_overwrites ?? [];
  const apply = (allow: bigint, deny: bigint) => {
    permissions = (permissions & ~deny) | allow;
  };
  const everyone = overwrites.find(
    (overwrite) => overwrite.type === 0 && overwrite.id === guild.id
  );
  if (everyone) apply(BigInt(everyone.allow), BigInt(everyone.deny));
  let allow = 0n;
  let deny = 0n;
  for (const overwrite of overwrites) {
    if (
      overwrite.type === 0 &&
      overwrite.id !== guild.id &&
      roleIds.has(overwrite.id)
    ) {
      allow |= BigInt(overwrite.allow);
      deny |= BigInt(overwrite.deny);
    }
  }
  apply(allow, deny);
  const personal = overwrites.find(
    (overwrite) => overwrite.type === 1 && overwrite.id === botId
  );
  if (personal) apply(BigInt(personal.allow), BigInt(personal.deny));
  const required =
    HISTORY_PERMISSIONS | ([2, 13].includes(channel.type) ? 1n << 20n : 0n);
  return (permissions & required) === required;
}

export function validateSnowflake(id: string): string {
  if (!/^[1-9]\d{0,19}$/.test(id) || BigInt(id) > (1n << 64n) - 1n) {
    throw new Error('サーバー・チャンネル・メッセージのIDが不正です。');
  }
  return id;
}

function checkInterrupted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportInterruptedError();
}

function rethrowFatal(error: unknown): void {
  if (
    error instanceof ExportInterruptedError ||
    (error instanceof DiscordExportHttpError &&
      [401, 429].includes(error.status))
  ) {
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // 完了したページだけをrenameで確定させる。未完了の.tmpは再開時に上書きする。
  await fs.writeFile(
    `${file}.tmp`,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8'
  );
  await fs.rename(`${file}.tmp`, file);
}

export async function listExportGuilds(api: ExportApi): Promise<ExportGuild[]> {
  const guilds: ExportGuild[] = [];
  let after: string | undefined;
  while (true) {
    const batch = await api.get<ExportGuild[]>('/users/@me/guilds', {
      limit: 200,
      after,
    });
    for (const guild of batch) validateSnowflake(guild.id);
    guilds.push(...batch);
    if (batch.length < 200) return guilds;
    const next = batch.reduce(
      (max, guild) => (BigInt(guild.id) > BigInt(max) ? guild.id : max),
      after ?? '0'
    );
    if (next === after) throw new Error('サーバー一覧の取得位置が進みません。');
    after = next;
  }
}

async function loadManifest(
  out: string,
  botId: string,
  selection: Selection
): Promise<Manifest> {
  const file = path.join(out, 'manifest.json');
  try {
    const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as Manifest;
    if (
      manifest.schemaVersion !== 1 ||
      manifest.botId !== botId ||
      JSON.stringify(manifest.selection) !== JSON.stringify(selection)
    ) {
      throw new Error(
        'この保存先のBotまたは取得条件が異なります。別の保存先を指定してください。'
      );
    }
    validateSnowflake(manifest.before);
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const existing = (await fs.readdir(out)).filter(
    (name) => !['.export.lock', 'manifest.json.tmp'].includes(name)
  );
  if (existing.length)
    throw new Error(
      '保存先が空ではなくmanifest.jsonもありません。別の保存先を指定してください。'
    );
  const startedAt = new Date().toISOString();
  const before = (
    (BigInt(Date.parse(startedAt)) - 1420070400000n) <<
    22n
  ).toString();
  const manifest: Manifest = {
    schemaVersion: 1,
    botId,
    startedAt,
    before,
    selection,
    api: 'https://discord.com/api/v10',
    attachmentFilesDownloaded: false,
  };
  await writeJson(file, manifest);
  return manifest;
}

async function loadProgress(
  dir: string,
  manifest: Manifest,
  guildId: string,
  channelId: string
): Promise<{
  page: number;
  before: string;
  count: number;
  complete: boolean;
}> {
  await fs.mkdir(dir, { recursive: true });
  const names = (await fs.readdir(dir))
    .filter((name) => /^\d{10}\.json$/.test(name))
    .sort();
  if (!names.length)
    return { page: 0, before: manifest.before, count: 0, complete: false };
  if (
    names.some((name, i) => name !== `${String(i + 1).padStart(10, '0')}.json`)
  ) {
    throw new Error(
      '保存済みページに欠番があります。別の保存先で取得し直してください。'
    );
  }
  const last = JSON.parse(
    await fs.readFile(path.join(dir, names[names.length - 1]), 'utf8')
  ) as MessagePage;
  validateSnowflake(last.requestedBefore);
  validateSnowflake(last.nextBefore);
  if (
    last.schemaVersion !== 1 ||
    last.guildId !== guildId ||
    last.channelId !== channelId ||
    last.snapshotBefore !== manifest.before ||
    last.page !== names.length ||
    !Array.isArray(last.messages) ||
    !Number.isSafeInteger(last.totalMessages) ||
    last.totalMessages < last.messages.length ||
    typeof last.complete !== 'boolean' ||
    last.complete !== (last.messages.length === 0) ||
    (last.complete
      ? last.nextBefore !== last.requestedBefore
      : BigInt(last.nextBefore) >= BigInt(last.requestedBefore))
  ) {
    throw new Error('保存済みページの進捗情報が不正です。');
  }
  const previous =
    names.length > 1
      ? (JSON.parse(
          await fs.readFile(path.join(dir, names[names.length - 2]), 'utf8')
        ) as MessagePage)
      : undefined;
  if (
    last.requestedBefore !== (previous?.nextBefore ?? manifest.before) ||
    last.totalMessages !== (previous?.totalMessages ?? 0) + last.messages.length
  ) {
    throw new Error('保存済みページの取得位置または件数が一致しません。');
  }
  return {
    page: last.page,
    before: last.nextBefore,
    count: last.totalMessages,
    complete: last.complete,
  };
}

async function exportChannel(
  api: ExportApi,
  out: string,
  manifest: Manifest,
  guildId: string,
  channel: ExportChannel,
  options: ExportOptions,
  onProgress: (count: number) => void
): Promise<void> {
  const base = path.join(
    out,
    'guilds',
    guildId,
    'channels',
    validateSnowflake(channel.id)
  );
  await writeJson(path.join(base, 'channel.json'), channel);
  const dir = path.join(base, 'pages');
  const progress = await loadProgress(dir, manifest, guildId, channel.id);
  onProgress(progress.count);
  if (progress.complete) {
    options.log?.(
      `保存済み: ${channel.name ?? channel.id} / ${progress.count}件`
    );
    return;
  }
  while (!progress.complete) {
    checkInterrupted(options.signal);
    const messages = await api.get<DiscordObject[]>(
      `/channels/${channel.id}/messages`,
      {
        limit: 100,
        before: progress.before,
      }
    );
    const ids = messages.map((message) => validateSnowflake(message.id));
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => BigInt(id) >= BigInt(progress.before))
    ) {
      throw new Error(
        'メッセージ取得位置が進まないため、このチャンネルを中断しました。'
      );
    }
    messages.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
    const page: MessagePage = {
      schemaVersion: 1,
      guildId,
      channelId: channel.id,
      snapshotBefore: manifest.before,
      page: progress.page + 1,
      requestedBefore: progress.before,
      nextBefore: messages.at(-1)?.id ?? progress.before,
      totalMessages: progress.count + messages.length,
      complete: messages.length === 0,
      fetchedAt: new Date().toISOString(),
      messages: messages.map((message) => ({
        ...message,
        discord_url: `https://discord.com/channels/${guildId}/${channel.id}/${message.id}`,
      })),
    };
    await writeJson(
      path.join(dir, `${String(page.page).padStart(10, '0')}.json`),
      page
    );
    Object.assign(progress, {
      page: page.page,
      before: page.nextBefore,
      count: page.totalMessages,
      complete: page.complete,
    });
    onProgress(progress.count);
    options.log?.(
      `取得中: ${channel.name ?? channel.id} / ${progress.count}件`
    );
  }
}

async function archivedThreads(
  api: ExportApi,
  route: string,
  joined: boolean,
  add: (channel: ExportChannel) => void,
  signal?: AbortSignal
): Promise<void> {
  let before: string | undefined;
  while (true) {
    checkInterrupted(signal);
    const result = await api.get<ThreadList>(route, { limit: 100, before });
    for (const thread of result.threads) add(thread);
    if (!result.has_more) return;
    const last = result.threads.at(-1);
    const next = joined ? last?.id : last?.thread_metadata?.archive_timestamp;
    if (!next || next === before)
      throw new Error('アーカイブ済みスレッドの取得位置が進みません。');
    before = next;
  }
}

export async function runDiscordExport(
  api: ExportApi,
  options: ExportOptions
): Promise<ExportReport> {
  const out = path.resolve(options.out);
  const selection: Selection = {
    guildIds: [...new Set(options.guildIds.map(validateSnowflake))].sort(),
    channelIds: [...new Set(options.channelIds.map(validateSnowflake))].sort(),
    includeThreads: options.includeThreads,
  };
  await fs.mkdir(out, { recursive: true });
  const lockPath = path.join(out, '.export.lock');
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ExportSetupError(
        '保存先がロックされています。実行中でないことを確認し、異常終了で残った.export.lockを削除して再開してください。'
      );
    }
    throw error;
  }
  const report: ExportReport = {
    startedAt: new Date().toISOString(),
    status: 'complete',
    guilds: 0,
    completedChannels: 0,
    messages: 0,
    issues: [],
  };
  const issue = (scope: string, error: unknown) => {
    rethrowFatal(error);
    const message =
      error instanceof Error ? error.message : '取得に失敗しました。';
    report.issues.push({ scope, message });
    options.log?.(`取得できない範囲: ${scope} / ${message}`);
  };
  let manifest: Manifest | undefined;
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: report.startedAt,
      })
    );
    checkInterrupted(options.signal);
    const user = await api.get<DiscordObject & { bot?: boolean }>('/users/@me');
    if (!user.bot)
      throw new Error('この取得スクリプトはBotアカウント専用です。');
    validateSnowflake(user.id);
    const application = await api.get<{ flags?: number }>('/applications/@me');
    if (!((application.flags ?? 0) & ((1 << 18) | (1 << 19)))) {
      throw new Error(
        'Message Content Intentが無効です。Developer PortalのBot設定で有効にしてください。'
      );
    }
    manifest = await loadManifest(out, user.id, selection);
    report.snapshotBefore = manifest.before;
    const allGuilds = await listExportGuilds(api);
    const guilds = allGuilds.filter(
      (guild) =>
        !selection.guildIds.length || selection.guildIds.includes(guild.id)
    );
    for (const id of selection.guildIds) {
      if (!guilds.some((guild) => guild.id === id))
        issue(`guild:${id}`, new Error('Botの参加サーバー一覧にありません。'));
    }
    const foundChannelIds = new Set<string>();
    for (const guild of guilds) {
      checkInterrupted(options.signal);
      report.guilds++;
      options.log?.(`サーバー: ${guild.name} (${guild.id})`);
      const guildBase = path.join(out, 'guilds', guild.id);
      await writeJson(path.join(guildBase, 'guild.json'), guild);
      let details: GuildDetails;
      let member: BotMember;
      try {
        details = await api.get<GuildDetails>(`/guilds/${guild.id}`);
        await writeJson(path.join(guildBase, 'guild.json'), details);
        member = await api.get<BotMember>(
          `/guilds/${guild.id}/members/${user.id}`
        );
        await writeJson(path.join(guildBase, 'bot-member.json'), member);
      } catch (error) {
        issue(`guild:${guild.id}:permissions`, error);
        continue;
      }
      let channels: ExportChannel[];
      try {
        channels = await api.get<ExportChannel[]>(
          `/guilds/${guild.id}/channels`
        );
        for (const channel of channels) validateSnowflake(channel.id);
        await writeJson(path.join(guildBase, 'channels.json'), channels);
      } catch (error) {
        issue(`guild:${guild.id}:channels`, error);
        continue;
      }
      const selected = channels.filter(
        (channel) =>
          !selection.channelIds.length ||
          selection.channelIds.includes(channel.id)
      );
      for (const channel of selected) foundChannelIds.add(channel.id);
      const targets = new Map<string, ExportChannel>();
      const readableParents: ExportChannel[] = [];
      for (const channel of selected) {
        if (
          !MESSAGE_CHANNEL_TYPES.has(channel.type) &&
          !THREAD_PARENT_TYPES.has(channel.type)
        ) {
          if (selection.channelIds.length)
            issue(
              `channel:${channel.id}:type`,
              new Error('この種類のチャンネルはメッセージ取得の対象外です。')
            );
          continue;
        }
        try {
          if (!canReadHistory(details, member, user.id, channel)) {
            throw new Error(
              '履歴取得に必要な閲覧権限がありません（ボイスでは接続権限も必要）。'
            );
          }
          readableParents.push(channel);
        } catch (error) {
          issue(`channel:${channel.id}:permissions`, error);
        }
      }
      const add = (channel: ExportChannel) => {
        validateSnowflake(channel.id);
        if (MESSAGE_CHANNEL_TYPES.has(channel.type))
          targets.set(channel.id, channel);
      };
      for (const channel of readableParents) add(channel);
      if (selection.includeThreads) {
        const parents = readableParents.filter((channel) =>
          THREAD_PARENT_TYPES.has(channel.type)
        );
        if (parents.length) {
          try {
            const active = await api.get<ThreadList>(
              `/guilds/${guild.id}/threads/active`
            );
            for (const thread of active.threads) {
              if (parents.some((parent) => parent.id === thread.parent_id))
                add(thread);
            }
          } catch (error) {
            issue(`guild:${guild.id}:active-threads`, error);
          }
        }
        for (const parent of parents) {
          try {
            await archivedThreads(
              api,
              `/channels/${parent.id}/threads/archived/public`,
              false,
              add,
              options.signal
            );
          } catch (error) {
            issue(`channel:${parent.id}:public-archives`, error);
          }
          if (parent.type !== 0) continue;
          try {
            await archivedThreads(
              api,
              `/channels/${parent.id}/threads/archived/private`,
              false,
              add,
              options.signal
            );
          } catch (error) {
            issue(`channel:${parent.id}:private-archives`, error);
            if (
              error instanceof DiscordExportHttpError &&
              error.status === 403
            ) {
              try {
                await archivedThreads(
                  api,
                  `/channels/${parent.id}/users/@me/threads/archived/private`,
                  true,
                  add,
                  options.signal
                );
              } catch (joinedError) {
                issue(
                  `channel:${parent.id}:joined-private-archives`,
                  joinedError
                );
              }
            }
          }
        }
      }
      await writeJson(path.join(guildBase, 'export-channels.json'), [
        ...targets.values(),
      ]);
      for (const channel of targets.values()) {
        let counted = 0;
        try {
          await exportChannel(
            api,
            out,
            manifest,
            guild.id,
            channel,
            options,
            (count) => {
              report.messages += count - counted;
              counted = count;
            }
          );
          report.completedChannels++;
        } catch (error) {
          issue(`channel:${channel.id}:messages`, error);
        }
      }
    }
    for (const id of selection.channelIds) {
      if (!foundChannelIds.has(id))
        issue(
          `channel:${id}`,
          new Error('対象サーバーの親チャンネル一覧にありません。')
        );
    }
    if (!guilds.length && !report.issues.length)
      issue('guilds', new Error('Botが参加するサーバーがありません。'));
    report.status = report.issues.length ? 'partial' : 'complete';
  } catch (error) {
    report.status =
      error instanceof ExportInterruptedError ? 'interrupted' : 'failed';
    report.issues.push({
      scope: 'export',
      message: error instanceof Error ? error.message : '出力に失敗しました。',
    });
  } finally {
    try {
      report.finishedAt = new Date().toISOString();
      // 条件不一致の出力先や未初期化の出力先へ、既存reportを上書きしない。
      if (manifest) await writeJson(path.join(out, 'report.json'), report);
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
  return report;
}
