export interface Tier {
  name: string;
  threshold: number;
  title: string;
  icon: string;
  flavorText: string;
  progressPercentage: number;
}

export const TIERS: Tier[] = [
  {
    name: 'Initiate',
    threshold: 1,
    title: 'Voidsteel Coffer',
    icon: '📦',
    flavorText:
      'You pry open a voidsteel coffer, its ancient hinges groaning with the weight of forgotten ages. A dim purple glow emanates from within...',
    progressPercentage: 25
  },
  {
    name: 'Shadow Adept',
    threshold: 25,
    title: 'Monad Crystal Cache',
    icon: '💎',
    flavorText:
      'The crystal cache hums with ethereal energy. As you touch its surface, visions of the purple realm flash before your eyes...',
    progressPercentage: 50
  },
  {
    name: 'Cabal Lieutenant',
    threshold: 50,
    title: 'Eclipse Strongbox',
    icon: '🗝️',
    flavorText:
      'The Eclipse Strongbox recognizes your dedication. Ancient runes pulse with recognition as the locks disengage one by one...',
    progressPercentage: 75
  },
  {
    name: 'Eclipsed Council',
    threshold: 100,
    title: 'Void Throne Reliquary',
    icon: '👑',
    flavorText:
      'The Void Throne Reliquary acknowledges your ascension. Reality bends as you claim your rightful place among the Eclipsed Council...',
    progressPercentage: 100
  }
];

export function getTierByReplyCount(replyCount: number): Tier | null {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (replyCount >= TIERS[i].threshold) {
      return TIERS[i];
    }
  }
  return null;
}
