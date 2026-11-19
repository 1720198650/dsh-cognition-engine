export interface RawComment {
    text: string;
    likes: number;
}
/** BV 号 → aid。已经给 aid 时不用调。 */
export declare function resolveAid(bvid: string): Promise<number>;
/**
 * 取一页评论（按热度排序）。
 *
 * 只要一级评论，不展开楼中楼：楼中楼多是互怼，且上下文缺失后语义容易误会。
 */
export declare function fetchComments(aid: number, page?: number, pageSize?: number): Promise<RawComment[]>;
