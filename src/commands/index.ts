/**
 * コマンドの読み込みとエクスポート
 */

import { Collection } from 'discord.js';
import { Command } from '../types/command';
import { help } from './implementations/help';
import { intro } from './implementations/intro';
import { notify } from './implementations/notify';
import { ping } from './implementations/ping';

/**
 * すべてのコマンドをコレクションに格納
 */
export const commands = new Collection<string, Command>();

commands.set(ping.data.name, ping);
commands.set(notify.data.name, notify);
commands.set(help.data.name, help);
commands.set(intro.data.name, intro);
