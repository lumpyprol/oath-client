/**
 * The inbox page (P4 unit 9) — the landing view and the one page the phone
 * exit criterion names. A dumb template over `InboxModel`: what is waiting
 * on ME (oldest first, each linking to its decision), then what the game is
 * waiting on from others (so a player sees why nothing is moving), then
 * links to the board and history.
 */

import { html, raw } from '../html.js';
import { layout } from '../layout.js';
import type { InboxModel } from '../model.js';

export function inboxPage(model: InboxModel, meta: { seat: number; gameId: string }): string {
  const yours = model.empty
    ? html`<p class="empty">Nothing is waiting on you.</p>`
    : html`<ul class="inbox">
        ${model.waitingOnYou.map(
          (e) => html`<li>
            <a href="${e.url}">${e.prompt}</a>
            <span class="age">${e.age}</span>
          </li>`,
        )}
      </ul>`;

  const others =
    model.waitingOnOthers.length === 0
      ? raw('')
      : html`<section class="others">
          <h2>Waiting on others</h2>
          <ul>
            ${model.waitingOnOthers.map((o) => html`<li>seat ${o.seat} — ${o.label}</li>`)}
          </ul>
        </section>`;

  return layout({
    title: 'Your inbox — Oath',
    seat: meta.seat,
    gameId: meta.gameId,
    body: html`
      <section class="yours">
        <h1>Waiting on you</h1>
        ${yours}
      </section>
      ${others}
      <nav class="page-nav">
        <a href="${model.boardUrl}">Board</a>
        <a href="${model.historyUrl}">History</a>
      </nav>
    `,
  });
}
