import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

interface CsvRow {
  address: string;
  amount: string;
}

interface AirdropData {
  [lowercaseAddress: string]: {
    amount: string;
  };
}

async function buildAirdropJson() {
  const csvPath = path.join(__dirname, '../data/m00nad.csv');
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

      if (seen.has(normalizedAddress)) {
        console.warn(`Duplicate address found: ${row.address}`);
        continue;
      }

      seen.add(normalizedAddress);
      airdropData[normalizedAddress] = {
        amount: row.amount
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
