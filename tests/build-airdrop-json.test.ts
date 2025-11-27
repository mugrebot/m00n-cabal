import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('build-airdrop-json', () => {
  const outputPath = path.join(__dirname, '../public/data/m00nad_airdrop.json');

  beforeAll(() => {
    // Ensure the JSON file exists (should be built during CI)
    if (!fs.existsSync(outputPath)) {
      console.warn('Airdrop JSON not found. Run: bun run scripts/build-airdrop-json.ts');
    }
  });

  it('should generate valid JSON file', () => {
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    const data = JSON.parse(content);

    expect(typeof data).toBe('object');
    expect(data).not.toBeNull();
  });

  it('should have lowercase addresses as keys', () => {
    const content = fs.readFileSync(outputPath, 'utf-8');
    const data = JSON.parse(content);

    const addresses = Object.keys(data);
    addresses.forEach((address) => {
      expect(address).toBe(address.toLowerCase());
      expect(address).toMatch(/^0x[a-f0-9]{40}$/);
    });
  });

  it('should have amount field in each entry', () => {
    const content = fs.readFileSync(outputPath, 'utf-8');
    const data = JSON.parse(content);

    type AirdropEntry = { amount: string };
    const entries = Object.values(data) as AirdropEntry[];

    entries.forEach((entry) => {
      expect(entry).toHaveProperty('amount');
      expect(typeof entry.amount).toBe('string');
      expect(parseInt(entry.amount)).toBeGreaterThan(0);
    });
  });
});
