import Link from 'next/link';

const sections = [
  {
    title: 'Position Types',
    bullets: [
      '**Single-sided (m00n):** m00n only, range above spot. Earn fees if price rises into it.',
      '**Single-sided (W-MON):** W-MON only, range below spot. Earn fees if price dips into it.',
      '**Double-sided:** Both tokens across a band. Earn fees in both; impermanent loss applies.'
    ]
  },
  {
    title: 'Choosing a Range',
    bullets: [
      '**Narrow:** More APR in-range; can fall out faster.',
      '**Wide:** More time in-range; lower peak APR; smoother ride.'
    ]
  },
  {
    title: 'Outlook Heuristics (not advice)',
    bullets: [
      '**Bullish m00n:** m00n-only above spot or double-sided tilted up.',
      '**Bearish/hedge:** W-MON-only below spot or tilted down.',
      '**Neutral/fees:** Double-sided, symmetric around spot.'
    ]
  },
  {
    title: 'Fees and Rewards',
    bullets: [
      'Fees accrue in tokens that trade through your range.',
      'Single-sided earns the opposite token when trades cross; double-sided can earn both.'
    ]
  },
  {
    title: 'Risks & Disclaimers',
    bullets: [
      'LPing is **not risk-free**. Impermanent loss and price moves can hurt versus holding.',
      'You may go out-of-range and earn zero fees until price returns.',
      'Smart contract and protocol risk apply. Only deposit what you can afford to lose.',
      'Nothing here is financial advice.'
    ]
  },
  {
    title: 'Quick Checklist Before Deploy',
    bullets: [
      'On Monad and connected.',
      'Range makes sense versus current price.',
      'Amounts and approvals look right.'
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
    <main className="min-h-screen text-white relative">
      <div className="absolute inset-0 bg-[#02020a]" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/85" />
      <div className="relative max-w-3xl mx-auto px-5 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Custom LP Planner — Guide
          </h1>
          <Link
            href="/lp-advanced"
            className="text-sm px-3 py-1 rounded-full border border-white/40 bg-white/5 hover:bg-white/15 transition text-white"
          >
            ← Back
          </Link>
        </div>

        <p className="text-sm text-white/90 leading-relaxed">
          Use this short guide to understand the Custom LP Planner and pick a position type. LPing
          carries risk.
        </p>

        <div className="space-y-4">
          {sections.map((section) => (
            <section
              key={section.title}
              className="border border-white/15 rounded-xl p-4 bg-black/90 shadow-lg space-y-2"
            >
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <ul className="list-disc list-inside space-y-3 text-sm text-white/90 leading-relaxed">
                {section.bullets.map((item) => (
                  <li key={item} dangerouslySetInnerHTML={{ __html: item }} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="text-xs text-white/80 leading-relaxed">
          Nothing here is financial advice. Only deploy what you can afford to lose.
        </p>
      </div>
    </main>
  );
}
