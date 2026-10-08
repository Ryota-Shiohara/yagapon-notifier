const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  DiscordExportClient,
  DiscordExportHttpError,
} = require('../dist/tools/discordExportClient.js');
const {
  runDiscordExport,
  listExportGuilds,
  canReadHistory,
} = require('../dist/tools/discordExportArchive.js');
const { parseExportArgs } = require('../dist/tools/exportDiscord.js');

const HISTORY = (1n << 10n) | (1n << 16n);
const BOT_ID = '900';
const guild = {
  id: '100',
  name: 'テストサーバー',
  owner_id: '901',
  roles: [{ id: '100', permissions: String(HISTORY | (1n << 20n)) }],
};
const channel = { id: '200', type: 0, name: '議事録' };

async function temporaryOutput(t) {
  const out = await fs.mkdtemp(
    path.join(os.tmpdir(), 'yagapon-discord-export-')
  );
  t.after(async () => {
    // 削除対象がこのテスト専用の一時ディレクトリ内であることを確認する。
    assert.equal(path.dirname(out), path.resolve(os.tmpdir()));
    assert.match(path.basename(out), /^yagapon-discord-export-/);
    await fs.rm(out, { recursive: true, force: true });
  });
  return out;
}

function options(out, extra = {}) {
  return {
    out,
    guildIds: ['100'],
    channelIds: [],
    includeThreads: false,
    ...extra,
  };
}

function fakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    async get(route, query = {}) {
      calls.push({ route, query: { ...query } });
      if (Object.hasOwn(overrides, route)) {
        const value = overrides[route];
        return structuredClone(
          typeof value === 'function' ? await value(query, calls) : value
        );
      }
      if (route === '/users/@me') return { id: BOT_ID, bot: true };
      if (route === '/applications/@me') return { flags: 1 << 19 };
      if (route === '/users/@me/guilds')
        return [{ id: '100', name: guild.name }];
      if (route === '/guilds/100') return structuredClone(guild);
      if (route === '/guilds/100/members/900') return { roles: [] };
      if (route === '/guilds/100/channels') return [structuredClone(channel)];
      if (route.endsWith('/messages')) return [];
      if (route.includes('/threads/')) return { threads: [], has_more: false };
      throw new Error(`想定外のテストAPI経路: ${route}`);
    },
  };
}

