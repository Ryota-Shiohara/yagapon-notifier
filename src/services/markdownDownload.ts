/** Discord CDN以外へ接続せず、圧縮展開後の本文にもサイズ制限を適用する。 */
export async function downloadMarkdown(
  attachment: { url: string; size: number },
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch
): Promise<string> {
  if (
    !Number.isSafeInteger(attachment.size) ||
    attachment.size < 0 ||
    attachment.size > maxBytes
  ) {
    throw new Error('file_too_large');
  }
  const url = new URL(attachment.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) ||
    !url.pathname.startsWith('/attachments/')
  ) {
    throw new Error('invalid_attachment_url');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error('download_failed');
    const length = Number(response.headers.get('content-length'));
    if (length > maxBytes) throw new Error('file_too_large');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('file_too_large');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks)
    );
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    clearTimeout(timer);
  }
}
