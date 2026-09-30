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

/**
 * Die faces (Law §5.5.4/§5.5.5, Playbook "Dice Faces" p.15) to their art.
 * The attack die's 'skull' face is the one that also shows a sword — it
 * counts a sword AND kills one of the attacker's own warbands.
 */
const DIE_FACE_ART: Record<string, string> = {
  sword: 'sword.png',
  hollowSword: 'swordx05.png',
  skull: 'swordx2.png',
  shield: 'shield.png',
  doubleShield: 'shield2.png',
  shieldX2: 'shieldx2.png',
};
const DIE_FACE_LABEL: Record<string, string> = {
  sword: 'sword',
  hollowSword: 'hollow sword (two count as one)',
  skull: 'skull (a sword, and kills one of your own warbands)',
  shield: 'shield',
  doubleShield: 'two shields',
  shieldX2: 'shields doubled',
  blank: 'blank',
};

/** One rolled die. A blank defense face has no art — it is a blank side. */
function die(faceName: string): Raw {
  const file = DIE_FACE_ART[faceName];
  const label = DIE_FACE_LABEL[faceName] ?? faceName;
  return file
    ? html`<img class="die" src="${artUrl(file)}" alt="${label}" title="${label}">`
    : html`<span class="die blank" role="img" aria-label="${label}" title="${label}"></span>`;
}

/** The pawn art for a seat colour — the Chancellor (purple) has its own piece. */
const pawnFile = (color: string): string => (color === 'purple' ? 'chancellor.png' : `player ${color}.png`);

/**
 * Where the supply marker sits on the board's supply track, as % from the
 * board's left. Approximate: the numbered cells run along the lower-left, high
 * supply toward the left; the exact per-board cell ranges differ, so this is a
 * best-effort placement (the "S n" chip carries the precise number).
 */
const supplyMarkerX = (supply: number): number => 36 - (Math.min(Math.max(supply, 0), 13) / 13) * 26;

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

/** The gold favor coin, and the secret token — the real component art. */
const favorTok = raw(`<img class="tok-img favor-coin" src="${artUrl('favour.png')}" alt="favor">`);
const secretTok = raw(`<img class="tok-img secret-tok" src="${artUrl('secret.png')}" alt="secret">`);

function tokens(favor: number, secrets: number): Raw {
  const bits = [
    favor > 0 ? html`<span class="favor">${favorTok}${favor}</span>` : null,
    secrets > 0 ? html`<span class="secrets">${secretTok}${secrets}</span>` : null,
  ].filter(Boolean);
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
          ${s.pawns.map((p) => html`<img class="pawn-tok" src="${artUrl(pawnFile(p.color))}" alt="seat ${p.seat} pawn">`)}
          ${s.warbands.map(
            (w) => html`<span class="wb-at" title="seat ${w.seat}">${warbandTok(w.color)}<span class="wb-n">${w.count}</span></span>`,
          )}
        </div>`
      : ''}
  </div>`;
}

/**
 * Board furniture positions, in percent of the board image (measured off the
 * clean mat). The favor banks are keyed by suit because the map's order
 * (Discord, Arcane, Order, Hearth, Beast, Nomad) is not the engine's.
 */
const BANK_POS: Record<string, { x: number; y: number }> = {
  discord: { x: 42.3, y: 93.0 },
  arcane: { x: 49.2, y: 93.0 },
  order: { x: 56.1, y: 93.0 },
  hearth: { x: 63.0, y: 93.0 },
  beast: { x: 69.9, y: 93.0 },
  nomad: { x: 76.8, y: 93.0 },
};

/**
 * The round wheel, bottom-left. Eight slices; the marker advances clockwise
 * one space a round (Law §4). Geometry measured off the clean mat: the
 * dotted dividers fall on multiples of 45° from 12 o'clock, so slice CENTRES
 * are at 22.5° + k·45°, and round 1 is the slice the printed star token sits
 * in. The three Stable-Regime dice sit ON the dividers after slices 5, 6 and
 * 7 — exactly the ends of rounds 5/6/7 that Law §3.3 makes you roll for,
 * which is what pins this mapping.
 */
