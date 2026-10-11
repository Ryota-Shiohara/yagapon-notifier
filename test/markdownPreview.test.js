const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, rm, readdir, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const express = require('express');
const { Collection, ChannelType } = require('discord.js');
const { readMarkdownPreviewConfig } = require('../dist/config/markdownPreview');
const {
  MarkdownPreviewStore,
} = require('../dist/services/markdownPreviewStore');
const { downloadMarkdown } = require('../dist/services/markdownDownload');
const {
  createMarkdownAttachmentHandler,
} = require('../dist/handlers/markdownAttachmentHandler');
const {
  createMarkdownPreviewRouter,
} = require('../dist/routes/markdownPreview');
const {
  renderMarkdownPreview,
} = require('../dist/services/markdownPreviewHtml');

const source = {
  filename: '資料<&".md',
  postedAt: '2026-10-12T00:00:00Z',
  guildId: 'guild',
  channelId: '123456789012345678',
  messageId: 'message',
  attachmentId: 'attachment',
};
function options(path, overrides = {}) {
  return {
    ...readMarkdownPreviewConfig({}),
    enabled: true,
    channelIds: [source.channelId],
    publicUrl: 'https://preview.example.com',
    storePath: path,
    ...overrides,
  };
}
async function withStore(callback, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'yagapon-markdown-'));
  const config = options(directory, overrides);
  try {
    await callback(new MarkdownPreviewStore(config), config, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function message(attachments, overrides = {}) {
  const replies = [];
  return {
    author: { bot: false },
    guild: { roles: { everyone: {} } },
    guildId: source.guildId,
    channelId: source.channelId,
    id: source.messageId,
    content: '',
    createdAt: new Date(source.postedAt),
    channel: {
      type: ChannelType.GuildText,
      permissionsFor: () => ({ has: () => true }),
    },
    attachments: new Collection(
      attachments.map((a, i) => [
        String(i),
        {
          id: String(i),
          name: 'readme.md',
          size: 3,
          url: 'https://cdn.discordapp.com/attachments/1/2/file.md',
          ...a,
        },
      ])
    ),
    reply: async (reply) => {
      replies.push(reply);
      return { id: 'reply-' + replies.length };
    },
    replies,
    ...overrides,
  };
}

test('初期無効、公開URLと許可リストを検証', () => {
  const config = readMarkdownPreviewConfig({});
  assert.equal(config.enabled, false);
  assert.deepEqual(config.channelIds, ['*']);
  assert.deepEqual(
    readMarkdownPreviewConfig({
      MARKDOWN_PREVIEW_ENABLED: 'true',
      MARKDOWN_PREVIEW_PUBLIC_URL: 'https://example.com',
    }).channelIds,
    ['*']
  );
  assert.throws(() =>
    readMarkdownPreviewConfig({ MARKDOWN_PREVIEW_ENABLED: 'true' })
  );
  for (const url of [
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com/?secret=x',
  ]) {
    assert.throws(() =>
      readMarkdownPreviewConfig({
        MARKDOWN_PREVIEW_ENABLED: 'true',
        MARKDOWN_PREVIEW_CHANNEL_IDS: source.channelId,
        MARKDOWN_PREVIEW_PUBLIC_URL: url,
      })
    );
  }
  assert.throws(() =>
    readMarkdownPreviewConfig({ MARKDOWN_PREVIEW_MAX_FILES: '1abc' })
  );
});

test('本文なし・あり・複数添付・大文字拡張子に返信し同時重複と再起動後の重複を抑止', async () => {
  await withStore(async (store, config) => {
    let downloads = 0;
    const download = async () => {
      downloads++;
      return '# title';
    };
    const handler = createMarkdownAttachmentHandler(config, store, download);
    const msg = message([
      { name: source.filename },
      { name: 'README.MD' },
      { name: 'image.png' },
    ]);
    await Promise.all([handler(msg), handler(msg)]);
    assert.equal(msg.replies.length, 2);
    assert.equal(downloads, 2);
    const button = msg.replies[0].components[0].toJSON().components[0];
    assert.equal(button.style, 5);
    assert.match(
      button.url,
      /^https:\/\/preview.example.com\/preview\/[0-9a-f-]{36}$/
    );
    assert.deepEqual(msg.replies[0].allowedMentions, {
      parse: [],
      repliedUser: false,
    });
    assert.equal(msg.replies[0].enforceNonce, true);
    await createMarkdownAttachmentHandler(
      config,
      new MarkdownPreviewStore(config),
      download
    )(msg);
    assert.equal(msg.replies.length, 2);
    const text = message([{}], { id: 'another-message', content: '!ping' });
    await handler(text);
    assert.equal(text.replies.length, 1);
    assert.equal(text.content, '!ping');
  });
});

test('Bot・非対象・無効・DM・非mdは取得も返信もしない', async () => {
  await withStore(async (store, config) => {
    let downloads = 0;
    const download = async () => {
      downloads++;
      return '# unexpected';
    };
    const handler = createMarkdownAttachmentHandler(config, store, download);
    const cases = [
      message([{}], { author: { bot: true } }),
      message([{}], { channelId: 'other' }),
      message([{}], { guild: null }),
      message([{ name: 'file.txt' }]),
    ];
    for (const msg of cases) {
      await handler(msg);
      assert.equal(msg.replies.length, 0);
    }
    await createMarkdownAttachmentHandler(
      { ...config, enabled: false },
      store,
      download
    )(message([{}]));
    assert.equal(downloads, 0);
  });
});

test('全チャンネル設定では権限限定・スレッド・ボイス内テキストでもmdだけ処理する', async () => {
  await withStore(async (store, config) => {
    const downloaded = [];
    const handler = createMarkdownAttachmentHandler(
      { ...config, channelIds: ['*'] },
      store,
      async (a) => {
        downloaded.push(a.name);
        return '# md';
      }
    );
    for (const type of [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.GuildVoice,
    ]) {
      const msg = message(
        [
          { name: 'only.MD' },
          { name: 'other.txt' },
          { name: 'fake.md.exe' },
          { name: null },
        ],
        {
          id: `message-${type}`,
          channelId: `channel-${type}`,
          channel: { type, permissionsFor: () => ({ has: () => false }) },
        }
      );
      await handler(msg);
      assert.equal(msg.replies.length, 1);
    }
    assert.deepEqual(downloaded, Array(5).fill('only.MD'));
  });
});

test('添付ごとの取得失敗後も他のファイルを処理、送信失敗後の再試行は同じURL', async () => {
  await withStore(async (store, config) => {
    const handler = createMarkdownAttachmentHandler(
      config,
      store,
      async (a) => {
        if (a.id === '0') throw new Error('secret-url');
        return '# ok';
      }
    );
    const msg = message([{}, {}]);
    await handler(msg);
    assert.equal(msg.replies.length, 1);
    let sent;
    const retry = message([{}], {
      id: 'retry',
      reply: async (r) => {
        sent = r;
        throw new Error('send');
      },
    });
    const retryHandler = createMarkdownAttachmentHandler(
      config,
      store,
      async () => '# retry'
    );
    await retryHandler(retry);
    const failedUrl = sent.components[0].toJSON().components[0].url;
    retry.reply = async (r) => {
      sent = r;
      return { id: 'success' };
    };
    await retryHandler(retry);
    assert.equal(sent.components[0].toJSON().components[0].url, failedUrl);
  });
});

test('保存メタデータ・本文・返信履歴は再起動後も読み込める、期限切れは削除', async () => {
  await withStore(async (_store, config, path) => {
    let now = 1000;
    const store = new MarkdownPreviewStore(config, () => now);
    const record = await store.save(source, '# hello');
    await store.markReplied(record.id, 'reply');
    const restarted = new MarkdownPreviewStore(config, () => now);
    const result = await restarted.get(record.id);
    assert.equal(result.status, 'found');
    assert.equal(result.record.markdown, '# hello');
    assert.equal(result.record.replyId, 'reply');
    assert.equal(result.record.filename, source.filename);
    assert.equal((await restarted.get('../secret')).status, 'missing');
    now += config.ttlMs;
    assert.equal((await restarted.get(record.id)).status, 'expired');
    assert.deepEqual(await readdir(path), []);
    await store.save(source, '# new');
    now += config.ttlMs;
    await restarted.cleanup();
    assert.deepEqual(await readdir(path), []);
  });
});

test('件数・容量・本文サイズ上限で保存を拒否、同時保存でも上限を超えない', async () => {
  await withStore(
    async (store) => {
      const results = await Promise.allSettled([
        store.save(source, '# a'),
        store.save({ ...source, attachmentId: '2' }, '# b'),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      await assert.rejects(
        store.save({ ...source, attachmentId: '3' }, 'x'.repeat(1025)),
        /file_too_large/
      );
    },
    { maxFiles: 1, maxFileBytes: 1024 }
  );
  await withStore(
    async (store, config, path) => {
      for (let i = 0; i < 10; i++)
        await store
          .save({ ...source, attachmentId: String(i) }, 'x'.repeat(10))
          .catch(() => {});
      const files = await readdir(path);
      const sizes = await Promise.all(files.map((f) => stat(join(path, f))));
      assert.ok(sizes.reduce((a, s) => a + s.size, 0) <= config.maxTotalBytes);
      await assert.rejects(
        store.save({ ...source, attachmentId: 'large' }, 'x'.repeat(2048)),
        /storage_full/
      );
    },
    { maxTotalBytes: 2000 }
  );
});

test('Discordダウンロードはサイズ・HTTP・UTF8・リダイレクト・接続先・タイムアウトを検証', async () => {
  const attachment = {
    url: 'https://cdn.discordapp.com/attachments/1/2/a.md?signature=secret',
    size: 3,
  };
  assert.equal(
    await downloadMarkdown(attachment, 100, 1000, async (_url, init) => {
      assert.equal(init.redirect, 'error');
      return new Response('# 日本語');
    }),
    '# 日本語'
  );
  await assert.rejects(
    downloadMarkdown({ ...attachment, size: 101 }, 100, 100)
  );
  await assert.rejects(downloadMarkdown(attachment, 2, 100));
  await assert.rejects(
    downloadMarkdown(
      attachment,
      10,
      100,
      async () => new Response('x'.repeat(11))
    )
  );
  await assert.rejects(
    downloadMarkdown(
      attachment,
      100,
      100,
      async () => new Response('', { status: 404 })
    )
  );
  await assert.rejects(
    downloadMarkdown(
      attachment,
      100,
      100,
      async () => new Response(Uint8Array.from([0xff]))
    )
  );
  await assert.rejects(
    downloadMarkdown(
      attachment,
      100,
      100,
      async () => new Response('x', { headers: { 'content-length': '101' } })
    )
  );
  for (const url of [
    'http://cdn.discordapp.com/attachments/a',
    'https://evil.example/attachments/a',
    'https://cdn.discordapp.com.evil.example/attachments/a',
    'https://cdn.discordapp.com/nope',
  ]) {
    await assert.rejects(
      downloadMarkdown({ ...attachment, url }, 100, 100, async () => {
        assert.fail('must not fetch');
      })
    );
  }
  await assert.rejects(
    downloadMarkdown(
      attachment,
      100,
      10,
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    ),
    /aborted/
  );
  await assert.rejects(
    downloadMarkdown(
      attachment,
      100,
      10,
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener('abort', () =>
                controller.error(new Error('body_timeout'))
              );
            },
          })
        )
    ),
    /body_timeout/
  );
});

