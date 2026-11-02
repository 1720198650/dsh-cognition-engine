/**
 * src/eval.ts — 评测台
 *
 * 四条来自开源评测项目的原则（lm-evaluation-harness / SWE-bench / Inspect / promptfoo）：
 *   1. 数据集与判分器分离：用例在 evals/cases.json，判分逻辑在 checkers 里。
 *   2. 判分器自检：内置一条「必然失败」的用例；它若通过，说明判分坏了，整场评测作废。
 *   3. 失败留 trace：打印期望值 / 实际值，而不是只说「挂了」。
 *   4. 基线对照：结果与 evals/baseline.json 逐条 diff，回答「改了之后是变好还是变坏」。
 *
 * 另外保留成本门禁：工具 schema 每轮固定开销、单次调用输出，都有硬预算。
 *
 * 运行：
 *   npm run eval           跟基线对比
 *   npm run eval -- --update   重写基线（只在确认变好之后用）
 *
 * 本文件不注册任何工具，不进入模型上下文，运行它本身不消耗 token。
 */
export {};
