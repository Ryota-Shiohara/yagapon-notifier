/**
 * アプリケーションのエントリーポイント
 * Discordボット + Expressサーバーを起動
 */

import { createApp } from './app';
import { DiscordBot } from './bot';
import { config } from './config/env';

async function main() {
  // Discordボットの初期化
  const bot = new DiscordBot();

  if (config.MARKDOWN_PREVIEW.enabled) {
    // 書込権限を起動時に検証し、再起動後の期限切れファイルも回収する。
    await bot.markdownPreviewStore.cleanup();
    const timer = setInterval(() => {
      void bot.markdownPreviewStore.cleanup().catch(() => {
        console.error(
          JSON.stringify({ event: 'markdown_preview_cleanup_failed' })
        );
      });
    }, config.MARKDOWN_PREVIEW.cleanupIntervalMs);
    timer.unref();
  }

  // Expressアプリの作成
  const app = createApp(bot);

  // サーバーとボットの起動
  // 仕様書 6.1 と 8.6 に基づき、login() の「前」に listen() を呼ぶ
  app.listen(config.PORT, async () => {
    console.log(
      `🔥 HTTPサーバーが http://localhost:${config.PORT} で起動しました。`
    );

    // Expressサーバーが起動してからDiscordボットをログインさせる
    await bot.login();
  });
}

main().catch((error) => {
  console.error('起動中にエラーが発生しました:', error);
  process.exit(1);
});
