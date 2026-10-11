import { Router } from 'express';
import { MarkdownPreviewStore } from '../services/markdownPreviewStore';
import {
  previewCsp,
  renderMarkdownPreview,
} from '../services/markdownPreviewHtml';

export function createMarkdownPreviewRouter(
  store: MarkdownPreviewStore
): Router {
  const router = Router();
  router.get('/preview/:id', async (req, res) => {
    res.set({
      'Content-Security-Policy': previewCsp,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Cache-Control': 'no-store',
    });
    try {
      const result = await store.get(req.params.id);
      if (result.status !== 'found') {
        res
          .status(result.status === 'expired' ? 410 : 404)
          .type('text/plain')
          .send('プレビューが見つからないか、有効期限が切れています。');
        return;
      }
      res.type('html').send(renderMarkdownPreview(result.record));
    } catch {
      console.error(JSON.stringify({ event: 'markdown_preview_read_failed' }));
      res
        .status(503)
        .type('text/plain')
        .send('プレビューを読み込めませんでした。');
    }
  });
  return router;
}
