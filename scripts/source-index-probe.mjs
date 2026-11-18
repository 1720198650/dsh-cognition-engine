/**
 * scripts/source-index-probe.mjs — 离线验证资料层：把真实来源账本切块，看块数与检索质量。
 *
 * 用真实数据（cognition-sources.jsonl）跑，不依赖应用在运行、不调模型：
 *   node --experimental-strip-types scripts/source-index-probe.mjs [查询词...]
 *
 * 默认只读，不改任何数据文件；加 --write 才把块写进 cognition-source-blocks.jsonl
 * （幂等，应用启动后 ingestSource 也会做同样的事并自动跳过）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chunkText, bigrams } from '../src/source_library.ts';

const DATA_DIR = join(homedir(), '.dsh', 'cognition-engine');
const SOURCES = join(DATA_DIR, 'cognition-sources.jsonl');

const args = process.argv.slice(2);
const write = args.includes('--write');
const queries = args.filter((a) => a !== '--write');

if (!existsSync(SOURCES)) {
  console.error('找不到来源账本：' + SOURCES);
  process.exit(1);
}

const records = readFileSync(SOURCES, 'utf8')
  .replace(/^\uFEFF/, '')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line));

console.log('来源条数：' + records.length);
for (const record of records) {
  const pieces = chunkText(record.content);
  const lengths = pieces.map((p) => p.length);
  const max = lengths.length === 0 ? 0 : Math.max(...lengths);
  const min = lengths.length === 0 ? 0 : Math.min(...lengths);
  const avg = lengths.length === 0 ? 0 : Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  console.log(
    `${record.id.padEnd(6)} ${String(record.content.length).padStart(7)} 字 → ${String(pieces.length).padStart(4)} 块  ` +
      `(min ${min} / avg ${avg} / max ${max})  ${record.title}`,
  );
}

if (queries.length > 0) {
  const all = records.flatMap((record) =>
    chunkText(record.content).map((text, ord) => ({ sourceId: record.id, title: record.title, ord, text })),
  );
  for (const query of queries) {
    const grams = bigrams(query);
    const scored = all
      .map((block) => {
        const bg = bigrams(block.text);
        let hit = 0;
        for (const gram of grams) if (bg.has(gram)) hit += 1;
        return { ...block, score: grams.size === 0 ? 0 : hit / grams.size };
      })
      .filter((row) => row.score >= 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    console.log(`\n查询「${query}」命中 ${scored.length} 块：`);
    for (const row of scored) {
      console.log(`  ${row.score.toFixed(2)} ${row.sourceId}#${row.ord} ${row.title}`);
      console.log('    ' + row.text.slice(0, 160).replace(/\s+/g, ' '));
    }
  }
}

if (write) {
  const { SourceLibrary } = await import('../src/source_library.ts');
  const library = new SourceLibrary({
    blocksFile: join(DATA_DIR, 'cognition-source-blocks.jsonl'),
    notesFile: join(DATA_DIR, 'cognition-source-notes.json'),
  });
  for (const record of records) library.indexSource(record);
  console.log('\n已写入块索引：' + JSON.stringify(library.stats()));
} else {
  console.log('\n（只读模式；加 --write 才会写块索引）');
}
