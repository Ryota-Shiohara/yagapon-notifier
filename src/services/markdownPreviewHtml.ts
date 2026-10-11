import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { MarkdownRecord } from './markdownPreviewStore';

const markdown = new MarkdownIt({ html: false, linkify: false });
const escape = (text: string) => markdown.utils.escapeHtml(text);
// 外部画像による閲覧者追跡を避け、代替テキストのみ表示する。
markdown.renderer.rules.image = (tokens, index) =>
  escape(tokens[index].content);
const css = `
:root{color-scheme:light dark;--bg:#fff;--text:#1f2328;--muted:#59636e;--border:#d1d9e0;--surface:#f6f8fa;--link:#0969da}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:900px;margin:32px auto;padding:32px;border:1px solid var(--border);border-radius:8px;min-width:0}
header{border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:24px}header h1{font-size:20px;margin:0;overflow-wrap:anywhere}
header p,footer{color:var(--muted);font-size:14px}header p{margin:8px 0 0}article{overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{line-height:1.3;margin:24px 0 16px}article h1{font-size:2em}h2{font-size:1.5em}
article h1,h2{padding-bottom:8px;border-bottom:1px solid var(--border)}p,ul,ol,blockquote,pre{margin:0 0 16px}
li+li{margin-top:4px}blockquote{margin-left:0;padding:0 16px;color:var(--muted);border-left:4px solid var(--border)}
a{color:var(--link);text-decoration:underline;text-underline-offset:3px}a:hover{opacity:.8}a:focus-visible{outline:3px solid var(--link);outline-offset:3px}
pre{padding:16px;background:var(--surface);border-radius:6px;overflow:auto;overflow-wrap:normal}code{font:85%/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--surface);padding:2px 5px;border-radius:4px}pre code{padding:0}
table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;margin:0 0 16px}th,td{padding:8px 13px;border:1px solid var(--border)}tr:nth-child(2n){background:var(--surface)}
hr{border:0;border-top:1px solid var(--border);margin:24px 0}footer{border-top:1px solid var(--border);padding-top:16px;margin-top:32px}
@media(max-width:600px){main{margin:0;border:0;border-radius:0;padding:20px 16px}article h1{font-size:1.75em}}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--text:#f0f6fc;--muted:#b1bac4;--border:#3d444d;--surface:#151b23;--link:#79c0ff}}
`;
const styleHash = createHash('sha256').update(css).digest('base64');
export const previewCsp = `default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-popups allow-popups-to-escape-sandbox`;

export function renderMarkdownPreview(record: MarkdownRecord): string {
  const body = sanitizeHtml(markdown.render(record.markdown), {
    allowedTags: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'strong',
      'em',
      's',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: { a: ['href', 'title', 'rel'], ol: ['start'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => {
        const href = attrs.href || '';
        // 相対URLは元添付のディレクトリを再現できないためリンクにしない。
        const allowed =
          /^(https?:\/\/|mailto:)/i.test(href) &&
          !/^https?:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//i.test(
            href
          );
        return {
          tagName: 'a',
          attribs: {
            ...(allowed ? { href } : {}),
            ...(attrs.title ? { title: attrs.title } : {}),
            rel: 'noreferrer noopener',
          },
        };
      },
    },
  });
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(record.filename)} — Markdownプレビュー</title><style>${css}</style></head><body><main><header><h1>${escape(record.filename)}</h1><p>Markdownプレビュー · 読み取り専用</p></header><article>${body}</article><footer>このページはURLを知っている人が閲覧できます。<br>有効期限: ${escape(new Date(record.expiresAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))} (日本時間)</footer></main></body></html>`;
}
