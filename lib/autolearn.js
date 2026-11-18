/**
 * src/autolearn.ts — 「工作 → 你觉得不对 → 反思 → 自动联网学习 → 解决问题」的确定性零件。
 *
 * 这一层只做**不调模型**的部分：把一段纠正/缺口变成检索词、从搜索结果里挑值得抓的、
 * 记录每次自动学习干了什么（可审计、可回滚）。模型调用与抓取在 index.ts 里。
 *
 * 三条硬约束（用户 2026-11-18 定）：
 *   1. 自动联网默认关，面板有开关；
 *   2. 自动修订默认关，且**必须留修改前存档**；
 *   3. 自动学到的东西一律带出处（url + 来源 id），不写"无来源的事实"。
 */
/** 检索词：把用户/缺口的一句话压成 1~2 个能搜的短句。 */
export function buildSearchQueries(text, maxQueries = 2) {
    const clean = text
        .replace(/^(我|你|我们|刚才|这个|那个|这事)/g, '')
        .replace(/[，。；：、！？,.!?;:]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (clean.length === 0)
        return [];
    const out = [];
    // 第一版：整句（去掉语气词）；第二版：前 24 字的片段，避免长句搜不到
    out.push(clean.slice(0, 40));
    if (clean.length > 16) {
        const head = clean.slice(0, 24).trim();
        if (head.length > 0 && head !== out[0])
            out.push(head);
    }
    return out.slice(0, Math.max(1, maxQueries));
}
/**
 * 从搜索结果里挑要抓的链接。
 *
 * 只挑 http(s)、跳过明显是聚合页/下载页的 URL；同一域名最多取 1 条，
 * 免得一次自动学习把同一个站抓一堆。按"有没有摘要/标题长度"排序。
 */
export function pickSources(sources, limit = 2, perHost = 1) {
    const seenHost = new Map();
    const scored = [];
    for (const source of sources) {
        let host = '';
        let cleanUrl = source.url.trim();
        try {
            // 搜索 provider 常在 URL 尾巴挂 #1 / #2 这类引用序号，抓之前要摘掉
            cleanUrl = cleanUrl.replace(/#\d+$/, '');
            const url = new URL(cleanUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:')
                continue;
            host = url.hostname.toLowerCase();
            // 跳过压缩包/安装包/下载页：这些不是"资料"，抓回来也提炼不出东西
            if (/\.(zip|pdf|exe|dmg|apk|mp4|mp3|whl|tar|gz)$/i.test(url.pathname))
                continue;
            if (/(^|\/)(files|download|releases|diffs)(\/|$)/i.test(url.pathname))
                continue;
            if (/(pypi\.org|npmjs\.com|packagist\.org|mvnrepository\.com)/i.test(host) && /\/project\//i.test(url.pathname))
                continue;
        }
        catch {
            continue;
        }
        if (host.length === 0)
            continue;
        const text = `${source.title ?? ''} ${source.snippet ?? ''} ${source.summary ?? ''}`;
        // 有摘要的优先；标题太短的多半是首页
        const score = (source.summary === undefined ? 0 : 2) + (source.snippet === undefined ? 0 : 1) + Math.min(3, Math.floor(text.length / 60));
        scored.push({ source: { ...source, url: cleanUrl }, score, host });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = [];
    for (const item of scored) {
        if (out.length >= limit)
            break;
        const used = seenHost.get(item.host) ?? 0;
        if (used >= Math.max(1, perHost))
            continue;
        seenHost.set(item.host, used + 1);
        out.push(item.source);
    }
    return out;
}
