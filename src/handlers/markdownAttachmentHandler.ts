import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
} from 'discord.js';
import { MarkdownPreviewConfig } from '../config/markdownPreview';
import { downloadMarkdown } from '../services/markdownDownload';
import { MarkdownPreviewStore } from '../services/markdownPreviewStore';
import { createDiscordNonce } from '../services/discordNonce';

export function createMarkdownAttachmentHandler(
  config: MarkdownPreviewConfig,
  store: MarkdownPreviewStore,
  download = downloadMarkdown
): (message: Message) => Promise<void> {
  const pending = new Map<string, Promise<void>>();
  let queue: Promise<void> = Promise.resolve();
  return (message) => {
    if (
      !config.enabled ||
      message.author.bot ||
      !message.guild ||
      (!config.channelIds.includes('*') &&
        !config.channelIds.includes(message.channelId))
    ) {
      return Promise.resolve();
    }
    const attachments = [...message.attachments.values()].filter((a) =>
      /\.md$/i.test(a.name || '')
    );
    if (!attachments.length) return Promise.resolve();
    const key = `${message.channelId}:${message.id}`;
    const existing = pending.get(key);
    if (existing) return existing;
    // 無料枠VMでダウンロードが同時に大量発生することを避ける。
    if (pending.size >= 50) {
      console.warn(
        JSON.stringify({
          event: 'markdown_preview_queue_full',
          messageId: message.id,
        })
      );
      return Promise.resolve();
    }
    const job = queue
      .then(async () => {
        for (const attachment of attachments) {
          try {
            const source = {
              filename: attachment.name!,
              postedAt: message.createdAt.toISOString(),
              guildId: message.guildId!,
              channelId: message.channelId,
              messageId: message.id,
              attachmentId: attachment.id,
            };
            let record = await store.find(source);
            if (record?.replyId) continue;
            if (!record) {
              const markdown = await download(
                attachment,
                config.maxFileBytes,
                config.downloadTimeoutMs
              );
              record = await store.save(source, markdown);
            }
            const button = new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel(
                `📄 ${record.filename.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 55)} をプレビュー`
              )
              .setURL(`${config.publicUrl}/preview/${record.id}`);
            const reply = await message.reply({
              components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(button),
              ],
              allowedMentions: { parse: [], repliedUser: false },
              nonce: createDiscordNonce(`markdown-preview:${record.id}`),
              enforceNonce: true,
            });
            await store.markReplied(record.id, reply.id);
          } catch {
            // URL・本文・例外内の署名付きURLをログへ出さない。
            console.warn(
              JSON.stringify({
                event: 'markdown_preview_failed',
                messageId: message.id,
                attachmentId: attachment.id,
              })
            );
          }
        }
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, job);
    queue = job.catch(() => undefined);
    return job;
  };
}
