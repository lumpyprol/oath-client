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
import { makeArtResolver, artUrl, type ArtResolver } from '../art.js';
import { DENIZEN_BACK_FILE } from '../../oath/cards/art.js';

const BOARD_COLORS = ['red', 'blue', 'yellow', 'white', 'black'];
/** The player-board image for a seat's role and colour (purple has none → red). */
function playerBoardFile(p: PlayerAreaModel): string {
  if (p.chancellor) return 'player_board_chancellor.png';
  const color = BOARD_COLORS.includes(p.color) ? p.color : 'red';
  return `player_board_${color}_${p.citizen ? 'citizen' : 'exile'}.png`;
}
/** A wooden warband token in a seat's colour. */
const warbandTok = (color: string): Raw =>
  html`<img class="tok-img wb-tok" src="${artUrl(`warband ${color}.png`)}" alt="">`;

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

/**
 * Where each region's site slots sit on full_board.png, as the top-left
 * corner in percent of the board image. Only the position lives here — the
 * card SIZE is in the CSS (`.bsite`), sized to fully cover the printed slot
 * (12.3% x 23.6% of the board) while holding the card's real aspect, so the
 * site card hides the yellow outline and site↔denizen scale stays 1:1 (a
 * denizen is the same height, its own width). The board has 2 Cradle slots
 * and 3 each for Provinces and Hinterland — the 2/3/3 the engine lays out.
 * Measured off the clean board against a percentage grid.
 */
const SITE_SLOTS: Record<string, { x: number; y: number }[]> = {
  cradle: [
    { x: 0.6, y: 18.4 },
    { x: 0.6, y: 42.4 },
  ],
  provinces: [
    { x: 33.1, y: 18.9 },
    { x: 33.1, y: 42.9 },
    { x: 32.9, y: 66.2 },
  ],
  hinterland: [
    { x: 67.1, y: 18.0 },
    { x: 67.1, y: 42.4 },
    { x: 67.1, y: 64.8 },
  ],
};

/** One site placed on its board slot: the site card, its denizens beside it, tokens. */
function boardSite(s: SiteModel, slot: { x: number; y: number }, art: ArtResolver, siteBackUrl?: string): Raw {
  const cardFace = s.face
    ? face(s.face, art)
    : siteBackUrl
      ? html`<img class="face site-back" src="${siteBackUrl}" alt="Facedown site">`
      : back('unrevealed site');
  const denizens = s.cards.filter((c) => c !== null) as Exclude<SiteModel['cards'][number], null>[];
  const style = `left:${slot.x}%;top:${slot.y}%`;
  return html`<div class="bsite" style="${raw(style)}">
    <div class="bsite-card">${cardFace}
      ${s.face || siteBackUrl ? '' : html`<span class="bsite-name">${s.name}</span>`}
      ${s.favor || s.secrets ? html`<span class="bsite-tokens">${tokens(s.favor, s.secrets)}</span>` : ''}
    </div>
    ${denizens.length || s.relics.length
      ? html`<div class="bsite-cards">
          ${denizens.map((c) =>
            c.kind === 'face'
              ? html`<span class="bcard">${face(c.face, art)}${c.ruined ? html`<span class="ruined">R</span>` : ''}${c.favor || c.secrets ? html`<span class="bcard-tok">${tokens(c.favor, c.secrets)}</span>` : ''}</span>`
              : html`<span class="bcard"><img class="face card-back" src="${artUrl(DENIZEN_BACK_FILE)}" alt="Facedown denizen">${c.favor || c.secrets ? html`<span class="bcard-tok">${tokens(c.favor, c.secrets)}</span>` : ''}</span>`,
          )}
          ${s.relics.map((r) => html`<span class="bcard relic">${r.kind === 'face' ? face(r.face, art) : back('facedown relic')}</span>`)}
        </div>`
      : ''}
    ${s.pawns.length || s.warbands.length
      ? html`<div class="bsite-pieces">
          ${s.pawns.map((p) => html`<img class="pawn-tok" src="${artUrl(`player ${p.color}.png`)}" alt="seat ${p.seat} pawn">`)}
          ${s.warbands.map(
            (w) => html`<span class="wb-at" title="seat ${w.seat}">${warbandTok(w.color)}<span class="wb-n">${w.count}</span></span>`,
          )}
        </div>`
      : ''}
  </div>`;
}

