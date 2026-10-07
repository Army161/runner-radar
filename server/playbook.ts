import type { Tier } from './billing.ts';

/**
 * The Runner Playbook: the step-by-step process for using the scanner well.
 * Gated by tier server-side. Body text is a tiny markdown subset:
 * "## " headings, "- " lists, "1. " numbered lists, blank-line paragraphs.
 *
 * House rule for this copy: concrete and honest. No profit guarantees anywhere —
 * most meme coins go to zero, and the edge this tool gives is selection and
 * discipline, not certainty.
 */

export interface PlaybookSection {
  id: string;
  title: string;
  minTier: Tier;
  summary: string;
  body: string;
}

export const PLAYBOOK: PlaybookSection[] = [
  {
    id: 'ground-rules',
    title: 'Ground rules: survive first',
    minTier: 'free',
    summary: 'Bankroll rules that keep you in the game long enough for the edge to matter.',
    body: `Everything else in this playbook is worthless if one bad token can take you out. Set these rules before your first trade and never bend them mid-session.

1. Trade only money you can lose entirely. Most meme coins go to zero. That is the market, not a flaw in the scanner.
2. Size per token: 1–2% of your meme-coin bankroll. At 2%, a full rug costs you a bad day, not your stack.
3. Never add to a loser. Averaging down on a token with a falling Runner Score is how accounts die.
4. Decide your exit before you enter. If you can't say what makes you sell, you're not ready to buy.
5. Keep fees in view. Trading terminals take ~1% per trade round-trip. Overtrading bleeds you even when you pick well.

## What the scanner is — and isn't

Runner Radar removes the obvious ways to lose (honeypots, clones, rug-history devs, bundled launches) and ranks what's left by live behavior. It raises the quality of your shots. It does not make any single token a winner, and nobody can. Treat every alert as a candidate, not a command.`,
  },
  {
    id: 'first-hour',
    title: 'Your first hour: setup that compounds',
    minTier: 'free',
    summary: 'Preset, alerts, and your first smart-wallet list — ten minutes that improve every session after.',
    body: `1. Pick your preset honestly. Balanced is right for most people. Strict if you only want cleaner, older tokens. Degen only if you fully accept more blow-ups for earlier entries.
2. Set your alert score to 82–85 while you learn. Fewer, better pings beat a noisy feed.
3. Link Telegram (Settings → Telegram) so runner alerts reach you when the tab is closed. Runners move in minutes.
4. Seed your smart-wallet list. Open the last few tokens that actually ran, look at Holder forensics, and add wallets tagged "smart money" that entered early. Five good wallets beat fifty random ones.
5. Watch the Blocked list for a day. Reading why tokens get killed — the bundle percentages, the recycled dev wallets, the clones — trains your eye faster than any thread on X.

## The habit

Check Trending and Bonding at a consistent time each day. Launch activity clusters; you'll learn your market's rhythm within a week.`,
  },
  {
    id: 'runner-check',
    title: 'The 60-second runner check',
    minTier: 'pro',
    summary: 'The exact checklist to run on every alert before any money moves.',
    body: `An alert means a token crossed your score with the hard gates passing. Your job in the next 60 seconds is to find a reason to skip. There is always another launch — skipping is free.

1. Safety gate: 5/5 pass. Any WARN on honeypot or dev history → skip, no exceptions.
2. Vamp check says "original". If it shares a ticker with an earlier token, open the earlier one. If that one is alive and bigger, you're looking at the copy.
3. Holder forensics: launch bundle under ~10%, top-10 under ~25%, dev under ~4%, snipers not sitting on a dump. One bad number is a warning; two is a skip.
4. Tape check: buys outpacing sells, holders rising, unique buyers climbing. A score built on one whale's buys collapses when that whale leaves.
5. Smart money: 2+ tracked wallets in and still holding is real confirmation. A burst (several within 90 seconds) is the strongest signal this tool produces.
6. Chart position: if the 5-minute chart is a vertical line, you are the exit liquidity. Wait for the first pullback that holds, or let it go.

If it passes everything, decide size (ground rules), set your invalidation (next section), then act. If you hesitate longer than a couple of minutes, the moment has usually passed — let it go.`,
  },
  {
    id: 'exits',
    title: 'Exit discipline: where the money is actually made',
    minTier: 'pro',
    summary: 'Laddered take-profits, the house-money rule, and hard invalidations that fire without debate.',
    body: `Entries get the attention; exits decide the outcome. The pattern that kills most traders isn't picking wrong — it's round-tripping a 3x back to zero because there was no plan.

## The ladder

1. At roughly +80–120%, sell enough to pull your initial out (usually ~half the position). You are now playing with house money and your worst case is breakeven-ish minus fees.
2. Trail the rest. Sell another quarter on each leg up, or hold while the score stays strong and smart wallets stay in.
3. Never sell everything into strength out of boredom, and never hold everything out of greed. The ladder removes both mistakes.

## Hard invalidations — exit the rest immediately, no debate

- Dev sells any meaningful amount (you get this alert if you're watching the token).
- Two or more tracked wallets fully exit.
- Score drops below 70 after you entered above 80.
- The reason you entered is gone (the narrative died, the original it was riding collapsed).

## Graduation

Curve completion is a volatility event: migration brings a wave of attention and often a sharp move both ways. Taking partials into graduation hype is rarely wrong.

Write your plan in one line before entering. Example: "0.5 SOL in · half out at 2x · rest trails · dead if dev sells or score < 70."`,
  },
  {
    id: 'smart-money',
    title: 'Building a smart-money list that actually signals',
    minTier: 'pro',
    summary: 'How to find, curate, and prune the 10–25 wallets whose entries mean something.',
    body: `The Smart Money agent is only as good as the wallets you feed it. Curate like a scout, not a collector.

## Finding candidates

1. Open the token page of anything that ran 5x+ in the last week.
2. In Holder forensics, note early buyers that are NOT tagged sniper or bundle — wallets that bought in the first minutes on merit.
3. A wallet that shows up early on two or more different winners is a candidate. One win is luck; repetition is skill (or information — either way, you want to see their next move).
4. Label every wallet when you add it ("early on X and Y, Jun") so future-you knows why it's there.

## Curation rules

- 10–25 wallets. Beyond that, "smart money bought" stops meaning anything.
- Prune monthly. Winning wallets rotate or die; a list that never changes decays.
- Weight bursts over singles: one tracked wallet buying is interest; three inside 90 seconds is conviction.
- Never copy-trade blindly. Smart wallets take losses too — their entry is one green light in your checklist, not the checklist.`,
  },
  {
    id: 'reading-the-room',
    title: 'Reading the room: metas, vamp waves, and timing',
    minTier: 'pro',
    summary: 'Using the Blocked list, Gainers tab, and launch rhythms as a market radar.',
    body: `The scanner shows you the whole battlefield, not just your targets. Learn to read it.

- Vamp waves confirm heat. When the Vamp detector starts blocking five clones of the same token, the original is the meta. Clones are a sentiment gauge — and a reminder the cycle is maturing.
- The Blocked list is a syllabus. Each entry tells you what predators are doing this week: bigger bundles, recycled dev wallets, fake socials. The scam meta rotates like the token meta.
- Gainers across windows tells you cycle age. Everything green on 24h but red on 5m = you're late; rotate to New pairs and Bonding instead of chasing.
- Liquidity has hours. Launch volume clusters around US afternoons and evenings; thin weekend tape moves further on less and reverses harder. Size down when the tape is thin.
- After a big runner, the next hour of launches is a minefield of copycats and sniper farms. Patience there is a position.`,
  },
  {
    id: 'creators',
    title: 'For token creators: launching clean',
    minTier: 'apex',
    summary: 'How to pass every gate by design and build a launch that scanners — and holders — trust.',
    body: `Every serious trader now runs tools like this one. A launch that trips the gates is dead on arrival to exactly the buyers you want. Passing them isn't a trick — it's doing the launch properly.

1. Revoke mint and freeze authority (pump.fun does this by default — don't "upgrade" your way out of it). An active authority is an instant block on every scanner.
2. Zero bundling. Buying your own launch through a dozen funded-from-one-place wallets is visible in block 0 to every bundle scan on the market. It permanently marks the token AND the wallets.
3. Never self-snipe the first seconds. Sniper share is measured; a launch where insiders hold 20% reads as exit liquidity, because it is.
4. Socials live BEFORE mint: an X account with real posts and a Telegram that answers. The Narrative agent (and every human) checks whether the account is older than the token and not reused from a previous launch.
5. Dev bag small and untouched: a few percent, bought honestly at launch. The moment you sell, everyone watching gets a dev-sell alert — early selling is the single fastest way to kill your own chart.
6. Work the 40–80% bonding window. Graduation watchers are staring at exactly this range; steady progress there is your best organic marketing.
7. After graduation, keep showing up. Re-check agents run continuously; a creator who keeps building keeps their score, and holders who were never rugged come back for your next launch. Reputation compounds — the Dev forensics agent literally keeps the ledger.

None of this manufactures demand for a token nobody wants. What it does is make sure that when demand shows up, nothing about your launch gives it a reason to leave.`,
  },
];

export function playbookFor(tier: Tier) {
  const rank: Record<Tier, number> = { free: 0, pro: 1, apex: 2 };
  return PLAYBOOK.map((s) => {
    const unlocked = rank[tier] >= rank[s.minTier];
    return { id: s.id, title: s.title, summary: s.summary, minTier: s.minTier, unlocked, body: unlocked ? s.body : null };
  });
}
