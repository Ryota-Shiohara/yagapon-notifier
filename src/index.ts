/**
 * src/index.ts
 *
 * エントリーポイント
 * 仕様設計書 (v2) に基づくDiscordボット兼Expressサーバー
 */

import { createApp } from './app';
import { DiscordBot } from './bot';
import { config } from './config/env';

async function main() {
  // Discordボットの初期化
  const bot = new DiscordBot();

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
