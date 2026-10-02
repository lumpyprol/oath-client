/**
 * How the table names a seat (P4 unit 11): by its pieces' colour and role —
 * "Chancellor", "Yellow Exile", "Blue Citizen" — never a seat number, which
 * no one at a real table uses. Derived from public state only (who is the
 * Chancellor, who is a Citizen), so it is safe in any label or view.
 *
 * Colours: the Chancellor is purple; every other seat takes an Exile colour
 * in seat order. A Citizen keeps the colour it had as an Exile, so a seat's
 * colour never changes as roles do — only the role word does.
 */

import { EXILE_COLORS } from '../cards/art.js';

/** Each seat's wooden-piece colour, in seat order. */
export function seatColors(players: readonly { citizenship: string }[]): string[] {
  let ex = 0;
  return players.map((p) => (p.citizenship === 'chancellor' ? 'purple' : EXILE_COLORS[ex++] ?? 'red'));
}

/** "Chancellor", or "<Colour> Citizen" / "<Colour> Exile". */
export function seatTitle(players: readonly { citizenship: string }[], seat: number): string {
  const p = players[seat];
  if (!p) return `seat ${seat}`;
  if (p.citizenship === 'chancellor') return 'Chancellor';
  const color = seatColors(players)[seat];
  return `${color[0].toUpperCase()}${color.slice(1)} ${p.citizenship === 'citizen' ? 'Citizen' : 'Exile'}`;
}
