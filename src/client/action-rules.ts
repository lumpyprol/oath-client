/**
 * The rule behind each action (unit 11): a one-line reminder in OUR words,
 * plus the Law section and a link to its full text on the Buried Giant rules
 * library. The rules text itself is Leder Games' — so it is linked, not
 * copied in. A test checks every submittable action type has an entry.
 *
 * Reminders only, never logic: the engine enforces the rule; this tells the
 * player what it is.
 */

export const RULES_URL = 'https://rules.buriedgiant.com/?product=oath&locale=en-US&printing=p1';

export interface ActionRule {
  /** Law section, e.g. "5.6". */
  section: string;
  summary: string;
}

export const ACTION_RULES: Record<string, ActionRule> = {
  'setup.choose': { section: '1.23', summary: 'Place your pawn on a faceup site (the Chancellor takes the top Cradle site), keep one card as a facedown adviser, discard the other two.' },
  'wake.resolve': { section: '4.1', summary: 'Start of your turn: resolve the People’s Favor if you hold it, then you may take a favor or secret from Salt Flats, Mine or Drowned City if your pawn is there.' },
  'turn.rest': { section: '4.3', summary: 'End your turn. Favor on cards goes back to its banks, your secrets come home faceup, your Supply refreshes from the warbands in your bank, and each Supply you didn’t spend moves it one more space left.' },
  search: { section: '5.1', summary: 'Major action. Pay Supply (the Visions Drawn cost for the world deck, 2 for your region’s discard), draw 3 cards, keep one to play and discard the rest.' },
  'card.play': { section: '5.1.4', summary: 'Play the card you kept: to your site (if it has room — gain a favor), as an adviser (up to three), or, as an Exile, a Vision to your Revealed Vision space. Or discard it.' },
  muster: { section: '5.2', summary: 'Major action. 1 Supply: put one favor on a denizen or intact edifice at your site with nothing on it, then move two warbands from your bank onto your board.' },
  trade: { section: '5.3', summary: 'Major action. 1 Supply, then at your site either put a secret on a free denizen to gain favor, or put two favor on one to gain secrets — more for each matching faceup adviser.' },
  recover: { section: '5.4', summary: 'Major action. 1 Supply: take a facedown relic at your site by paying the cost your site shows, or take a banner by paying more than is on it.' },
  'campaign.declare': { section: '5.5', summary: 'Major action. 2 Supply: attack a player who rules your site or is there (or the bandits), declare targets, and roll attack against defense.' },
  'campaign.ally': { section: '5.5.2', summary: 'Choose whether to send your warbands to help defend in this campaign.' },
  'campaign.permit': { section: '5.5.2', summary: 'As defender, choose whether to let an ally’s warbands join your defense.' },
  'campaign.respond': { section: '5.5.3', summary: 'As defender, answer the campaign before the dice are rolled.' },
  'campaign.resolve': { section: '5.5.7', summary: 'The attacker won: resolve each target (seize, ruin, take the title) in order.' },
  'campaign.casualties': { section: '5.5.6', summary: 'The loser kills half (rounded down) of the warbands in their force; choose which ones.' },
  travel: { section: '5.6', summary: 'Major action. Move your pawn to another site. From the Cradle: 1 within, 2 to Provinces, 4 to Hinterland. From the Provinces: 2 anywhere. From the Hinterland: 3 within, 2 to Provinces, 4 to Cradle. A facedown site is revealed when you arrive.' },
  'travel.direct': { section: '11.7', summary: 'You rule Shrouded Wood and someone is leaving it: choose the site they travel to.' },
  'adviser.play': { section: '6.1', summary: 'Minor action. Turn a facedown adviser faceup, or discard it, as if you had just searched it.' },
  'power.use': { section: '6.2', summary: 'Minor action. Use an “Action:” power on a card you have access to, and declare what it does.' },
  'peek.relic': { section: '6.3', summary: 'Minor action. Look at a facedown relic at your site.' },
  'peek.reliquary': { section: '6.4', summary: 'Minor action. Holding the Grand Scepter, look at any relic in the Imperial Reliquary.' },
  'warbands.move': { section: '6.5', summary: 'Minor action. Move warbands from your site to your board (keeping at least one there), or, if you rule your site, from your board to it.' },
  'warbands.allow': { section: '6.5', summary: 'Let another player move warbands to or from your site.' },
  'warbands.deny': { section: '6.5', summary: 'Refuse another player’s warband move at your site.' },
  'warbands.respond': { section: '6.5', summary: 'Answer a warband request at your site: allow the move, or deny it.' },
  'citizenship.offer': { section: '6.6.1', summary: 'Holding the Grand Scepter, offer an Exile Citizenship with exactly one Reliquary relic, plus any agreed exchange.' },
  'citizenship.accept': { section: '6.6.2', summary: 'Accept the offer: become a Citizen and complete the exchange.' },
  'citizenship.decline': { section: '6.6', summary: 'Decline the offer of Citizenship.' },
  'citizenship.respond': { section: '6.6.2', summary: 'Answer the offer: accept it and become a Citizen, completing the exchange, or decline and stay an Exile.' },
  'citizenship.exile': { section: '6.7', summary: 'Holding the Grand Scepter, exile another Citizen by giving them favor (5, adjusted for titles and the People’s Favor).' },
  'citizenship.selfExile': { section: '6.8', summary: 'As a Citizen, exile yourself by paying the Scepter holder favor for your secrets and the warbands on your board.' },
  'oathkeeper.grant': { section: '2.11', summary: 'Several players qualify for the Oathkeeper title; choose who takes it.' },
};

/** Settings, not rules: actions the app adds that the Law has no section for. */
export const NOT_RULES: Record<string, string> = {
  'standing.set': 'Standing answers: tell the game how to answer campaign and warband requests for you while you are away.',
};

/** The rules library's anchor for a section — its ids are the bare section numbers. */
export const ruleUrl = (section: string): string => `${RULES_URL}#${section}`;
