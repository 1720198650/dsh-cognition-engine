// 小语料中文记忆检索基准：TF 余弦 vs TF-IDF vs BM25 家族
// 纯 Node，无依赖。语料与查询均为本次调研自建（见 corpus.json / queries.json）。
const fs = require('fs');
const path = require('path');

const readJson = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/^\uFEFF/, ''));
const CORPUS_FILE = process.argv[2] || 'corpus.json';
const corpus = readJson(CORPUS_FILE);
const queries = readJson('queries.json');
const IDS = corpus.map(d => d.id);
const TRUTH = queries.map(q => new Set(q.targets.map(id => IDS.indexOf(id))));

const STOP_CHARS = new Set('的了是在我你他她它这那就都也和与还把被给对里上下个之而及或吗呢吧啊嗯呀哦不没有会要能很更最又再才只从向于为以'.split(''));
const STOP_TOKENS = new Set(['什么', '怎么', '为什', '哪个', '哪些', '多少', '几点', '可以', '一下', '一个', '一次', '时候', '现在', '到底', '是不是', '要不要', '能不能', '有没有']);
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function isStopTok(tok) {
  if (STOP_TOKENS.has(tok)) return true;
  return [...tok].every(c => STOP_CHARS.has(c));
}

function tokenize(text, mode) {
  const s = text.normalize('NFKC').toLowerCase();
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (CJK.test(ch)) {
      let j = i;
      while (j < s.length && CJK.test(s[j])) j++;
      const run = s.slice(i, j);
      if (mode === 'unigram') for (const c of run) out.push(c);
      else {
        for (let k = 0; k + 1 < run.length; k++) out.push(run.slice(k, k + 2));
        if (run.length === 1) out.push(run);
        if (mode === 'bigram+unigram') for (const c of run) out.push(c);
      }
      i = j;
    } else {
      const m = /^[a-z0-9]+(?:[._-][a-z0-9]+)*/.exec(s.slice(i));
      if (m) { out.push(m[0]); i += m[0].length; } else i++;
    }
  }
  return out.filter(t => !isStopTok(t));
}

function buildIndex(mode) {
  const post = new Map();
  const docLen = [];
  let total = 0;
  corpus.forEach((d, di) => {
    const toks = tokenize(d.text, mode);
    docLen[di] = toks.length;
    total += toks.length;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, f] of tf) {
      if (!post.has(t)) post.set(t, new Map());
      post.get(t).set(di, f);
    }
  });
  return { post, docLen, avgdl: total / corpus.length, N: corpus.length };
}

const idfLucene = (N, df) => Math.log(1 + (N - df + 0.5) / (df + 0.5));
const idfLvZhai = (N, df) => Math.log((N + 1) / (df + 0.5));

function makeScorers(idx) {
  const { post, docLen, avgdl, N } = idx;

  const tfCos = (qTokens) => {
    const score = new Array(N).fill(0);
    const qtf = new Map();
    for (const t of qTokens) qtf.set(t, (qtf.get(t) || 0) + 1);
    for (const [t, qf] of qtf) {
      const m = post.get(t); if (!m) continue;
      for (const [di, f] of m) score[di] += f * qf;
    }
    for (let i = 0; i < N; i++) score[i] /= Math.sqrt(docLen[i] || 1);
    return score;
  };

  const tfidfCos = (qTokens, idfFn) => {
    const score = new Array(N).fill(0);
    const qtf = new Map();
    for (const t of qTokens) qtf.set(t, (qtf.get(t) || 0) + 1);
    for (const [t, qf] of qtf) {
      const m = post.get(t); if (!m) continue;
      const w = idfFn(N, m.size);
      for (const [di, f] of m) score[di] += (f * w) * (qf * w);
    }
    for (let i = 0; i < N; i++) score[i] /= Math.sqrt(docLen[i] || 1);
    return score;
  };

  const bm25 = (qTokens, k1, b, opts = {}) => {
    const { idf = 'lucene', variant = 'bm25', delta = 0 } = opts;
    const score = new Array(N).fill(0);
    for (const t of new Set(qTokens)) {
      const m = post.get(t); if (!m) continue;
      const w = idf === 'lucene' ? idfLucene(N, m.size) : idf === 'lvzhai' ? idfLvZhai(N, m.size) : 1;
      for (const [di, f] of m) {
        const K = k1 * (1 - b + b * (docLen[di] / avgdl));
        const norm = f / (1 - b + b * (docLen[di] / avgdl));
        let s;
        if (variant === 'bm25') s = (f * (k1 + 1)) / (f + K);
        else if (variant === 'bm25plus') s = (f * (k1 + 1)) / (f + K) + delta;
        else s = ((norm + delta) * (k1 + 1)) / (k1 + norm + delta);
        score[di] += w * s;
      }
    }
    return score;
  };

  return { tfCos, tfidfCos, bm25 };
}

