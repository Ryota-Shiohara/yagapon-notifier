/**
 * コマンドの読み込みとエクスポート
 */

import { Collection } from 'discord.js';
import { Command } from '../types/command';
import { help } from './implementations/help';
import { notify } from './implementations/notify';
import { ping } from './implementations/ping';

/**
 * すべてのコマンドをコレクションに格納
 */
export const commands = new Collection<string, Command>();

commands.set(ping.data.name, ping);
commands.set(notify.data.name, notify);
commands.set(help.data.name, help);
