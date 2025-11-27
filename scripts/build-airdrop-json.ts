import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

interface CsvRow {
  address: string;
  amount: string;
  reply_count?: string;
  replyCount?: string;
}

interface AirdropAllocation {
  amount: string;
  replyCount?: number;
}

interface AirdropData {
  [lowercaseAddress: string]: AirdropAllocation;
}

const DEFAULT_CSV_CANDIDATES = [
  path.join(process.cwd(), '../m00n - m00n.csv.csv'),
  path.join(__dirname, '../data/m00nad.csv')
];

function resolveCsvPath() {
  if (process.env.AIRDROP_CSV_PATH) {
    const resolved = path.resolve(process.cwd(), process.env.AIRDROP_CSV_PATH);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    console.warn(`[airdrop] AIRDROP_CSV_PATH set but file missing: ${resolved}`);
  }

  for (const candidate of DEFAULT_CSV_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate airdrop CSV. Checked: ${[
      process.env.AIRDROP_CSV_PATH,
      ...DEFAULT_CSV_CANDIDATES
    ]
      .filter(Boolean)
      .join(', ')}`
  );
}

async function buildAirdropJson() {
  const csvPath = resolveCsvPath();
  const outputPath = path.join(__dirname, '../public/data/m00nad_airdrop.json');

  try {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');

    const records: CsvRow[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    const airdropData: AirdropData = {};
    const seen = new Set<string>();

    for (const row of records) {
      if (!row.address || !row.amount) {
        console.warn(`Skipping invalid row: ${JSON.stringify(row)}`);
        continue;
      }

      const normalizedAddress = row.address.toLowerCase();
      const normalizedAmount = row.amount.trim();

      const numericAmount = Number(normalizedAmount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        console.warn(`Skipping non-positive amount for ${row.address}`);
        continue;
      }

      if (Number.isNaN(numericAmount)) {
        console.warn(`Skipping row with invalid amount: ${JSON.stringify(row)}`);
        continue;
      }

      if (seen.has(normalizedAddress)) {
        console.warn(`Duplicate address found: ${row.address}`);
        continue;
      }

      const replyRaw = row.reply_count ?? row.replyCount ?? '';
      const parsedReplyCount = Number(replyRaw);
      const replyCount =
        Number.isFinite(parsedReplyCount) && parsedReplyCount > 0
          ? Math.floor(parsedReplyCount)
          : undefined;

      seen.add(normalizedAddress);
      airdropData[normalizedAddress] = {
        amount: normalizedAmount,
        ...(replyCount !== undefined ? { replyCount } : {})
      };
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    fs.writeFileSync(outputPath, JSON.stringify(airdropData, null, 2));

    console.log(`✅ Successfully generated airdrop JSON`);
    console.log(`📊 Total addresses: ${Object.keys(airdropData).length}`);
  } catch (error) {
    console.error('❌ Error building airdrop JSON:', error);
    process.exit(1);
  }
}

buildAirdropJson();