const WHEEL = { cx: 6.88, cy: 82.72, rx: 5.12, ry: 12.7, at: 0.62 };
function roundPos(round: number): { x: number; y: number } {
  const th = ((22.5 + ((round - 1) % 8) * 45) * Math.PI) / 180;
  return {
    x: WHEEL.cx + Math.sin(th) * WHEEL.rx * WHEEL.at,
    y: WHEEL.cy - Math.cos(th) * WHEEL.ry * WHEEL.at,
  };
}

/** Centres of the six Visions-Drawn boxes (0..5), measured off the clean mat. */
const VISION_BOX_X = [15.16, 18.51, 20.54, 23.56, 25.61, 27.66];
const VISION_BOX_Y = 76.2;

/**
 * The two deck spaces and the three regional discard piles, in board %.
 * Measured off the clean mat by finding each box's printed rules: every
 * discard box is 8.96% of the board wide — within a whisker of a denizen card
 * laid on its side (9.06%) — which is why the discards render rotated, at
 * true card scale, rather than upright.
 */
const RELIC_DECK_POS = { x: 18.98, y: 90.53 };
const WORLD_DECK_POS = { x: 24.7, y: 90.51 }; // left of the box's printed draw-cost legend
const DISCARD_POS: Record<string, { x: number; y: number }> = {
  cradle: { x: 21.97, y: 11.33 },
  provinces: { x: 54.98, y: 10.84 },
  hinterland: { x: 88.32, y: 10.84 },
};

/** A facedown pile on the map: a card back, with its size where the Law makes it public. */
function pile(
  pos: { x: number; y: number },
  file: string,
  label: string,
  count: number | null,
  cls: string,
): Raw {
  return html`<div class="map-pile ${cls}" style="left:${pos.x}%;top:${pos.y}%" title="${label}">
    <img src="${artUrl(file)}" alt="${label}">
    ${count === null ? '' : html`<span class="pile-n">${count}</span>`}
  </div>`;
}

/** Trackers laid on the map: favor on the banks, the round wheel, visions drawn. */
function boardFurniture(m: BoardModel): Raw {
  const banks = m.favorBanks.map((b) => {
    const p = BANK_POS[b.suit];
    return p
      ? html`<div class="bank-fav" style="left:${p.x}%;top:${p.y}%" title="${b.label} bank: ${b.favor} favor">${b.favor}</div>`
      : raw('');
  });
  const rp = roundPos(m.round);
  const round = html`<img class="round-marker" src="${artUrl('turn marker.png')}"
    style="left:${rp.x}%;top:${rp.y}%" alt="Round ${m.round}" title="Round ${m.round}">`;
  const vx = VISION_BOX_X[Math.min(Math.max(m.visionsDrawn, 0), 5)] ?? VISION_BOX_X[0];
  const visions = html`<img class="vision-marker" src="${artUrl('Vision marker.png')}" style="left:${vx}%;top:${VISION_BOX_Y}%" alt="Visions drawn: ${m.visionsDrawn}">`;

  // The world deck shows a back and NO size: Law §9.4 makes the number of
  // cards in it private, and it is the one zone whose count never appears
  // (project() omits it entirely). Every other pile's size is public.
  const worldDeck = pile(WORLD_DECK_POS, DENIZEN_BACK_FILE, 'World deck', null, 'world-deck');
  const relicDeck = pile(RELIC_DECK_POS, 'relicBack.png', `Relic deck: ${m.relicDeckCount}`, m.relicDeckCount, 'relic-deck');
  const discards = m.discardCounts.map((dc) => {
    const p = DISCARD_POS[dc.region];
    return p && dc.count > 0
      ? pile(p, DENIZEN_BACK_FILE, `${dc.label} discard: ${dc.count}`, dc.count, 'discard')
      : raw('');
  });
  return html`${banks}${round}${visions}${worldDeck}${relicDeck}${discards}`;
}

