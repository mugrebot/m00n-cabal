import type { LpPosition } from '@/app/lib/m00nSolarSystem.types';

export type { LpPosition } from '@/app/lib/m00nSolarSystem.types';

export function normalizeM00nRadii(
  positions: Pick<LpPosition, 'notionalUsd'>[],
  { minRadius = 26, maxRadius = 96 }: { minRadius?: number; maxRadius?: number } = {}
): number[] {
  if (positions.length === 0) return [];
  const values = positions.map((p) => p.notionalUsd);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) {
    return positions.map(() => (minRadius + maxRadius) / 2);
  }
  return positions.map((position) => {
    const normalized = (position.notionalUsd - min) / (max - min);
    return minRadius + normalized * (maxRadius - minRadius);
  });
}

export function computeSatelliteOrbit(
  satelliteIndex: number,
  totalSatellites: number,
  {
    centerX,
    centerY,
    orbitBase,
    orbitStep,
    timeMs,
    rotationSpeed = 0.00015
  }: {
    centerX: number;
    centerY: number;
    orbitBase: number;
    orbitStep: number;
    timeMs: number;
    rotationSpeed?: number;
  }
) {
  const stepAngle = (2 * Math.PI) / Math.max(totalSatellites, 1);
  const baseAngle = satelliteIndex * stepAngle;
  const animatedAngle = baseAngle + timeMs * rotationSpeed;
  const orbitRadius = orbitBase + satelliteIndex * orbitStep;
  return {
    x: centerX + orbitRadius * Math.cos(animatedAngle),
    y: centerY + orbitRadius * Math.sin(animatedAngle),
    orbitRadius
  };
}

export const truncateAddress = (address: string, visible = 4) => {
  if (!address) return '';
  return `${address.slice(0, visible + 2)}…${address.slice(-visible)}`;
};

// Convert Uniswap V4 tick to price ratio (token0 per token1)
export const tickToPrice = (tick: number) => Math.pow(1.0001, tick);

export const formatUsd = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