test('安全なMarkdown HTMLとファイル名、表・コード・引用をレンダリング', () => {
  const html = renderMarkdownPreview({
    ...source,
    expiresAt: Date.now() + 10000,
    markdown:
      '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```js\n<script>alert(1)</script>\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [data](data:text/html,evil) [relative](../secret) [ok](https://example.com)\n\n![tracking](https://evil.example/image)',
  });
  assert.match(html, /<table>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(
    html,
    /<script|<img|href="javascript:|href="data:|href="\.\./
  );
  assert.match(html, /資料&lt;&amp;&quot;\.md/);
  assert.match(html, /name="viewport"/);
});

test('HTTPでプレビュー取得、404/410、CSP・キャッシュ・リファラー制御', async () => {
  await withStore(async (_store, config) => {
    let now = Date.now();
    const store = new MarkdownPreviewStore(config, () => now);
    const record = await store.save(source, '# readable');
    const app = express();
    app.use(createMarkdownPreviewRouter(store));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/preview/`;
    try {
      const response = await fetch(url + record.id);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<h1>readable<\/h1>/);
      assert.match(
        response.headers.get('content-security-policy'),
        /default-src 'none'/
      );
      assert.match(
        response.headers.get('content-security-policy'),
        /style-src 'sha256-/
      );
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal((await fetch(url + 'invalid')).status, 404);
      now += config.ttlMs;
      assert.equal((await fetch(url + record.id)).status, 410);
      assert.equal((await fetch(url + record.id)).status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
