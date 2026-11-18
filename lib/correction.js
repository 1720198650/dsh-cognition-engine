/**
 * src/correction.ts — 「你觉得不对」的识别（自动学习链的扳机）。
 *
 * 为什么扳机必须来自用户原话：
 * Huang et al. 2024 实测，没有外部反馈的自我修订越改越差
 * （Llama-2 CommonSenseQA 62.0 → 36.5）。所以这个模块只做一件事：
 * **判断这句话是不是在纠正我**，并且把可核对的原话抓出来当锚。
 *
 * 不做的事：不判断"谁对谁错"（那是反思环节）、不自己触发修订（要过门槛）。
 */
/** 中文里的纠正句式：否定 + 更正的组合最常见。 */
const CN_PATTERNS = [
    { name: '不是这样', re: /(不是这样|不对|错了|搞错|弄错|说错|理解错)/, hint: 'unknown' },
    { name: '我说的是', re: /(我说的是|我的意思是|我要的是|我说过)/, hint: 'unknown' },
    { name: '应该/要改', re: /(应该|应当|得|要)(改成|改|用|写|做|先|再)/, hint: 'rule' },
    { name: '别/不要', re: /(别|不要|不能再|不许)(再)?(只|光|直接|自己|随便)?/, hint: 'rule' },
    { name: '事实更正', re: /(其实是|实际上是|真实是|正确的是|正确的应该是)/, hint: 'fact' }
];
const EN_PATTERNS = [
    { name: 'no-wrong', re: /\b(that's wrong|not right|incorrect|you'?re wrong|mistaken)\b/i, hint: 'unknown' },
    { name: 'i-said', re: /\b(i said|what i meant|i meant|i asked for)\b/i, hint: 'unknown' },
    { name: 'should', re: /\b(should|must|need to)\s+(use|write|do|run|be)\b/i, hint: 'rule' },
    { name: 'dont', re: /\b(don'?t|do not|never)\s+\w+/i, hint: 'rule' },
    { name: 'actually', re: /\b(actually|in fact|the correct)\b/i, hint: 'fact' }
];
/**
 * 识别纠正信号。
 *
 * 门槛刻意压低（一句话里出现"不对/错了/我说的是"就算），因为：
 * 漏判的代价 = 我继续错；误判的代价 = 多生成一条候选，你点一下丢弃。
 * 但**证据门槛不在这里**——这里只负责发现，改不改由 autorevise 的门槛决定。
 */
export function detectCorrection(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 4)
        return { corrected: false, quote: '', hint: 'unknown', matched: '' };
    for (const pattern of [...CN_PATTERNS, ...EN_PATTERNS]) {
        if (!pattern.re.test(clean))
            continue;
        return {
            corrected: true,
            // 原话直接当锚：最长 200 字，避免把整段对话都塞进锚
            quote: clean.slice(0, 200),
            hint: pattern.hint,
            matched: pattern.name,
        };
    }
    return { corrected: false, quote: '', hint: 'unknown', matched: '' };
}
/**
 * 反思提示词：只问两件事——我原来错在哪、以后该按什么做。
 *
 * 不给模型"要不要改"的决定权（那是门槛的事），也不让它自己找新证据
 * （那是联网环节的事），只让它把用户这句话翻译成一条可执行的诊断。
 */
export function buildCorrectionPrompt(input) {
    return [
        '用户刚纠正了你。请只输出一个 JSON 对象，不要解释、不要 markdown 代码块：',
        '{"wrong":"我原来哪里错了（一句话，具体到行为）","diagnosis":"错因（为什么会产生这个错误）","rule":"以后该怎么做（一句可执行的规矩，不要空话）"}',
        '',
        '要求：',
        '- wrong 要写我实际做的事，不要写"我的理解有偏差"这类废话。',
        '- rule 必须能直接用来判断下次该不该这样做；写不出就返回空字符串。',
        input.subject === undefined ? '' : '限定主题：' + input.subject,
        '',
        '用户原话：',
        input.correction
    ]
        .filter((line) => line.length > 0)
        .join('\n');
}
/** 解析反思输出；解析不出来就返回空 rule，调用方降级为只记候选。 */
export function parseCorrectionResult(raw) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start)
        return { wrong: '', diagnosis: '', rule: '' };
    try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        const pick = (key) => (typeof parsed[key] === 'string' ? parsed[key].trim() : '');
        return { wrong: pick('wrong'), diagnosis: pick('diagnosis'), rule: pick('rule') };
    }
    catch {
        return { wrong: '', diagnosis: '', rule: '' };
    }
}
