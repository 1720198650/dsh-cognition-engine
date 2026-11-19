/**
 * src/voice_source.ts — 从 B 站公开接口取评论作为语感样本。
 *
 * 只读、只用公开接口、不登录、不点赞、不发评论。
 * 知乎/贴吧未有公开接口且对匿名访问返回 403，这里不做绕过（2026-11-19 实测）。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const TIMEOUT_MS = 15_000;
async function getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': UA,
                Accept: 'application/json',
                // 不带头时评论接口偶发 -400（实测 2026-11-19）
                Referer: 'https://www.bilibili.com/',
            },
            signal: controller.signal,
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return (await res.json());
    }
    finally {
        clearTimeout(timer);
    }
}
/** BV 号 → aid。已经给 aid 时不用调。 */
export async function resolveAid(bvid) {
    if (!/^BV[0-9A-Za-z]{8,12}$/.test(bvid))
        throw new Error('BV 号格式不对：' + bvid);
    const json = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    if (Number(json.code) !== 0)
        throw new Error('B站接口返回 code=' + String(json.code));
    const data = json.data;
    const aid = Number(data?.aid ?? 0);
    if (aid <= 0)
        throw new Error('拿不到 aid');
    return aid;
}
/**
 * 取一页评论（按热度排序）。
 *
 * 只要一级评论，不展开楼中楼：楼中楼多是互怼，且上下文缺失后语义容易误会。
 */
export async function fetchComments(aid, page = 1, pageSize = 20) {
    const url = `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=${page}&ps=${pageSize}&sort=2`;
    const json = await getJson(url);
    if (Number(json.code) !== 0)
        throw new Error('评论接口返回 code=' + String(json.code));
    const data = json.data;
    const replies = Array.isArray(data?.replies) ? data?.replies ?? [] : [];
    return replies
        .map((reply) => ({
        text: String(reply.content?.message ?? '').replace(/\s+/g, ' ').trim(),
        likes: Number(reply.like ?? 0),
    }))
        .filter((item) => item.text.length > 0);
}