/** The single board: the map image with every site (and its denizens) placed on it. */
function boardMap(model: BoardModel, art: ArtResolver, boardImageUrl: string, siteBackUrl?: string): Raw {
  const sites = model.regions.flatMap((r) => {
    const slots = SITE_SLOTS[r.region] ?? [];
    return r.sites.map((s, i) => (slots[i] ? boardSite(s, slots[i], art, siteBackUrl) : raw('')));
  });
  return html`<div class="board-map">
    <img class="board-base" src="${boardImageUrl}" alt="The Oath board">
    <div class="board-overlay">${sites}</div>
  </div>`;
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

/** One adviser beside a player board: its face if known, else the denizen back. */
function adviser(a: AdviserModel, art: ArtResolver): Raw {
  const card =
    a.kind === 'face' && a.face
      ? face(a.face, art)
      : html`<img class="card-back" src="${artUrl(DENIZEN_BACK_FILE)}" alt="Facedown adviser">`;
  return html`<li class="adviser">${card}${a.favor || a.secrets ? tokens(a.favor, a.secrets) : ''}</li>`;
}

/** A favor "coin" and a secret token, as compact labelled chips. */
function favorChip(n: number): Raw {
  return html`<span class="tok favor" title="Favor"><span class="coin"></span>${n}</span>`;
}
function secretChip(ready: number, flipped: number): Raw {
  return html`<span class="tok secret" title="Secrets ready / flipped"
    ><img class="tok-img" src="${artUrl('secret.png')}" alt="">${ready}${flipped ? html`<span class="flip">+${flipped}</span>` : ''}</span>`;
}

function playerArea(p: PlayerAreaModel, art: ArtResolver): Raw {
  const role = p.chancellor ? 'Chancellor' : p.citizen ? 'Citizen' : 'Exile';
  const cls = `pboard${p.isYou ? ' you' : ''}${p.active ? ' active' : ''}`;
  return html`<article class="${cls}" data-color="${p.color}">
    <div class="pb-head">
      <span class="pname">${p.name}</span>
      <span class="pmeta">seat ${p.seat} · ${role}${p.titles.map((t) => html` · ${t}`)}${p.isYou ? raw(' · <strong>you</strong>') : ''}${p.active ? raw(' · <span class="on-clock">on the clock</span>') : ''}</span>
      <span class="pb-stats">
        ${favorChip(p.favor)}
        ${secretChip(p.secretsReady, p.secretsFlipped)}
        <span class="tok wb" title="Warbands (bank)">${warbandTok(p.color)}${p.warbandsBank}</span>
        <span class="tok supply" title="Supply">S ${p.supply}</span>
        <span class="tok pawn" title="Pawn">⚑ ${p.pawnSite ?? 'unplaced'}</span>
      </span>
    </div>
    <div class="pb-main">
      <div class="pb-frame">
        <img class="pb-bg" src="${artUrl(playerBoardFile(p))}" alt="${role} board">
        ${p.vision ? html`<div class="pb-vision">${face(p.vision, art)}</div>` : ''}
        <ul class="advisers pb-side-advisers" title="Advisers">
          ${p.advisers.map((a) => adviser(a, art))}
        </ul>
      </div>
    </div>
    ${p.relics.length ? html`<div class="held-relics" title="Relics">${p.relics.map((r) => face(r, art))}</div>` : ''}
  </article>`;
}

export function boardPage(
  model: BoardModel,
  opts?: { art?: ArtResolver; boardImageUrl?: string; siteBackUrl?: string },
): string {
  const art = opts?.art ?? makeArtResolver();
  const title = model.spectator ? 'Board (spectator) — Oath' : 'Board — Oath';

  // With the board image, the map IS the board — sites are placed on it. Only
  // when there is no image do we fall back to the plain region listing, so the
  // two are never shown at once (no duplicate table).
  const table = opts?.boardImageUrl
    ? boardMap(model, art, opts.boardImageUrl, opts.siteBackUrl)
    : html`<section class="regions">
        ${model.regions.map(
          (r) => html`<section class="region"><h2>${r.label}</h2>
            <div class="site-grid">${r.sites.map((s) => siteView(s, art))}</div></section>`,
        )}
      </section>`;

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
    bodyClass: 'board',
    body: html`
      <h1>The table</h1>
      ${status}
      ${model.spectator ? html`<p class="spectator-note">You are watching as a spectator.</p>` : ''}
      ${campaign}
      ${pending.length ? html`<section class="pending"><h2>Awaiting a decision</h2><ul>${pending}</ul></section>` : ''}

      ${table}

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
