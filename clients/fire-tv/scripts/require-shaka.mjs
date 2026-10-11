/** Build guard: a Vega build without Shaka cannot play any title the server serves as HLS ("Shaka Player for Vega is unavailable"). */
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const needed = ['src/vendor/shaka/index.ts', 'src/vendor/shaka/dist'];
const missing = needed.filter((file) => !existsSync(path.join(root, file)));
if (missing.length > 0) {
  console.error(`require-shaka: ${missing.join(', ')} missing. Run scripts/setup-shaka.sh before building: an app built without Shaka cannot play HLS titles.`);
  process.exit(1);
}
