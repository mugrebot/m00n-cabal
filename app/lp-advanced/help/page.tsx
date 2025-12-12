'use client';

import { useRouter } from 'next/navigation';

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
    title: 'Full Moon Rewards',
    bullets: [
      'Rewards distributed every full moon 🌕',
      'Must hold 1M+ m00n tokens',
      'Position must be 7+ days old',
      'Must have 7+ day streak (consecutive days in range)',
      'Must be in range at snapshot time'
    ]
  }
];

export default function HelpPage() {
  const router = useRouter();

  const handleBack = () => {
    // Use browser history to go back to wherever user came from
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/miniapp');
    }
  };

  return (
    <main className="fixed inset-0 z-[99999] bg-black text-white overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">LP Guide</h1>
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1 text-sm font-medium text-white hover:text-white/80 transition px-3 py-1.5 rounded-lg border border-white/20"
          >
            <span>←</span>
            <span>Back</span>
          </button>
        </div>

        <p className="text-base text-white leading-relaxed">
          Use this short guide to understand the Custom LP Planner and pick a position type. LPing
          carries risk.
        </p>

        <div className="space-y-3">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-3xl border border-white/30 bg-black/50 px-4 py-4 shadow-lg space-y-3"
            >
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <ul className="list-disc list-inside space-y-2 text-sm text-white leading-relaxed">
                {section.bullets.map((item) => (
                  <li key={item} dangerouslySetInnerHTML={{ __html: item }} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="text-xs text-white leading-relaxed">
          Nothing here is financial advice. Only deploy what you can afford to lose.
        </p>
      </div>
    </main>
  );
}
