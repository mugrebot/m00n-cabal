export type PersonaKey =
  | 'claimed_sold'
  | 'claimed_held'
  | 'claimed_bought_more'
  | 'lp_gate'
  | 'eligible_holder'
  | 'locked_out';

export type PersonaActionId =
  | 'lp_connect_wallet'
  | 'lp_become_lp'
  | 'lp_open_docs'
  | 'lp_try_again'
  | 'lp_enter_lounge'
  | 'open_claim'
  | 'open_chat'
  | 'open_heaven_mode'
  | 'learn_more';

export interface PersonaCopy {
  title: string;
  body: string[];
  primaryCta?: {
    label: string;
    actionId: PersonaActionId;
  };
  secondaryCta?: {
    label: string;
    actionId: PersonaActionId;
  };
}

export type LpStatus = 'DISCONNECTED' | 'CHECKING' | 'NO_LP' | 'HAS_LP' | 'ERROR';

export interface PersonaStateInput {
  persona: PersonaKey;
  lpState?: {
    status: LpStatus;
    positionCount: number;
  };
}

const LP_COPY: Record<LpStatus, PersonaCopy> = {
  DISCONNECTED: {
    title: '🜁 LP Cabal Gate',
    body: [
      "You're in the right hallway, but the door is still sealed.",
      'Connect a wallet so I can scan the m00n / W-MON LP sigil.'
    ],
    primaryCta: { label: 'CONNECT WALLET', actionId: 'lp_connect_wallet' },
    secondaryCta: { label: 'BECOME LP', actionId: 'lp_become_lp' }
  },
  CHECKING: {
    title: '🔍 Scanning Liquidity Sigils…',
    body: ['Hold tight while I crawl your LP positions.', 'This only takes a second.'],
    primaryCta: { label: 'SCANNING…', actionId: 'lp_try_again' }
  },
  NO_LP: {
    title: '🚫 No LP. No Entry.',
    body: [
      "You've touched m00nad, but you're not in the m00n / W-MON pool.",
      'Spin up a sigil and the emoji gate unlocks automatically.'
    ],
    primaryCta: { label: 'CLAIM LP', actionId: 'lp_become_lp' },
    secondaryCta: { label: 'WHY LP MATTERS?', actionId: 'lp_open_docs' }
  },
  HAS_LP: {
    title: '✅ Welcome, LP Cabalist',
    body: ['Your LP sigil checks out.', 'LP lounge unlocked.'],
    primaryCta: { label: 'ENTER LP LOUNGE', actionId: 'lp_enter_lounge' }
  },
  ERROR: {
    title: '⚠️ Ritual Jammed',
    body: [
      'Something broke while fetching your LP data.',
      'Try again or open the LP site manually.'
    ],
    primaryCta: { label: 'TRY AGAIN', actionId: 'lp_try_again' },
    secondaryCta: { label: 'OPEN LP SITE', actionId: 'lp_become_lp' }
  }
};

export function getPersonaCopy(input: PersonaStateInput): PersonaCopy {
  if (input.persona === 'lp_gate') {
    const status = input.lpState?.status ?? 'DISCONNECTED';
    const base = LP_COPY[status];
    if (status === 'HAS_LP') {
      const count = input.lpState?.positionCount ?? 0;
      const positionLine =
        count > 0
          ? `We found ${count} live LP ${count === 1 ? 'position' : 'positions'} in the m00n / W-MON pool.`
          : 'We found active LP in the m00n / W-MON pool.';
      return {
        ...base,
        body: [positionLine, 'LP lounge and emoji uplink are unlocked.']
      };
    }
    return base;
  }

  switch (input.persona) {
    case 'claimed_sold':
      return {
        title: '☠️ Rest in Piss',
        body: [
          'Leave the rest in piss.',
          'You flipped your drop the moment it unlocked. The cabal keeps receipts.'
        ],
        secondaryCta: { label: 'LEARN MORE', actionId: 'learn_more' }
      };
    case 'claimed_held':
      return {
        title: '🪜 The Ones Who Came Anyway',
        body: [
          'Deploy the single-sided m00n ladder ~20% above spot and let pumps recycle into WMON.',
          'Stay in range, keep the ladder humming, and hold the line.'
        ],
        primaryCta: { label: 'DEPLOY SKY LADDER', actionId: 'lp_become_lp' },
        secondaryCta: { label: 'ENTER LP LOUNGE', actionId: 'lp_enter_lounge' }
      };
    case 'claimed_bought_more':
      return {
        title: '🔥 The Ones Who Doubled Down',
        body: [
          'Flood the crash band ~20% below tick with WMON so dumps auto-fill the treasury.',
          'Keep the floor thick and the sigil spinning.'
        ],
        primaryCta: { label: 'ENTER HEAVEN MODE', actionId: 'open_heaven_mode' }
      };
    case 'eligible_holder':
      return {
        title: 'WELCOME TO THE CABAL',
        body: [
          'Your drop is unlocked. Claim directly or share the ritual.',
          'Stay inside Warpcast to keep the tunnel open.'
        ],
        primaryCta: { label: 'OPEN CLAIM SITE', actionId: 'open_claim' }
      };
    case 'locked_out':
      return {
        title: 'ACCESS DENIED',
        body: [
          "You don't have to go home, but you can’t stay here.",
          'Only verified sigils can pass this gate.'
        ],
        secondaryCta: { label: 'LEARN MORE', actionId: 'learn_more' }
      };
    default:
      return {
        title: 'm00n Cabal',
        body: ['Portal recalibrating.'],
        secondaryCta: { label: 'LEARN MORE', actionId: 'learn_more' }
      };
  }
}
