/**
 * The board page (P4 unit 10) — the whole table rendered read-only from a
 * BoardModel. A dumb template: every decision about WHAT a seat may see was
 * made upstream in project() and boardModel(). The one thing this file must
 * never do is print a raw card id — the leak sweep runs over its output.
 *
 * Art is drawn through an injected resolver so the filesystem stays out of
 * the pure model. With no assets present (the repo today) every face is a
 * placeholder that still names the card.
 */

import { html, raw, type Raw } from '../html.js';
import { layout } from '../layout.js';
import type {
  BoardModel,
  FaceModel,
  SiteModel,
  PlayerAreaModel,
  AdviserModel,
} from '../model.js';
import { makeArtResolver, type ArtResolver } from '../art.js';

/** A single card face: an <img> when its asset is present, else a named placeholder box. */
function face(f: FaceModel, art: ArtResolver): Raw {
  const ref = art(f.artKey, f.name);
  if (ref.src) {
    return html`<img class="face" src="${ref.src}" alt="${ref.alt}"${dims(ref.width, ref.height)} loading="lazy">`;
  }
  return html`<span class="face placeholder" role="img" aria-label="${f.name}">${f.name}</span>`;
}

function dims(w?: number, h?: number): Raw {
  return raw(w && h ? ` width="${w}" height="${h}"` : '');
}

/** A facedown card back — carries NO identity, by construction. */
const back = (label = 'facedown'): Raw => html`<span class="face back" aria-label="${label}"></span>`;

function tokens(favor: number, secrets: number): Raw {
  const bits = [favor > 0 ? html`<span class="favor">${favor}⚑</span>` : null, secrets > 0 ? html`<span class="secrets">${secrets}◆</span>` : null].filter(Boolean);
  return bits.length ? html`<span class="tokens">${bits}</span>` : raw('');
}

function siteView(s: SiteModel, art: ArtResolver): Raw {
  return html`<article class="site${s.facedown ? ' facedown' : ''}">
    <h3>${s.name} ${tokens(s.favor, s.secrets)}</h3>
    <ul class="slots">
      ${s.cards.map((c) => {
        if (c === null) return html`<li class="slot empty"></li>`;
        if (c.kind === 'back') return html`<li class="slot">${back()} ${tokens(c.favor, c.secrets)}</li>`;
        return html`<li class="slot">${face(c.face, art)}${c.ruined ? html`<span class="ruined">ruined</span>` : ''} ${tokens(c.favor, c.secrets)}</li>`;
      })}
    </ul>
    ${s.relics.length
      ? html`<div class="relics">Relics: ${s.relics.map((r) => (r.kind === 'face' ? face(r.face, art) : back('facedown relic')))}</div>`
      : ''}
    ${s.warbands.length
      ? html`<div class="warbands">${s.warbands.map((w) => html`<span>seat ${w.seat}: ${w.count}</span>`)}</div>`
      : ''}
  </article>`;
}

function adviser(a: AdviserModel, art: ArtResolver): Raw {
  const card = a.kind === 'face' && a.face ? face(a.face, art) : back('facedown adviser');
  return html`<li class="adviser">${card} ${tokens(a.favor, a.secrets)}</li>`;
}

function playerArea(p: PlayerAreaModel, art: ArtResolver): Raw {
  const role = p.chancellor ? 'Chancellor' : p.citizen ? 'Citizen' : 'Exile';
  return html`<article class="player${p.isYou ? ' you' : ''}">
    <h3>
      <span class="pname">${p.name}</span>
      <span class="pmeta">seat ${p.seat} · ${role}${p.titles.map((t) => html` · ${t}`)}${p.isYou ? raw(' · <strong>you</strong>') : ''}</span>
    </h3>
    <dl class="stats">
      <div><dt>Favor</dt><dd>${p.favor}</dd></div>
      <div><dt>Secrets</dt><dd>${p.secretsReady} ready / ${p.secretsFlipped} flipped</dd></div>
      <div><dt>Warbands</dt><dd>${p.warbandsBoard} board / ${p.warbandsBank} bank</dd></div>
      <div><dt>Supply</dt><dd>${p.supply}</dd></div>
      <div><dt>Pawn</dt><dd>${p.pawnSite ?? 'unplaced'}</dd></div>
    </dl>
    ${p.vision ? html`<div class="vision">Vision: ${face(p.vision, art)}</div>` : ''}
    ${p.relics.length ? html`<div class="held-relics">Relics: ${p.relics.map((r) => face(r, art))}</div>` : ''}
    ${p.advisers.length
      ? html`<ul class="advisers">${p.advisers.map((a) => adviser(a, art))}</ul>`
      : html`<p class="advisers empty">No advisers.</p>`}
  </article>`;
}

