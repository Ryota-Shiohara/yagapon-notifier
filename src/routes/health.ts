/**
 * ヘルスチェックエンドポイント (Docker用)
 */

import { Request, Response, Router } from 'express';

export function createHealthRouter(getBotReadyStatus: () => boolean): Router {
  const router = Router();

  router.get('/health', (req: Request, res: Response) => {
    if (getBotReadyStatus()) {
      res.status(200).send({ status: 'ok', bot: 'ready' });
    } else {
      res.status(503).send({ status: 'unavailable', bot: 'not ready' });
    }
  });

  return router;
}
