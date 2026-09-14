/**
 * The express app, with no `listen` — so tests can drive the real HTTP
 * surface in-process (unit 19) while `index.ts` keeps owning the port.
 * Everything the server does lives here or in `routes.ts`; `index.ts` is
 * now only a bootstrap.
 */

import express from 'express';
import { router } from './routes.js';
import { webRouter, signinRedirect } from './web.js';

export const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // browser sign-in / admin forms (built in, no new dep)
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', router);
// P4 unit 8: the browser half — sign-in redirect first, then the pages it
// guards (join, sign-in, admin, and the placeholder root).
app.use(signinRedirect);
app.use(webRouter);