function evaluate(scoreFn) {
  let rrSum = 0, p1 = 0, r3 = 0, ndcg = 0;
  const per = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const targets = TRUTH[qi];
    const s = scoreFn(queries[qi].q);
    const order = s.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    let first = Infinity, dcg = 0;
    for (let r = 0; r < order.length && r < 10; r++) {
      const di = order[r][1];
      if (targets.has(di)) { if (r + 1 < first) first = r + 1; dcg += 1 / Math.log2(r + 2); }
    }
    const idcg = [...Array(Math.min(10, targets.size)).keys()].reduce((a, r) => a + 1 / Math.log2(r + 2), 0);
    rrSum += first === Infinity ? 0 : 1 / first;
    if (first === 1) p1++;
    if (first <= 3) r3++;
    ndcg += dcg / idcg;
    per.push({ q: queries[qi].q, rr: first === Infinity ? 0 : 1 / first, rank: first });
  }
  return { mrr: rrSum / queries.length, p1: p1 / queries.length, r3: r3 / queries.length, ndcg: ndcg / queries.length, per };
}

function fmt(name, r) { console.log(name.padEnd(26), r.mrr.toFixed(4), r.p1.toFixed(3), r.r3.toFixed(3), r.ndcg.toFixed(4)); }

const idxB = buildIndex('bigram');
const idxU = buildIndex('unigram');
const idxBU = buildIndex('bigram+unigram');
const SB = makeScorers(idxB), SU = makeScorers(idxU), SBU = makeScorers(idxBU);

const rows = {};
console.log(`语料 ${corpus.length} 条 / 查询 ${queries.length} 条 / 单条均长 ${(idxB.docLen.reduce((a, b) => a + b, 0) / corpus.length).toFixed(1)} bigram`);
console.log('');
console.log('system'.padEnd(26), 'MRR@10  P@1    R@3    nDCG@10');

const R = (key, name, fn) => { const r = evaluate(fn); rows[key] = r; fmt(name, r); };

