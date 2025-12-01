export type RangeStatus = 'below-range' | 'in-range' | 'above-range';

export interface LpPosition {
  owner: string;
  tokenId: string;
  notionalUsd: number;
  notionalToken0?: number;
  notionalToken1?: number;
  isClankerPool: boolean;
  tickLower?: number;
  tickUpper?: number;
  rangeStatus?: RangeStatus;
  currentTick?: number;
}
