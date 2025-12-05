import Link from 'next/link';

const sections = [
  {
    title: 'Position Types',
    bullets: [
      '**Single-sided (m00n-only):** Deposit only m00n. Liquidity above current price. Earn fees if price trades up into your range; main cost is m00n opportunity.',
      '**Single-sided (W-MON-only):** Deposit only W-MON. Liquidity below current price. Earn fees if price trades down into your range; main cost is m00n upside opportunity.',
      '**Double-sided:** Deposit both m00n and W-MON across a range. Earn fees in both while active. Impermanent loss applies if price moves and stays away from your entry mix.'
    ]
  },
  {
    title: 'Choosing a Range',
    bullets: [
      '**Narrow range:** Higher fee APR when in-range; easier to fall out-of-range (no fees when out).',
      '**Wide range:** More time in-range; lower peak APR; smoother experience.'
    ]
  },
  {
    title: 'Market Outlook Heuristics (not advice)',
    bullets: [
      '**Bullish m00n:** m00n-only single-sided above spot, or wide double-sided tilted above spot.',
      '**Bearish/hedging:** W-MON-only single-sided below spot, or range tilted below spot.',
      '**Neutral/fee farming:** Double-sided, symmetric around spot with sensible width to stay active.'
    ]
  },
  {
    title: 'Fees and Rewards',
    bullets: [
      'Fees accrue in the tokens that trade through your range.',
      'Double-sided can accrue both tokens; single-sided accrues the opposite token when trades cross your range.'
    ]
  },
  {
    title: 'Risks & Disclaimers',
    bullets: [
      'LPing is **not risk-free**. Impermanent loss and adverse price moves can reduce value vs. holding.',
      'You may go out-of-range and earn zero fees until price returns.',
      'Smart contract and protocol risk apply. Only deposit what you can afford to lose.',
      'Nothing here is financial advice.'
    ]
  },
  {
    title: 'Quick Checklist Before Deploy',
    bullets: [
      'On Monad and connected to the correct wallet.',
      'You know where your range sits relative to current price.',
      'Amounts and approvals look correct.'
    ]
  },
  {
    title: 'Learn More',
    bullets: [
      'Uniswap v4 concentrated liquidity primer: https://docs.uniswap.org/concepts/protocol/concentrated-liquidity',
      'Pool telemetry is visible in the Custom LP Planner chart.'
    ]
  }
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Custom LP Planner — Guide</h1>
        <Link
          href="/lp-advanced"
          className="text-sm px-3 py-1 rounded-full border border-white/20 hover:bg-white/10 transition"
        >
          ← Back
        </Link>
      </div>

      <p className="text-sm text-white/70">
        Use this cheat sheet to understand the Custom LP Planner and decide which position type fits
        your outlook. Read carefully—LPing carries risk.
      </p>

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.title} className="border border-white/10 rounded-xl p-4 bg-white/5">
            <h2 className="text-lg font-semibold mb-2">{section.title}</h2>
            <ul className="list-disc list-inside space-y-2 text-sm text-white/80">
              {section.bullets.map((item) => (
                <li key={item} dangerouslySetInnerHTML={{ __html: item }} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-xs text-white/60">
        Remember: nothing here is financial advice. Only deploy what you can afford to lose.
      </p>
    </main>
  );
}