/** The single board: the map image with every site (and its denizens) placed on it. */
function boardMap(model: BoardModel, art: ArtResolver, boardImageUrl: string, siteBackUrl?: string): Raw {
  const sites = model.regions.flatMap((r) => {
    const slots = SITE_SLOTS[r.region] ?? [];
    return r.sites.map((s, i) => (slots[i] ? boardSite(s, slots[i], art, siteBackUrl) : raw('')));
  });
  return html`<div class="board-map">
    <img class="board-base" src="${boardImageUrl}" alt="The Oath board">
    <div class="board-overlay">${sites}${boardFurniture(model)}</div>
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

/** A favor coin and a secret token, as compact labelled chips. */
function favorChip(n: number): Raw {
  return html`<span class="tok favor" title="Favor">${favorTok}${n}</span>`;
}
function secretChip(ready: number, flipped: number): Raw {
  return html`<span class="tok secret" title="Secrets ready / flipped"
    >${secretTok}${ready}${flipped ? html`<span class="flip">+${flipped}</span>` : ''}</span>`;
}

/**
 * The Imperial Reliquary placard (Law §2.3), rendered under the Chancellor's
 * board because it is theirs. Its four named spaces are printed in a 2x2 grid
 * — positions are percentages of the placard art, and a relic is square
 * (326x326), exactly the size of a space. A covered space shows a relic back
 * (or the relic's face to a seat that has peeked it, Law §6.4); an uncovered
 * one shows its modifier, which is the Chancellor's to use (§6.6.2).
 */
const RELIQUARY_SPACE_POS = [
  { x: 25.5, y: 29.5 }, // brutal
  { x: 74.5, y: 29.5 }, // decadent
  { x: 25.5, y: 67.5 }, // careless
  { x: 74.5, y: 67.5 }, // greedy
];

function reliquaryBoard(model: BoardModel, art: ArtResolver): Raw {
  return html`<div class="reliquary-board" title="Imperial Reliquary">
    <img class="rq-bg" src="${artUrl('Imperial Reliquary_front.png')}" alt="Imperial Reliquary">
    ${model.reliquary.map((sp, i) => {
      const pos = RELIQUARY_SPACE_POS[i];
      if (!pos) return raw('');
      const style = `left:${pos.x}%;top:${pos.y}%`;
      if (sp.relic) {
        return html`<div class="rq-slot" style="${raw(style)}" title="${sp.label}: ${sp.relic.name}">${face(sp.relic, art)}</div>`;
      }
      if (sp.covered) {
        return html`<div class="rq-slot" style="${raw(style)}" title="${sp.label}: a facedown relic"><img src="${artUrl('relicBack.png')}" alt="Facedown relic"></div>`;
      }
      return html`<div class="rq-slot open" style="${raw(style)}" title="${sp.label}: uncovered — the Chancellor may use this modifier"></div>`;
    })}
  </div>`;
}

/**
 * Placards are rendered at TRUE scale against the player board, so a banner
 * beside a board is the size it would be on the table. Widths are the art's
 * own pixels over the player board's 1011px width.
 */
const PLACARD_W = {
  banner: (652 / 1011) * 100,
  title: (542 / 1011) * 100,
  scepter: (326 / 1011) * 100,
};

/** One banner placard, with the favor/secrets sitting on it (Law §2.5). */
function bannerPlacard(b: BoardModel['banners'][number], art: ArtResolver): Raw {
  return html`<figure class="placard" style="width:${PLACARD_W.banner}%">
    <div class="tf-art">${face(b.face, art)}
      <span class="tf-count" title="tokens on this banner">${b.tokens}</span>
    </div>
    <figcaption>${b.name}${b.mob ? ' (Mob side)' : ''}</figcaption>
  </figure>`;
}

/**
 * What this seat holds on the table beside their board: any banners, the
 * Oathkeeper/Usurper title, and the Grand Scepter. Rendered under their own
 * board rather than in a shared pile, because that is where they sit in play.
 */
function ownedPlacards(m: BoardModel, seat: number, art: ArtResolver): Raw {
  const mine = m.banners.filter((b) => b.holder === seat);
  const isKeeper = m.oathkeeper === seat;
  const hasScepter = m.grandScepter === seat;
  if (!mine.length && !isKeeper && !hasScepter) return raw('');
  return html`<div class="pb-placards">
    ${mine.map((b) => bannerPlacard(b, art))}
    ${isKeeper
      ? html`<figure class="placard" style="width:${PLACARD_W.title}%">
          <div class="tf-art"><img src="${artUrl(m.usurper ? 'oathkeeperback.png' : 'oathkeeperfront.png')}" alt="${m.usurper ? 'Usurper' : 'Oathkeeper'} title"></div>
          <figcaption>${m.usurper ? 'Usurper' : 'Oathkeeper'}</figcaption>
        </figure>`
      : ''}
    ${hasScepter
      ? html`<figure class="placard" style="width:${PLACARD_W.scepter}%">
          <div class="tf-art"><img src="${artUrl('The Grand Scepter.png')}" alt="The Grand Scepter"></div>
          <figcaption>Grand Scepter</figcaption>
        </figure>`
      : ''}
  </div>`;
}

/** Banners nobody holds — they sit by the shared bank until someone takes one. */
function tableFurniture(m: BoardModel, art: ArtResolver): Raw {
  const unheld = m.banners.filter((b) => b.holder === null);
  if (!unheld.length) return raw('');
  return html`<section class="table-furniture"><h2>Unclaimed banners</h2>
    <div class="tf-row">${unheld.map((b) => bannerPlacard(b, art))}</div>
  </section>`;
}

function playerArea(p: PlayerAreaModel, art: ArtResolver, model?: BoardModel): Raw {
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
        <img class="pb-supply-marker" src="${artUrl(`supply ${p.color} shadow.png`)}"
          style="left:${supplyMarkerX(p.supply)}%" alt="Supply ${p.supply}" title="Supply ${p.supply}">
        <ul class="advisers pb-side-advisers" title="Advisers">
          ${p.advisers.map((a) => adviser(a, art))}
        </ul>
      </div>
    </div>
    ${/* The Chancellor's Reliquary sits directly under their board; their
         banners and title go below it. Every other seat's placards follow
         their board immediately, since only the Chancellor has a Reliquary. */ ''}
    ${p.chancellor && model ? reliquaryBoard(model, art) : ''}
    ${model ? ownedPlacards(model, p.seat, art) : ''}
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

  const c = model.campaign;
  const campaign = c
    ? html`<section class="campaign"><h2>Campaign in progress</h2>
        <p>seat ${c.attacker} attacks ${c.defender} — ${c.attackDice} attack / ${c.defenseDice} defense dice. <span class="phase">(${c.phase})</span></p>
        <p>Targets: ${c.targets.join(', ')}</p>
        ${c.attackFaces.length || c.defenseFaces.length
          ? html`<div class="dice-rows">
              <div class="dice-row"><span class="dice-label">Attack</span>
                <span class="dice">${c.attackFaces.map((f) => die(f))}</span>
                ${c.totals
                  ? html`<span class="dice-total">${c.totals.swords} sword${c.totals.swords === 1 ? '' : 's'}${c.totals.skulls ? html` · ${c.totals.skulls} skull${c.totals.skulls === 1 ? '' : 's'}` : ''}</span>`
                  : ''}
              </div>
              <div class="dice-row"><span class="dice-label">Defense</span>
                <span class="dice">${c.defenseFaces.map((f) => die(f))}</span>
                ${c.totals ? html`<span class="dice-total">${c.totals.shields} from shields (+ the defending force)</span>` : ''}
              </div>
            </div>`
          : html`<p class="muted">Dice are not rolled yet.</p>`}
        ${c.casualtyQuota !== null
          ? html`<p class="casualties">Casualties to allocate: <strong>${c.casualtyQuota}</strong> warband${c.casualtyQuota === 1 ? '' : 's'} (Law §5.5.6).</p>`
          : ''}
      </section>`
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
        <div class="player-grid">${model.players.map((p) => playerArea(p, art, model))}</div>
      </section>

      ${tableFurniture(model, art)}

      <section class="supply"><h2>Banks & supply</h2>
        <ul class="banks">
          ${model.favorBanks.map((b) => html`<li>${b.label}: ${b.favor}${favorTok}</li>`)}
          <li>Shared bank: ${model.sharedBank.favor}${favorTok} / ${model.sharedBank.secrets}${secretTok}</li>
          <li>Relic deck: ${model.relicDeckCount}</li>
          <li>Discards: ${model.discardCounts.map((d) => `${d.label} ${d.count}`).join(' · ')}</li>
          <li>Dispossessed: ${model.dispossessedCount}</li>
        </ul>
      </section>

      <nav class="page-nav">
        <a href="${model.inboxUrl}">Inbox</a>
        <a href="${model.historyUrl}">History</a>
      </nav>
    `,
  });
}
