/**
 * 构建前清空 lib/。
 *
 * tsc 只增不删：删掉 src 里的文件后，lib 里对应的产物会一直留着，
 * 被打包发到 npm（v0.10.0 就这样带上了已删除的 graph.js）。
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

rmSync(resolve(import.meta.dirname, '..', 'lib'), { recursive: true, force: true });
