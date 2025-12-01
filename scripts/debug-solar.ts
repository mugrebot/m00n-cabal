import { config as loadEnv } from 'dotenv';
loadEnv();

import { buildLeaderboardSnapshot, buildSolarSystemPayload } from '../app/lib/lpTelemetry';

async function main() {
  try {
    console.log('----- solar system payload -----');
    const solar = await buildSolarSystemPayload();
    console.dir(solar, { depth: null });

    console.log('\n----- leaderboard snapshot -----');
    const leaderboard = await buildLeaderboardSnapshot();
    console.dir(leaderboard, { depth: null });
  } catch (error) {
    console.error('[debug-solar] failed to fetch telemetry', error);
    process.exitCode = 1;
  }
}

void main();
