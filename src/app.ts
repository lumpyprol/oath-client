/**
 * The express app, with no `listen` — so tests can drive the real HTTP
 * surface in-process (unit 19) while `index.ts` keeps owning the port.
 * Everything the server does lives here or in `routes.ts`; `index.ts` is
 * now only a bootstrap.
 */

import express from 'express';
import { router } from './routes.js';

export const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', router);