function message(id) {
  return {
    id: String(id),
    channel_id: '200',
    content: `本文 ${id}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    author: { id: '800', username: '委員' },
  };
}

function pagesDirectory(out, id = '200') {
  return path.join(out, 'guilds', '100', 'channels', id, 'pages');
}

test('明示した対象と出力先が必要で、パス形式のIDや低すぎるリクエスト間隔を拒否する', () => {
  assert.throws(() => parseExportArgs([]), /--out/);
  assert.throws(
    () => parseExportArgs(['--all', '--guild', '100', '--out', 'output']),
    /併用/
  );
  assert.throws(
    () => parseExportArgs(['--guild', '../100', '--out', 'output']),
    /ID/
  );
  assert.throws(
    () => parseExportArgs(['--all', '--out', 'output', '--delay-ms', '0']),
    /350/
  );
  assert.throws(() => parseExportArgs(['--token', '秘密']), /不明なオプション/);
  assert.equal(parseExportArgs(['--help']).help, true);
  assert.equal(parseExportArgs(['--list-guilds']).listGuilds, true);
  assert.deepEqual(
    parseExportArgs([
      '--guild',
      '100',
      '--guild',
      '101',
      '--channel',
      '200',
      '--out',
      'output',
    ]).guildIds,
    ['100', '101']
  );
});

test('API通信はDiscord公式ホストへのGETだけで、トークンはURLに含めずリダイレクトを拒否する', async () => {
  let requests = 0;
  const client = new DiscordExportClient('test-secret', {
    delayMs: 0,
    async fetch(url, init) {
      requests++;
      assert.equal(url.origin, 'https://discord.com');
      assert.equal(url.pathname, '/api/v10/channels/200/messages');
      assert.equal(url.searchParams.get('before'), '500');
      assert.equal(String(url).includes('test-secret'), false);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bot test-secret');
      return Response.json([]);
    },
  });
  await client.get('/channels/200/messages', { before: '500' });
  for (const route of [
    'https://example.com',
    '//example.com',
    '/channels/200/messages/300',
    '/guilds/100/../200',
    '/users/@me/channels',
  ]) {
    await assert.rejects(() => client.get(route), /許可/);
  }
  assert.equal(requests, 1);
});

test('429とバケット上限の待機時間を守って再試行する', async () => {
  const waits = [];
  let requests = 0;
  const client = new DiscordExportClient('test-secret', {
    delayMs: 350,
    sleep: async (ms) => {
      waits.push(ms);
    },
    async fetch() {
      requests++;
      if (requests === 1)
        return Response.json(
          { retry_after: 0.5, global: true },
          { status: 429 }
        );
      return Response.json([], {
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset-after': '0.7',
        },
      });
    },
  });
  await client.get('/channels/200/messages');
  assert.deepEqual(waits, [350, 600, 350, 800]);
  assert.equal(requests, 2);
});

test('エラー応答・ネットワーク例外に含まれる秘密を露出せず、401は再試行しない', async () => {
  let requests = 0;
  const client = new DiscordExportClient('test-secret', {
    delayMs: 0,
    async fetch() {
      requests++;
      return Response.json(
        { message: 'test-secret', code: 50001 },
        { status: 401 }
      );
    },
  });
  await assert.rejects(
    () => client.get('/users/@me'),
    (error) => error.status === 401 && !error.message.includes('test-secret')
  );
  assert.equal(requests, 1);
  const network = new DiscordExportClient('test-secret', {
    delayMs: 0,
    sleep: async () => {},
    fetch: async () => {
      throw new Error('test-secret');
    },
  });
  await assert.rejects(
    () => network.get('/users/@me'),
    (error) => !error.message.includes('test-secret')
  );
});

test('中断済みの場合は通信を開始しない', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new DiscordExportClient('test-secret', {
    signal: controller.signal,
    fetch: async () => {
      assert.fail('通信してはいけない');
    },
  });
  await assert.rejects(() => client.get('/users/@me'), /中断/);
});

test('200件を超えるサーバー一覧をページ送りして取得する', async () => {
  const first = Array.from({ length: 200 }, (_, i) => ({
    id: String(i + 1),
    name: 'サーバー',
  }));
  const api = fakeApi({
    '/users/@me/guilds': (query) =>
      query.after ? [{ id: '201', name: '最後' }] : first,
  });
  const result = await listExportGuilds(api);
  assert.equal(result.length, 201);
  assert.equal(api.calls[1].query.after, '200');
});

test('ロール・個人の上書き順序と管理者権限を使って履歴閲覧権限を判定する', () => {
  assert.equal(canReadHistory(guild, { roles: [] }, BOT_ID, channel), true);
  const overridden = {
    ...channel,
    permission_overwrites: [
      { id: '100', type: 0, allow: '0', deny: String(HISTORY) },
      { id: '300', type: 0, allow: String(HISTORY), deny: '0' },
      { id: BOT_ID, type: 1, allow: '0', deny: String(1n << 16n) },
    ],
  };
  const roles = {
    ...guild,
    roles: [...guild.roles, { id: '300', permissions: '0' }],
  };
  assert.equal(
    canReadHistory(roles, { roles: ['300'] }, BOT_ID, overridden),
    false
  );
  overridden.permission_overwrites.pop();
  assert.equal(
    canReadHistory(roles, { roles: ['300'] }, BOT_ID, overridden),
    true
  );
  assert.equal(
    canReadHistory(
      { ...guild, roles: [{ id: '100', permissions: '8' }] },
      { roles: [] },
      BOT_ID,
      overridden
    ),
    true
  );
});

test('メッセージの全フィールドと参照URLを保存し、空ページまで取得して完了を記録する', async (t) => {
  const out = await temporaryOutput(t);
  const raw = {
    ...message(500),
    edited_timestamp: '2026-01-02T00:00:00.000Z',
    attachments: [
      {
        id: '700',
        filename: '写真.jpg',
        url: 'https://cdn.discordapp.com/example',
      },
    ],
    embeds: [{ title: 'おしらせ' }],
    reactions: [{ count: 3 }],
    message_reference: { message_id: '400' },
    poll: { question: { text: '日程' } },
    components: [],
  };
  const api = fakeApi({
    '/channels/200/messages': (query) => (query.before === '500' ? [] : [raw]),
  });
  const report = await runDiscordExport(api, options(out));
  assert.equal(report.status, 'complete');
  assert.equal(report.messages, 1);
  assert.equal(report.completedChannels, 1);
  const page = JSON.parse(
    await fs.readFile(path.join(pagesDirectory(out), '0000000001.json'))
  );
  assert.deepEqual(page.messages[0], {
    ...raw,
    discord_url: 'https://discord.com/channels/100/200/500',
  });
  const end = JSON.parse(
    await fs.readFile(path.join(pagesDirectory(out), '0000000002.json'))
  );
  assert.equal(end.complete, true);
  assert.equal(end.totalMessages, 1);
  await assert.rejects(() => fs.access(path.join(out, '.export.lock')), {
    code: 'ENOENT',
  });
});

test('途中のAPI失敗後は保存済み100件の次から再開し、重複や既存ページの上書きをしない', async (t) => {
  const out = await temporaryOutput(t);
  const first = Array.from({ length: 100 }, (_, i) => message(1000 - i));
  const failedApi = fakeApi({
    '/channels/200/messages': (query) => {
      if (query.before === '901')
        throw new DiscordExportHttpError(503, '/channels/200/messages');
      return first;
    },
  });
  const failed = await runDiscordExport(failedApi, options(out));
  assert.equal(failed.status, 'partial');
  assert.equal(failed.messages, 100);
  const firstPath = path.join(pagesDirectory(out), '0000000001.json');
  const original = await fs.readFile(firstPath, 'utf8');
  const resumedApi = fakeApi({
    '/channels/200/messages': (query) =>
      query.before === '901' ? [message(900), message(899)] : [],
  });
  const resumed = await runDiscordExport(resumedApi, options(out));
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.messages, 102);
  assert.equal(
    resumedApi.calls.find((call) => call.route.endsWith('/messages')).query
      .before,
    '901'
  );
  assert.equal(await fs.readFile(firstPath, 'utf8'), original);
  const skippedApi = fakeApi();
  const skipped = await runDiscordExport(skippedApi, options(out));
  assert.equal(skipped.messages, 102);
  assert.equal(
    skippedApi.calls.some((call) => call.route.endsWith('/messages')),
    false
  );
});

test('Ctrl+C相当の中断でも確定済みページを残し、ロックを解除して再開できる', async (t) => {
  const out = await temporaryOutput(t);
  const controller = new AbortController();
  const api = fakeApi({ '/channels/200/messages': [message(500)] });
  const report = await runDiscordExport(
    api,
    options(out, {
      signal: controller.signal,
      log: (text) => {
        if (text.startsWith('取得中:')) controller.abort();
      },
    })
  );
  assert.equal(report.status, 'interrupted');
  assert.equal(report.messages, 1);
  const resumedApi = fakeApi();
  const resumed = await runDiscordExport(resumedApi, options(out));
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.messages, 1);
  assert.equal(
    resumedApi.calls.find((call) => call.route.endsWith('/messages')).query
      .before,
    '500'
  );
});

test('取得条件が違う保存先は拒否し、既存manifestとreportを変更しない', async (t) => {
  const out = await temporaryOutput(t);
  await runDiscordExport(fakeApi(), options(out));
  const previousManifest = await fs.readFile(
    path.join(out, 'manifest.json'),
    'utf8'
  );
  const previousReport = await fs.readFile(
    path.join(out, 'report.json'),
    'utf8'
  );
  const result = await runDiscordExport(
    fakeApi(),
    options(out, { includeThreads: true })
  );
  assert.equal(result.status, 'failed');
  assert.match(result.issues[0].message, /条件/);
  assert.equal(
    await fs.readFile(path.join(out, 'manifest.json'), 'utf8'),
    previousManifest
  );
  assert.equal(
    await fs.readFile(path.join(out, 'report.json'), 'utf8'),
    previousReport
  );
});

test('Message Content Intentが無効の場合とBot以外の場合は履歴取得を始めない', async (t) => {
  const out = await temporaryOutput(t);
  for (const overrides of [
    { '/applications/@me': { flags: 0 } },
    { '/users/@me': { id: BOT_ID, bot: false } },
  ]) {
    const api = fakeApi(overrides);
    const report = await runDiscordExport(api, options(out));
    assert.equal(report.status, 'failed');
    assert.equal(
      api.calls.some((call) => call.route.endsWith('/messages')),
      false
    );
    await assert.rejects(() => fs.access(path.join(out, 'manifest.json')), {
      code: 'ENOENT',
    });
  }
});

test('履歴閲覧権限がないチャンネルを空の完了として扱わず、他のチャンネルは取得する', async (t) => {
  const out = await temporaryOutput(t);
  const api = fakeApi({
    '/guilds/100/channels': [
      {
        ...channel,
        permission_overwrites: [
          { id: '100', type: 0, allow: '0', deny: String(1n << 16n) },
        ],
      },
      { id: '201', type: 2, name: 'ボイスのチャット' },
    ],
  });
  const report = await runDiscordExport(api, options(out));
  assert.equal(report.status, 'partial');
  assert.equal(report.completedChannels, 1);
  assert.equal(
    api.calls.some((call) => call.route === '/channels/200/messages'),
    false
  );
  assert.equal(
    api.calls.some((call) => call.route === '/channels/201/messages'),
    true
  );
  assert.match(report.issues[0].message, /権限/);
});

test('公開・参加済み非公開スレッドをページ送りし、重複を除いて取得する', async (t) => {
  const out = await temporaryOutput(t);
  const thread = (id, type = 11) => ({
    id,
    type,
    parent_id: '200',
    name: `スレッド${id}`,
    thread_metadata: { archive_timestamp: '2026-01-01T00:00:00.000Z' },
  });
  const api = fakeApi({
    '/guilds/100/threads/active': { threads: [thread('301')] },
    '/channels/200/threads/archived/public': (query) =>
      query.before
        ? { threads: [thread('302')], has_more: false }
        : { threads: [thread('301')], has_more: true },
    '/channels/200/threads/archived/private': () => {
      throw new DiscordExportHttpError(
        403,
        '/channels/200/threads/archived/private'
      );
    },
    '/channels/200/users/@me/threads/archived/private': (query) =>
      query.before
        ? { threads: [thread('304', 12)], has_more: false }
        : { threads: [thread('305', 12)], has_more: true },
  });
  const report = await runDiscordExport(
    api,
    options(out, { includeThreads: true })
  );
  assert.equal(report.status, 'partial'); // 非参加の非公開スレッドを網羅できないことも記録
  assert.equal(report.completedChannels, 5);
  assert.equal(
    api.calls.filter((call) => call.route === '/channels/301/messages').length,
    1
  );
  assert.equal(
    api.calls.filter((call) =>
      call.route.endsWith('/threads/archived/public')
    )[1].query.before,
    '2026-01-01T00:00:00.000Z'
  );
  assert.equal(
    api.calls.filter((call) => call.route.includes('/users/@me/threads'))[1]
      .query.before,
    '305'
  );
});

test('フォーラムは投稿スレッドを取得し、親チャンネルのmessagesは呼び出さない', async (t) => {
  const out = await temporaryOutput(t);
  const api = fakeApi({
    '/guilds/100/channels': [
      { id: '210', type: 15, name: 'フォーラム' },
      channel,
    ],
    '/channels/210/threads/archived/public': {
      threads: [{ id: '310', parent_id: '210', type: 11 }],
      has_more: false,
    },
  });
  const report = await runDiscordExport(
    api,
    options(out, { includeThreads: true, channelIds: ['210'] })
  );
  assert.equal(report.status, 'complete');
  assert.equal(report.completedChannels, 1);
  assert.equal(
    api.calls.some(
      (call) =>
        call.route === '/channels/210/messages' ||
        call.route === '/channels/200/messages'
    ),
    false
  );
  assert.equal(
    api.calls.some((call) => call.route === '/channels/310/messages'),
    true
  );
});

test('APIの403をレポートへ記録し、未知の対象IDを成功扱いしない', async (t) => {
  const out = await temporaryOutput(t);
  const api = fakeApi({
    '/channels/200/messages': () => {
      throw new DiscordExportHttpError(403, '/channels/200/messages');
    },
  });
  const report = await runDiscordExport(
    api,
    options(out, { channelIds: ['200', '999'] })
  );
  assert.equal(report.status, 'partial');
  assert.equal(report.completedChannels, 0);
  assert.equal(report.issues.length, 2);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(out, 'report.json'))),
    report
  );
});

test('保存済みページの欠番と二重起動を検知する', async (t) => {
  const out = await temporaryOutput(t);
  const api = fakeApi({
    '/channels/200/messages': (query) =>
      query.before === '500' ? [] : [message(500)],
  });
  await runDiscordExport(api, options(out));
  await fs.unlink(path.join(pagesDirectory(out), '0000000001.json'));
  const result = await runDiscordExport(fakeApi(), options(out));
  assert.equal(result.status, 'partial');
  assert.match(result.issues[0].message, /欠番/);
  await fs.writeFile(path.join(out, '.export.lock'), 'test-lock');
  await assert.rejects(
    () => runDiscordExport(fakeApi(), options(out)),
    /ロック/
  );
  assert.equal(
    await fs.readFile(path.join(out, '.export.lock'), 'utf8'),
    'test-lock'
  );
});

test('初期化中の未確定manifestとページの一時ファイルが残っても再開できる', async (t) => {
  const out = await temporaryOutput(t);
  await fs.writeFile(path.join(out, 'manifest.json.tmp'), '{');
  const firstApi = fakeApi({
    '/channels/200/messages': (query) =>
      query.before === '500' ? [] : [message(500)],
  });
  const first = await runDiscordExport(firstApi, options(out));
  assert.equal(first.status, 'complete');
  const endFile = path.join(pagesDirectory(out), '0000000002.json');
  await fs.unlink(endFile);
  await fs.writeFile(`${endFile}.tmp`, '{');
  const api = fakeApi();
  const resumed = await runDiscordExport(api, options(out));
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.messages, 1);
  assert.equal(
    api.calls.find((call) => call.route.endsWith('/messages')).query.before,
    '500'
  );
  await assert.rejects(() => fs.access(`${endFile}.tmp`), { code: 'ENOENT' });
});
