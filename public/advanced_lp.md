<p align="right"><a href="/lp-advanced">← Back to LP Lab</a></p>

## Advanced LP Lab — Quick Guide

Use this cheat sheet to understand the Advanced LP Lab and decide which
position type fits your outlook. Read everything carefully—LPing carries risk.

### Position Types

- **Single-sided (m00n-only):** Deposit only m00n. Your liquidity sits above the
  current price. You earn fees if price trades into your range; you’re exposed
  to m00n downside only via opportunity cost (staying in m00n).
- **Single-sided (W-MON-only):** Deposit only W-MON. Your liquidity sits below
  the current price. You earn fees if price trades down into your range; you’re
  exposed to m00n upside opportunity cost.
- **Double-sided:** Deposit both m00n and W-MON across a range. You earn fees in
  both tokens while active. Impermanent loss applies if price moves and stays
  away from your entry mix.

### Choosing a Range

- **Narrow range:** Higher fee APR when in-range, but you fall out-of-range more
  easily (no fees when out-of-range).
- **Wide range:** More time in-range, lower peak APR, smoother experience.

### Market Outlook Heuristics (not advice)

- **Bullish m00n:** Prefer m00n-only single-sided above spot, or a wide
  double-sided range tilted above spot.
- **Bearish/hedging:** Prefer W-MON-only single-sided below spot, or a range
  tilted below spot.
- **Neutral/fee farming:** Double-sided, symmetric around spot with a sensible
  width to stay active.

### Fees and Rewards

- Fees accrue in the tokens that trade through your range. In double-sided you
  can accrue both tokens; in single-sided you accrue the opposite token when
  trades cross your range.

### Risks & Disclaimers

- LPing is **not risk-free**. You can lose value vs. holding due to impermanent
- loss and adverse price moves.
- You may go out-of-range and earn zero fees until price returns.
- Smart contract and protocol risk apply. Only deposit what you can afford to
  lose.
- Nothing here is financial advice.

### Quick Checklist Before Deploy

- You’re connected to the correct wallet (Monad).
- You understand where your range sits relative to current price.
- You’re comfortable with the amounts and approval prompts.

### Learn More

- Uniswap v4 concentrated liquidity primer:
  https://docs.uniswap.org/concepts/protocol/concentrated-liquidity
- m00n/WMON pool telemetry is visible in the Advanced LP page chart.
