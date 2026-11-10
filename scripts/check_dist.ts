import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBuildIdentity } from './gen_engine_identity.ts';

const REQUIRED_FILES = [
  'index.html',
  'tesseract/worker.min.js',
  'tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/core/tesseract-core-lstm.wasm.js',
  'tesseract/lang/eng.traineddata.gz',
  'tesseract/lang/tha.traineddata.gz',
];

const REQUIRED_ASSET_PATTERNS = [
  /^ch_PP-OCRv4_det_infer-.*\.onnx$/,
  /^ch_PP-OCRv4_rec_infer-.*\.onnx$/,
  /^ppocr_keys_v1-.*\.txt$/,
  /\.wasm$/,
];

function dirSize(targetDir: string, unreadable: string[] = []): number {
  if (!fs.existsSync(targetDir)) return 0;
  let total = 0;
  try {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const full = path.join(targetDir, entry.name);
      if (entry.isDirectory()) total += dirSize(full, unreadable);
      else {
        try { total += fs.statSync(full).size; } catch { unreadable.push(full); }
      }
    }
  } catch {
    unreadable.push(targetDir);
  }
  return total;
}

export function checkDist(
  dir: string,
  verify: (dir: string) => { ok: boolean; reason: string; built?: string; current?: string } = verifyBuildIdentity
): { ok: boolean; problems: string[]; sizesMB: { total: number; datasets: number } } {
  const problems: string[] = [];

  // 1. Build identity
  try {
    const v = verify(dir);
    if (!v.ok) problems.push(v.reason);
  } catch (e) {
    problems.push((e as Error).message);
  }

  // 2. Required files exist and non-empty
  for (const rel of REQUIRED_FILES) {
    const fp = path.join(dir, rel);
    if (!fs.existsSync(fp)) {
      problems.push(`missing file: ${rel}`);
    } else {
      try {
        if (fs.statSync(fp).size === 0) problems.push(`empty file: ${rel}`);
      } catch {
        problems.push(`cannot read file: ${rel}`);
      }
    }
  }

  // 3. Required assets under dir/assets
  const assetsDir = path.join(dir, 'assets');
  let assetFiles: { name: string; size: number }[] = [];
  if (fs.existsSync(assetsDir)) {
    try {
      assetFiles = fs.readdirSync(assetsDir).map(name => {
        try {
          const st = fs.statSync(path.join(assetsDir, name));
          return { name, size: st.isFile() ? st.size : 0 };
        } catch {
          return { name, size: 0 };
        }
      });
    } catch {}
  }
  for (const re of REQUIRED_ASSET_PATTERNS) {
    if (!assetFiles.some(f => re.test(f.name) && f.size > 0)) {
      problems.push(`missing asset matching ${re}`);
    }
  }

  // 4. File sizes in MB rounded to 1 decimal
  const toMB = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
  const datasetsDir = path.join(dir, 'datasets');
  const unreadable: string[] = [];
  const sizesMB = {
    total: toMB(dirSize(dir, unreadable)),
    datasets: fs.existsSync(datasetsDir) ? toMB(dirSize(datasetsDir)) : 0,
  };
  for (const p of unreadable) {
    problems.push(`cannot read: ${path.relative(dir, p).replace(/\\/g, '/')}`);
  }

  return { ok: problems.length === 0, problems, sizesMB };
}

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const dir = process.argv[2] ?? 'dist';
  const res = checkDist(dir);
  console.log(`checked ${dir}: ${res.ok ? 'OK' : 'FAIL'} (total ${res.sizesMB.total} MB, datasets ${res.sizesMB.datasets} MB)`);
  if (!res.ok) {
    for (const p of res.problems) console.error(`- ${p}`);
    process.exit(1);
  }
}
