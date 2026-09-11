import { z } from 'zod';

/**
 * Suit order as it appears in the TTS/Vassal seed format. This order is load-
 * bearing for chronicle interop and must not be reordered.
 */
export const SUITS = [
  'discord',
  'hearth',
  'nomad',
  'arcane',
  'order',
  'beast',
] as const;

export type Suit = (typeof SUITS)[number];

export const SuitSchema = z.enum(SUITS);

export const SUIT_INDEX: Record<Suit, number> = Object.fromEntries(
  SUITS.map((s, i) => [s, i]),
) as Record<Suit, number>;

/** Card sets. `base` only for now; New Foundations can be added later. */
export const SetSchema = z.enum(['base']);
export type CardSet = z.infer<typeof SetSchema>;

export const ID_RE = /^(denizen|site|relic|vision|edifice|banner):[a-z0-9-]+$/;
const saveId = z.number().int().min(0).max(254);
const nonempty = z.string().min(1);

/**
 * UI hint for how a card's power is used. Player-declared, never enforced by
 * the engine. Only ever set via the text overlay (see text.ts).
 */
export const PowerKindSchema = z.enum([
  'action',
  'persistent',
  'battle',
  'whenPlayed',
  'locked',
  'none',
]);
export type PowerKind = z.infer<typeof PowerKindSchema>;

const baseCard = z.object({
  id: z.string().regex(ID_RE, 'id must be "<kind>:<slug>" with a lowercase slug'),
  name: nonempty,
  set: SetSchema,
  saveId,
  /** Prior printed names for this card, so old seeds still resolve. */
  aliases: z.array(nonempty).optional(),
  /** Card text, attached at load from the overlay. The engine never reads it. */
  text: nonempty.optional(),
  powerKind: PowerKindSchema.optional(),
  notes: nonempty.optional(),
});

/** Per-kind refinement: the id's prefix must match the card's kind. */
const idPrefix = (kind: string) => ({
  check: (c: { id: string }) => c.id.startsWith(`${kind}:`),
  opts: { message: `id must start with "${kind}:"`, path: ['id'] as string[] },
});

export const DenizenSchema = baseCard
  .extend({ suit: SuitSchema })
  .refine(idPrefix('denizen').check, idPrefix('denizen').opts);

/**
 * The relic recover cost printed in a site's bottom-right corner (Law
 * §5.4.2, §2.8.4) — one of four fixed options. `null` for sites that never
 * hold a relic (`reveal.relics === 0`), which print no such icon.
 */
export const SiteRecoverCostSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('placeFavor'), suit: SuitSchema }),
  z.object({ kind: z.literal('burnFavor') }),
  z.object({ kind: z.literal('burnSecret'), amount: z.union([z.literal(1), z.literal(2)]) }),
]);

export const SiteSchema = baseCard
  .extend({
    /** Max denizen + edifice cards the site holds (Law §2.8.1). */
    capacity: z.number().int().min(0),
    /**
     * The reveal prompt in the site's top-left corner (Law §2.8.2):
     * tokens placed from the shared bank / relics drawn from the relic
     * deck when the site is flipped faceup. `relics` is the "R"-icon
     * count (Law §5.6.2, §8.6.2). Hand-transcribed from the printed
     * cards — see data/site-reveals.json.
     */
    reveal: z.object({
      favor: z.number().int().min(0),
      secrets: z.number().int().min(0),
      relics: z.number().int().min(0),
    }),
    /** See `SiteRecoverCostSchema`. Hand-transcribed — see data/site-reveals.json. */
    recoverCost: SiteRecoverCostSchema.nullable(),
  })
  .refine(idPrefix('site').check, idPrefix('site').opts);

export const RelicSchema = baseCard
  .extend({
    /**
     * Defense dice added when this relic is targeted in a Campaign (Law
     * §2.4.2, printed top-right corner). Hand-transcribed — see
     * data/relic-defense-dice.json.
     */
    defenseDice: z.number().int().min(0),
  })
  .refine(idPrefix('relic').check, idPrefix('relic').opts);

export const VisionSchema = baseCard.refine(
  idPrefix('vision').check,
  idPrefix('vision').opts,
);

const face = z.object({ name: nonempty, saveId });

export const EdificeRuinSchema = baseCard
  .extend({
    suit: SuitSchema,
    faces: z.object({ edifice: face, ruin: face }),
  })
  .refine(idPrefix('edifice').check, idPrefix('edifice').opts)
  .refine((c) => c.faces.ruin.saveId === c.faces.edifice.saveId + 1, {
    message: 'ruin saveId must be edifice saveId + 1',
    path: ['faces', 'ruin', 'saveId'],
  });

export const BannerSchema = baseCard
  .extend({ faces: z.array(nonempty).min(1).max(2) })
  .refine(idPrefix('banner').check, idPrefix('banner').opts)
  .refine((c) => c.name === c.faces[0], {
    message: 'name must equal faces[0]',
    path: ['name'],
  });

export type Denizen = z.infer<typeof DenizenSchema>;
export type Site = z.infer<typeof SiteSchema>;
export type SiteRecoverCost = z.infer<typeof SiteRecoverCostSchema>;
export type Relic = z.infer<typeof RelicSchema>;
export type Vision = z.infer<typeof VisionSchema>;
export type EdificeRuin = z.infer<typeof EdificeRuinSchema>;
export type Banner = z.infer<typeof BannerSchema>;

export const CardDatabaseSchema = z
  .object({
    denizens: z.array(DenizenSchema),
    sites: z.array(SiteSchema),
    relics: z.array(RelicSchema),
    visions: z.array(VisionSchema),
    edifices: z.array(EdificeRuinSchema),
    banners: z.array(BannerSchema),
  })
  .superRefine((data, ctx) => {
    const everyCard = [
      ...data.denizens,
      ...data.sites,
      ...data.relics,
      ...data.visions,
      ...data.edifices,
      ...data.banners,
    ];

    // ids unique across every collection
    const idCounts = new Map<string, number>();
    for (const c of everyCard) {
      idCounts.set(c.id, (idCounts.get(c.id) ?? 0) + 1);
    }
    for (const [id, n] of idCounts) {
      if (n > 1) {
        ctx.addIssue({ code: 'custom', message: `duplicate id across collections: ${id}` });
      }
    }

    // saveIds unique within sites (their own numbering)
    dupCheck(
      ctx,
      data.sites.map((s) => s.saveId),
      'duplicate site saveId',
    );

    // saveIds unique across everything that isn't a site — including BOTH
    // faces of each edifice/ruin card
    dupCheck(
      ctx,
      [
        ...data.denizens.map((d) => d.saveId),
        ...data.relics.map((r) => r.saveId),
        ...data.visions.map((v) => v.saveId),
        ...data.banners.map((b) => b.saveId),
        ...data.edifices.flatMap((e) => [
          e.faces.edifice.saveId,
          e.faces.ruin.saveId,
        ]),
      ],
      'duplicate card saveId',
    );
  });

function dupCheck(ctx: z.RefinementCtx, values: number[], label: string) {
  const seen = new Set<number>();
  for (const v of values) {
    if (seen.has(v)) {
      ctx.addIssue({ code: 'custom', message: `${label}: ${v}` });
    }
    seen.add(v);
  }
}

export type CardDatabase = z.infer<typeof CardDatabaseSchema>;

export type Card = Denizen | Site | Relic | Vision | EdificeRuin | Banner;