export function boardPage(model: BoardModel, opts?: { art?: ArtResolver }): string {
  const art = opts?.art ?? makeArtResolver();
  const title = model.spectator ? 'Board (spectator) — Oath' : 'Board — Oath';

  const status = model.complete
    ? html`<p class="status done">Game over — winner: ${model.winner === null ? 'a tie' : `seat ${model.winner}`}.</p>`
    : html`<p class="status">Round ${model.round} · seat ${model.activeSeat} to act · ${model.oathLabel} · Visions drawn: ${model.visionsDrawn}</p>`;

  const campaign = model.campaign
    ? html`<section class="campaign"><h2>Campaign in progress</h2>
        <p>seat ${model.campaign.attacker} attacks ${model.campaign.defender} — ${model.campaign.attackDice} attack / ${model.campaign.defenseDice} defense dice.</p>
        <p>Targets: ${model.campaign.targets.join(', ')}</p></section>`
    : raw('');

  const pending = [
    model.citizenshipOffer
      ? html`<li>Citizenship offer: the Scepter holder (seat ${model.citizenshipOffer.scepterSeat}) → seat ${model.citizenshipOffer.exile}.</li>`
      : null,
    model.warbandRequest
      ? html`<li>Warband request: seat ${model.warbandRequest.seat} awaits seat ${model.warbandRequest.approver} (${model.warbandRequest.direction}, ${model.warbandRequest.count}).</li>`
      : null,
  ].filter(Boolean);

  return layout({
    title,
    seat: model.spectator ? undefined : (model.seat as number),
    gameId: model.gameId,
    body: html`
      <h1>The table</h1>
      ${status}
      ${model.spectator ? html`<p class="spectator-note">You are watching as a spectator.</p>` : ''}
      ${campaign}
      ${pending.length ? html`<section class="pending"><h2>Awaiting a decision</h2><ul>${pending}</ul></section>` : ''}

      <section class="regions">
        ${model.regions.map(
          (r) => html`<section class="region"><h2>${r.label}</h2>
            <div class="site-grid">${r.sites.map((s) => siteView(s, art))}</div></section>`,
        )}
      </section>

      <section class="players"><h2>Players</h2>
        <div class="player-grid">${model.players.map((p) => playerArea(p, art))}</div>
      </section>

      <section class="supply"><h2>Banks & supply</h2>
        <ul class="banks">
          ${model.favorBanks.map((b) => html`<li>${b.label}: ${b.favor}⚑</li>`)}
          <li>Shared bank: ${model.sharedBank.favor}⚑ / ${model.sharedBank.secrets}◆</li>
          <li>Relic deck: ${model.relicDeckCount}</li>
        </ul>
        <h3>Banners</h3>
        <ul class="banners">
          ${model.banners.map(
            (b) =>
              html`<li>${b.name}: ${b.holder === null ? 'unheld' : `seat ${b.holder}`} · ${b.tokens} tokens${b.mob ? ' · Mob side' : ''}</li>`,
          )}
        </ul>
        <h3>Reliquary</h3>
        <ul class="reliquary">
          ${model.reliquary.map(
            (sp) =>
              html`<li>${sp.label}: ${sp.relic ? face(sp.relic, art) : sp.covered ? back('facedown relic') : 'empty'}</li>`,
          )}
        </ul>
      </section>

      <nav class="page-nav">
        <a href="${model.inboxUrl}">Inbox</a>
        <a href="${model.historyUrl}">History</a>
      </nav>
    `,
  });
}