R('tfcos', 'TF 余弦 (现状,bigram)', q => SB.tfCos(tokenize(q, 'bigram')));
R('tfidf', 'TF·IDF 余弦 (bigram)', q => SB.tfidfCos(tokenize(q, 'bigram'), idfLucene));
R('bm25noidf', 'BM25 无IDF (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 1.2, 0.75, { idf: 'none' }));
R('bm25', 'BM25 1.2/0.75 (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 1.2, 0.75));
R('bm25kb', 'BM25 0.9/0.5 (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 0.9, 0.5));
R('bm25b3', 'BM25 b=0.3 (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 1.2, 0.3));
R('bm25b0', 'BM25 b=0 (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 1.2, 0));
R('bm25k5', 'BM25 k1=5 (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 5, 0.75));
R('bm25p', 'BM25+ δ=1 (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 1.2, 0.75, { variant: 'bm25plus', delta: 1 }));
R('bm25l', 'BM25L δ=0.5 (bigram)', q => SB.bm25(tokenize(q, 'bigram'), 1.2, 0.75, { variant: 'bm25l', delta: 0.5, idf: 'lvzhai' }));
R('tfcos_u', 'TF 余弦 (unigram)', q => SU.tfCos(tokenize(q, 'unigram')));
R('tfidf_u', 'TF·IDF 余弦 (unigram)', q => SU.tfidfCos(tokenize(q, 'unigram'), idfLucene));
R('bm25_u', 'BM25 1.2/0.75 (unigram)', q => SU.bm25(tokenize(q, 'unigram'), 1.2, 0.75));
R('bm25_bu', 'BM25 (bigram+unigram)', q => SBU.bm25(tokenize(q, 'bigram+unigram'), 1.2, 0.75));
R('hybrid', 'BM25 bi + 0.5×uni', q => {
  const a = SB.bm25(tokenize(q, 'bigram'), 1.2, 0.75);
  const b = SU.bm25(tokenize(q, 'unigram'), 1.2, 0.75);
  return a.map((v, i) => v + 0.5 * b[i]);
});

function signTest(a, b) {
  let win = 0, lose = 0, tie = 0;
  for (let i = 0; i < a.length; i++) {
    if (b[i].rr > a[i].rr + 1e-9) win++;
    else if (b[i].rr < a[i].rr - 1e-9) lose++;
    else tie++;
  }
  const n = win + lose;
  const z = n ? (win - n / 2) / Math.sqrt(n / 4) : 0;
  return { win, lose, tie, z, p: n ? 2 * (1 - normCdf(Math.abs(z))) : 1 };
}

console.log('');
const st = signTest(rows.tfcos.per, rows.bm25.per);
console.log(`符号检验 TF余弦 vs BM25：BM25 胜 ${st.win} / 负 ${st.lose} / 平 ${st.tie}，z=${st.z.toFixed(2)}，p≈${st.p.toFixed(3)}`);
const st2 = signTest(rows.bm25.per, rows.bm25_u.per);
console.log(`符号检验 BM25(bigram) vs BM25(unigram)：uni 胜 ${st2.win} / 负 ${st2.lose} / 平 ${st2.tie}，z=${st2.z.toFixed(2)}，p≈${st2.p.toFixed(3)}`);
const st3 = signTest(rows.bm25noidf.per, rows.bm25.per);
console.log(`符号检验 BM25 无IDF vs 有IDF：(有IDF) 胜 ${st3.win} / 负 ${st3.lose} / 平 ${st3.tie}，z=${st3.z.toFixed(2)}，p≈${st3.p.toFixed(3)}`);

const pairs = [
  ['TF余弦', 'tfcos', 'BM25', 'bm25'],
  ['BM25', 'bm25', 'BM25 b=0', 'bm25b0'],
  ['BM25', 'bm25', 'BM25(uni)', 'bm25_u'],
  ['TF余弦', 'tfcos', 'BM25 b=0', 'bm25b0'],
  ['TF余弦(uni)', 'tfcos_u', 'BM25(uni)', 'bm25_u'],
  ['TF余弦(uni)', 'tfcos_u', 'TF·IDF(uni)', 'tfidf_u'],
  ['TF余弦', 'tfcos', 'TF·IDF(余弦)', 'tfidf']
];
console.log('');
console.log('配对 bootstrap（10000 次重采样查询，95% CI）:');
for (const [na, ka, nb, kb] of pairs) {
  const d = bootstrapDelta(rows[ka].per, rows[kb].per);
  console.log(`  ${nb} - ${na}`.padEnd(28), `ΔMRR=${d.mean.toFixed(4)}  [${d.lo.toFixed(4)}, ${d.hi.toFixed(4)}]`,
    d.lo > 0 || d.hi < 0 ? '→ 显著' : '→ 不显著');
}

console.log('');
console.log('名次有差异的查询（TF余弦 → BM25）：');
rows.tfcos.per.forEach((b, i) => {
  const c = rows.bm25.per[i];
  const a = b.rank === Infinity ? 99 : b.rank;
  const d = c.rank === Infinity ? 99 : c.rank;
  if (a !== d) console.log('  ' + b.q.padEnd(30), String(a).padStart(2), '->', String(d).padStart(2));
});

function bootstrapDelta(a, b) {
  const n = a.length;
  const deltas = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let it = 0; it < 10000; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rnd() * n);
      s += b[j].rr - a[j].rr;
    }
    deltas.push(s / n);
  }
  deltas.sort((x, y) => x - y);
  const mean = deltas.reduce((x, y) => x + y, 0) / deltas.length;
  return { mean, lo: deltas[Math.floor(0.025 * deltas.length)], hi: deltas[Math.floor(0.975 * deltas.length)] };
}

function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  return s * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}
