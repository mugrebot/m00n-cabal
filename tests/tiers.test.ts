import { describe, it, expect } from 'vitest';
import { getTierByReplyCount, TIERS } from '@/app/lib/tiers';

describe('getTierByReplyCount', () => {
  it('should return null for 0 replies', () => {
    expect(getTierByReplyCount(0)).toBeNull();
  });

  it('should return Initiate tier for 1-24 replies', () => {
    const tier = getTierByReplyCount(1);
    expect(tier).not.toBeNull();
    expect(tier?.name).toBe('Initiate');

    expect(getTierByReplyCount(24)?.name).toBe('Initiate');
  });

  it('should return Shadow Adept tier for 25-49 replies', () => {
    expect(getTierByReplyCount(25)?.name).toBe('Shadow Adept');
    expect(getTierByReplyCount(49)?.name).toBe('Shadow Adept');
  });

  it('should return Cabal Lieutenant tier for 50-99 replies', () => {
    expect(getTierByReplyCount(50)?.name).toBe('Cabal Lieutenant');
    expect(getTierByReplyCount(99)?.name).toBe('Cabal Lieutenant');
  });

  it('should return Eclipsed Council tier for 100+ replies', () => {
    expect(getTierByReplyCount(100)?.name).toBe('Eclipsed Council');
    expect(getTierByReplyCount(500)?.name).toBe('Eclipsed Council');
  });
});

describe('TIERS', () => {
  it('should have correct number of tiers', () => {
    expect(TIERS).toHaveLength(4);
  });

  it('should have increasing thresholds', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].threshold).toBeGreaterThan(TIERS[i - 1].threshold);
    }
  });

  it('should have all required properties', () => {
    TIERS.forEach((tier) => {
      expect(tier).toHaveProperty('name');
      expect(tier).toHaveProperty('threshold');
      expect(tier).toHaveProperty('title');
      expect(tier).toHaveProperty('icon');
      expect(tier).toHaveProperty('flavorText');
      expect(tier).toHaveProperty('progressPercentage');
    });
  });
});
