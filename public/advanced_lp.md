## Custom LP Planner — Quick Guide

Use this short guide to pick a position type. LPing carries risk.

### Position Types

- **Single-sided (m00n):** m00n only, range above spot. Earn fees if price rises into it.
- **Single-sided (W-MON):** W-MON only, range below spot. Earn fees if price dips into it.
- **Double-sided:** Both tokens across a band. Earn fees in both; impermanent loss applies.

### Choosing a Range

- **Narrow:** More APR in-range; can fall out faster.
- **Wide:** More time in-range; lower peak APR; smoother ride.

### Outlook Heuristics (not advice)

- **Bullish m00n:** m00n-only above spot or double-sided tilted up.
- **Bearish/hedge:** W-MON-only below spot or tilted down.
- **Neutral/fees:** Double-sided, symmetric around spot.

### Fees and Rewards

- Fees accrue in tokens that trade through your range.
- Single-sided earns the opposite token when trades cross; double-sided can earn both.

### Risks & Disclaimers

- LPing is **not risk-free**. Impermanent loss and price moves can hurt versus holding.
- You may go out-of-range and earn zero fees until price returns.
- Smart contract/protocol risk. Only deposit what you can afford to lose.
- Nothing here is financial advice.

### Quick Checklist Before Deploy

- On Monad and connected.
- Range makes sense versus current price.
- Amounts and approvals look right.

### Learn More

- Uniswap v4 concentrated liquidity primer:
  https://docs.uniswap.org/concepts/protocol/concentrated-liquidity
- Pool telemetry is visible in the Custom LP Planner chart.
