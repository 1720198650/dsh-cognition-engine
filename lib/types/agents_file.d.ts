/**
 * src/agents_file.ts — 把「人格 + 准则本」同步进 `$DSH_HOME/AGENTS.md` 的受控块
 *
 * ## 为什么需要这条通道
 *
 * 实测（2026-11-08）：`dsh-superagent` 的执行器会话用的是 preset 声明的 agent 作用域，
 * 而 preset 里的插件**注册 `systemPrompt.section` 到不了该 agent 的提示**（注册隔离）——
 * 我们验证过 apply 执行了、服务拿得到、两段都注册成功，那条会话的系统提示里依旧没有。
 *
 * 但 `@deepseek-ai/dsh-agent-instructions` 会把 `$DSH_HOME/AGENTS.md`（user-global 链）
 * 读进**每一个** agent，worker 也不例外。所以只剩这一条可达通道。
 *
 * ## 为什么要「受控块」而不是直接写文件
 *
 * 那是用户的全局指令文件，里面可能有他自己写的东西。所以：
 *
 * 1. 只认 `<!-- cognition-engine:begin -->` … `<!-- cognition-engine:end -->` 之间；
 * 2. **标记外一个字都不动**；
 * 3. 文件不存在就新建，内容只有这一块；
 * 4. 标记残缺（只有一半）时不猜——把新块**追加**到末尾，并在结果里明确告知，绝不吞掉原文；
 * 5. 写入用「临时文件 + rename」，并返回旧内容，方便回滚。
 *
 * ## 默认关闭
 *
 * 它会改用户的文件，所以 `agentsFileSync` 默认 false。只有用户明确开启才会写。
 */
export declare const BEGIN_MARKER = "<!-- cognition-engine:begin -->";
export declare const END_MARKER = "<!-- cognition-engine:end -->";
/** 默认路径：`$DSH_HOME/AGENTS.md`，DSH_HOME 缺省 `~/.dsh`。 */
export declare function defaultAgentsFilePath(): string;
/** 把正文包成受控块。 */
export declare function wrapBlock(body: string): string;
/** 读出已存在的受控块正文；没有就返回 undefined。 */
export declare function readManagedBlock(content: string): string | undefined;
export interface UpsertResult {
    /** 合并后的完整文件内容。 */
    content: string;
    /** 是否真的变了（幂等：内容一样就不变）。 */
    changed: boolean;
    /**
     * 标记是否残缺（只找到一半）。
     * true 时新块被追加到末尾，**原文保留**——这是刻意的保守策略。
     */
    malformed: boolean;
}
/**
 * 把 `body` 合并进 `existing`（纯函数，不碰磁盘）。
 *
 * 四种情况：
 * - existing 为 null/空       → 只有受控块
 * - 有完整标记                → 只替换标记之间
 * - 标记残缺                  → 追加新块，原文保留，`malformed: true`
 * - 没有标记但有内容          → 追加到末尾（前面留一个空行）
 */
export declare function upsertManagedBlock(existing: string | null, body: string): UpsertResult;
export interface AgentsFileSyncOptions {
    filePath?: string;
    now?: () => number;
}
export interface SyncResult {
    ok: boolean;
    filePath: string;
    changed: boolean;
    malformed?: boolean;
    /** 写入前的旧内容（文件原本不存在则为 null），供回滚。 */
    previous?: string | null;
    reason?: string;
}
export declare class AgentsFileSync {
    private readonly filePath;
    constructor(options?: AgentsFileSyncOptions);
    get path(): string;
    /** 预览：算出合并结果，不写盘。 */
    preview(body: string): UpsertResult & {
        filePath: string;
        previous: string | null;
    };
    /** 真正写盘（临时文件 + rename）。失败返回 ok:false，不抛。 */
    apply(body: string): SyncResult;
    /** 回滚到给定内容；传 null 表示删掉文件（仅当确认是本次新建时才用）。 */
    rollback(previous: string | null): boolean;
}
