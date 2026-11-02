/**
 * client.js — 页面可视化（Client 半区）
 *
 * 输入框下方一条状态条；点开有五页：状态 / 待办 / 记忆 / 图式 / 设置。
 * 计数每 2 秒轮询 /cognition-engine/state；明细只在展开时拉 /cognition-engine/detail。
 * 设置页可以清空数据、开关真模型、上锁并填口令。全部走 HTTP，不进模型上下文。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cognition-engine',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const DICT = {
      zh: {
        name: '认知引擎',
        energy: '能量',
        favor: '好感',
        memory: '记忆',
        schema: '图式',
        todo: '待办',
        state: '状态',
        settings: '设置',
        connecting: '连接中…',
        offline: '无数据',
        tasks: '待办',
        memories: '记忆',
        schemas: '图式',
        refresh: '刷新',
        close: '收起',
        empty: '暂无内容',
        current: '当前',
        superseded: '已取代',
        members: '成员',
        links: '邻接',
        clues: '线索',
        updated: '更新于',
        overdue: '超时',
        loading: '加载中…',
        noDetail: '明细加载失败',
        testData: '测试',
        why: '为什么',
        means: '说明',
        label: '状态标签',
        noTime: '本进程内时间没有推进过：这两个数只会被事件改变，不会自己变。',
        storage: '存储位置',
        clear: '清空',
        clearMemory: '清空记忆',
        clearAll: '清空全部',
        realModel: '反思引擎',
        realMode: '真实模型',
        localMode: '本地模拟',
        realModelHint: '默认本地模拟；切到真实模型会调用宿主配置的模型服务。',
        lockHint: '开启后，读取记忆正文的接口需要口令；计数接口不受影响。',
        on: '开',
        off: '关',
        unavailable: '不可用（未找到模型）',
        lock: '记忆读取锁',
        lockOn: '开启访问锁',
        locked: '已开启',
        unlocked: '已关闭',
        unlock: '关闭访问锁',
        token: '访问口令',
        applyToken: '保存口令',
        cleared: '已清空',
      },
      en: {
        name: 'Cognition',
        energy: 'Energy',
        favor: 'Favor',
        memory: 'Memory',
        schema: 'Schemas',
        todo: 'Tasks',
        state: 'State',
        settings: 'Settings',
        connecting: 'Connecting…',
        offline: 'No data',
        tasks: 'Tasks',
        memories: 'Memories',
        schemas: 'Schemas',
        refresh: 'Refresh',
        close: 'Close',
        empty: 'Nothing here',
        current: 'current',
        superseded: 'superseded',
        members: 'members',
        links: 'links',
        clues: 'clues',
        updated: 'updated',
        overdue: 'overdue',
        loading: 'Loading…',
        noDetail: 'Detail unavailable',
        testData: 'test',
        why: 'Why',
        means: 'Meaning',
        label: 'Label',
        noTime: 'Time never advanced in this process: these values change only on events.',
        storage: 'Storage',
        clear: 'Clear',
        clearMemory: 'Memory',
        clearAll: 'All',
        realModel: 'Reflection engine',
        realMode: 'Real model',
        localMode: 'Local simulation',
        realModelHint: 'Local simulation by default; switching to a real model calls the host-configured model service.',
        lockHint: 'When on, reading memory content requires a token; the counts endpoint stays public.',
        on: 'On',
        off: 'Off',
        unavailable: 'unavailable (no model)',
        lock: 'Memory read lock',
        lockOn: 'Turn lock on',
        locked: 'On',
        unlocked: 'Off',
        unlock: 'Turn lock off',
        token: 'Access token',
        applyToken: 'Save token',
        cleared: 'Cleared',
      },
    };

    function pickDict(ctx) {
      let id = 'zh';
      try {
        const snap = ctx && ctx.locale && typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : null;
        id = (snap && (snap.id || snap.locale || snap.language)) || 'zh';
      } catch {
        id = 'zh';
      }
      return String(id).toLowerCase().startsWith('en') ? DICT.en : DICT.zh;
    }

    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: 6 },
      row: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '4px 12px',
        fontSize: 11,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)',
        userSelect: 'none',
        cursor: 'pointer',
        borderRadius: 6,
        padding: '2px 4px',
        margin: '-2px -4px',
      },
      group: { display: 'inline-flex', alignItems: 'center', gap: 6 },
      name: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
      track: {
        position: 'relative',
        width: 56,
        height: 6,
        borderRadius: 3,
        background: 'var(--dsw-alias-bg-layer-2)',
        overflow: 'hidden',
      },
      fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
      value: { color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
      sep: { opacity: 0.45 },
      caret: { fontSize: 9, opacity: 0.7, marginLeft: 2 },
      panel: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-overlay)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        overflow: 'hidden',
      },
      tabs: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      tab: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 6,
        cursor: 'pointer',
      },
      tabActive: {
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontWeight: 600,
      },
      action: {
        marginLeft: 'auto',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        cursor: 'pointer',
        padding: '3px 6px',
        borderRadius: 6,
      },
      list: { maxHeight: 280, overflowY: 'auto', padding: '2px 0' },
      item: {
        padding: '6px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      },
      itemTitle: {
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11.5,
        lineHeight: '16px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      },
      meta: { fontSize: 10.5, opacity: 0.75, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
      explain: { fontSize: 10.5, opacity: 0.82, lineHeight: '15px', whiteSpace: 'normal' },
      chip: {
        display: 'inline-block',
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid currentColor',
        fontSize: 10,
        lineHeight: '15px',
      },
      clue: { fontSize: 10.5, opacity: 0.8, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l2)' },
      empty: { padding: '14px 10px', textAlign: 'center', opacity: 0.7 },
      input: {
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        fontSize: 11,
        padding: '2px 6px',
        width: 130,
      },
    };

    function ago(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '';
      const minute = 60000;
      if (ms < minute) return '刚刚';
      if (ms < 60 * minute) return `${Math.round(ms / minute)} 分钟前`;
      if (ms < 24 * 60 * minute) return `${Math.round(ms / (60 * minute))} 小时前`;
      return `${Math.round(ms / (24 * 60 * minute))} 天前`;
    }

    function Bar(props) {
      const ratio = Math.max(0, Math.min(1, props.ratio));
      return h(
        'span',
        { style: S.track, role: 'img', 'aria-label': `${props.label} ${Math.round(ratio * 100)}%` },
        h('span', { style: { ...S.fill, width: `${ratio * 100}%`, background: props.color } }),
      );
    }

    function createDock(ctx) {
      return function MoodDock() {
        const [state, setState] = React.useState(null);
        const [failure, setFailure] = React.useState(null);
        const [open, setOpen] = React.useState(false);
        const [tab, setTab] = React.useState('summary');
        const [detail, setDetail] = React.useState(null);
        const [detailError, setDetailError] = React.useState(null);
        const [tick, setTick] = React.useState(0);
        const [token, setToken] = React.useState(() => {
          try {
            return localStorage.getItem('cognition-token') || '';
          } catch {
            return '';
          }
        });
        const [tokenDraft, setTokenDraft] = React.useState('');
        const [notice, setNotice] = React.useState('');
        const dict = pickDict(ctx);

        const call = (path, init) =>
          fetch(path, {
            ...(init || {}),
            headers: {
              ...((init && init.headers) || {}),
              ...(token ? { 'x-cognition-token': token } : {}),
            },
          });

        const rememberToken = (value) => {
          setToken(value);
          try {
            if (value) localStorage.setItem('cognition-token', value);
            else localStorage.removeItem('cognition-token');
          } catch {
            /* 无痕模式忽略 */
          }
        };

        const post = async (path) => {
          setNotice('');
          try {
            const response = await call(path, { method: 'POST' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            if (data.token) rememberToken(data.token);
            if (data.cleared) setNotice(`${dict.cleared}：${data.cleared}`);
            setTick((value) => value + 1);
          } catch (error) {
            setNotice(`✗ ${error instanceof Error ? error.message : String(error)}`);
          }
        };

        React.useEffect(() => {
          let alive = true;
          const load = async () => {
            try {
              const response = await call('/cognition-engine/state', { cache: 'no-store' });
              if (!response.ok) {
                if (alive) setFailure(`HTTP ${response.status}`);
                return;
              }
              const next = await response.json();
              if (alive) {
                setState(next);
                setFailure(null);
              }
            } catch {
              if (alive) setFailure('offline');
            }
          };
          load();
          const timer = setInterval(load, 2000);
          return () => {
            alive = false;
            clearInterval(timer);
          };
        }, [token]);

        React.useEffect(() => {
          if (!open) return undefined;
          let alive = true;
          setDetailError(null);
          (async () => {
            try {
              const response = await call('/cognition-engine/detail', { cache: 'no-store' });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const next = await response.json();
              if (alive) setDetail(next);
            } catch (error) {
              if (alive) setDetailError(error instanceof Error ? error.message : String(error));
            }
          })();
          return () => {
            alive = false;
          };
        }, [open, tick, token]);

        const toggle = () => setOpen((value) => !value);

        if (!state) {
          return h(
            'div',
            { style: S.row, title: failure || '' },
            h('span', { style: { ...S.group, ...S.name } }, dict.name),
            h('span', null, failure ? `${dict.offline} (${failure})` : dict.connecting),
          );
        }

        const memoryCount = (state.memory || {}).total || 0;
        const schemaCount = (state.graph || {}).schemas || 0;
        const taskCount = (state.tasks || {}).pending || 0;
        const samples = state.samples || 0;

        const row = h(
          'div',
          {
            style: S.row,
            role: 'button',
            tabIndex: 0,
            'aria-expanded': open,
            title: open ? dict.close : `${dict.tasks} / ${dict.memories} / ${dict.schemas}`,
            onClick: toggle,
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
              }
            },
          },
          h('span', { style: { ...S.group, ...S.name } }, dict.name),
          h('span', { style: S.sep }, '·'),
          h('span', null, `${dict.memory} ${memoryCount}`),
          h('span', { style: S.sep }, '·'),
          h('span', null, `${dict.schema} ${schemaCount}`),
          h('span', { style: S.sep }, '·'),
          h('span', null, `${dict.todo} ${taskCount}`),
          samples > 0
            ? h(
                'span',
                { style: { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 } },
                `⚠ ${dict.testData} ${samples}`,
              )
            : null,
          h('span', { style: S.caret }, open ? '▾' : '▸'),
        );

        if (!open) return h('div', { style: S.root }, row);

        const tabs = [
          ['summary', dict.state],
          ['tasks', `${dict.tasks} ${detail ? detail.tasks.length : ''}`.trim()],
          ['memories', `${dict.memories} ${detail ? detail.memories.length : ''}`.trim()],
          ['schemas', `${dict.schemas} ${detail ? detail.schemas.length : ''}`.trim()],
          ['settings', dict.settings],
        ];

        /** 统一的「标题 + 一行元信息」块，设置页三行都用它。 */
        const section = (title, ...meta) =>
          h(
            'div',
            { style: S.item },
            h('div', { style: S.itemTitle }, title),
            h('div', { style: S.meta }, ...meta),
          );

        /** 列表页统一：空态或映射。 */
        const renderList = (items, render) =>
          items.length === 0 ? h('div', { style: S.empty }, dict.empty) : items.map(render);

        let body;
        if (tab === 'settings') {
          const button = (label, onClick) => h('button', { type: 'button', style: S.tab, onClick }, label);
          const model = state.model || {};
          body = h(
            'div',
            null,
            section(
              `${dict.storage}：${(state.storage || {}).state || '-'}`,
              h('span', null, `${dict.clear}：`),
              button(dict.clearMemory, () => post('/cognition-engine/clear?scope=memory')),
              button(dict.clearAll, () => post('/cognition-engine/clear?scope=all')),
            ),
            section(
              `${dict.realModel}：${model.enabled ? dict.realMode : dict.localMode}`,
              h('span', null, model.available ? `${model.provider}/${model.model}` : dict.unavailable),
              button(
                model.enabled ? `切换到${dict.localMode}` : `切换到${dict.realMode}`,
                () => post(`/cognition-engine/model?enabled=${model.enabled ? 'false' : 'true'}`),
              ),
              h('div', { style: S.explain }, dict.realModelHint),
            ),
            section(
              `${dict.lock}：${state.locked ? dict.locked : dict.unlocked}`,
              button(state.locked ? dict.unlock : dict.lockOn, () =>
                post(`/cognition-engine/lock?enabled=${state.locked ? 'false' : 'true'}`),
              ),
              h('input', {
                value: tokenDraft,
                placeholder: dict.token,
                onChange: (event) => setTokenDraft(event.target.value),
                style: S.input,
              }),
              button(dict.applyToken, () => {
                rememberToken(tokenDraft.trim());
                setNotice('');
                setTick((value) => value + 1);
              }),
              h('div', { style: S.explain }, dict.lockHint),
            ),
            notice ? h('div', { style: S.explain }, notice) : null,
          );
        } else if (detailError !== null) {
          body = h('div', { style: S.empty }, `${dict.noDetail} (${detailError})`);
        } else if (!detail) {
          body = h('div', { style: S.empty }, dict.loading);
        } else if (tab === 'summary') {
          body = h(
            'div',
            null,
            h('div', { style: S.item }, h('div', { style: S.itemTitle }, `${dict.memory} ${(detail.counts || {}).memories || 0}`)),
            h('div', { style: S.item }, h('div', { style: S.itemTitle }, `${dict.schema} ${(detail.counts || {}).schemas || 0}`)),
            h('div', { style: S.item }, h('div', { style: S.itemTitle }, `${dict.tasks} ${(detail.counts || {}).tasks || 0}`)),
          );
        } else if (tab === 'tasks') {
          body = renderList(detail.tasks, (task) => {
                  const color =
                    task.status === 'COMPLETED'
                      ? 'var(--dsw-alias-state-success-primary)'
                      : task.status === 'IN_PROGRESS'
                        ? 'var(--dsw-alias-brand-primary)'
                        : 'var(--dsw-alias-label-secondary)';
                  const overdue = task.status !== 'COMPLETED' && task.overdueMs > 6 * 3600 * 1000;
                  return h(
                    'div',
                    { key: task.id, style: S.item },
                    h('div', { style: S.itemTitle }, task.description),
                    h(
                      'div',
                      { style: S.meta },
                      h('span', { style: { ...S.chip, color } }, task.status),
                      h('span', null, task.id),
                      h('span', null, `${dict.updated} ${ago(task.overdueMs)}`),
                      h('span', null, `${dict.clues} ${task.context.length}`),
                      overdue
                        ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, dict.overdue)
                        : null,
                    ),
                    task.context.length > 0
                      ? h('div', { style: S.clue }, task.context[task.context.length - 1])
                      : null,
                  );
                });
        } else if (tab === 'memories') {
          body = renderList(detail.memories, (item) =>
                  h(
                    'div',
                    { key: item.id, style: S.item },
                    h('div', { style: S.itemTitle }, item.content),
                    h(
                      'div',
                      { style: S.meta },
                      h(
                        'span',
                        {
                          style: {
                            ...S.chip,
                            color:
                              item.source === 'test'
                                ? 'var(--dsw-alias-state-warn-primary)'
                                : item.source === 'user'
                                  ? 'var(--dsw-alias-state-success-primary)'
                                  : 'var(--dsw-alias-label-secondary)',
                          },
                        },
                        item.source,
                      ),
                      h(
                        'span',
                        {
                          style: {
                            ...S.chip,
                            color: item.current
                              ? 'var(--dsw-alias-state-success-primary)'
                              : 'var(--dsw-alias-label-secondary)',
                          },
                        },
                        item.current ? dict.current : dict.superseded,
                      ),
                      h('span', null, item.subject),
                      h('span', null, item.id),
                      h('span', null, `${item.chars} 字`),
                      item.tags.length > 0 ? h('span', null, item.tags.join(' · ')) : null,
                    ),
                  ),
                );
        } else {
          body = renderList(detail.schemas, (item) =>
                  h(
                    'div',
                    { key: item.id, style: S.item },
                    h('div', { style: S.itemTitle }, item.label),
                    h(
                      'div',
                      { style: S.meta },
                      h('span', null, item.id),
                      h('span', null, `${dict.members} ${item.members}`),
                      h('span', null, `${dict.links} ${item.neighbors}`),
                      h('span', null, item.polarity >= 0 ? '极性 +' : '极性 −'),
                    ),
                  ),
                );
        }

        const panel = h(
          'div',
          { style: S.panel, role: 'dialog', 'aria-label': dict.name },
          h(
            'div',
            { style: S.tabs },
            tabs.map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  style: key === tab ? { ...S.tab, ...S.tabActive } : S.tab,
                  onClick: () => setTab(key),
                },
                label,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                style: S.action,
                onClick: (event) => {
                  event.stopPropagation();
                  setTick((value) => value + 1);
                },
              },
              dict.refresh,
            ),
            h(
              'button',
              {
                type: 'button',
                style: S.action,
                onClick: (event) => {
                  event.stopPropagation();
                  setOpen(false);
                },
              },
              dict.close,
            ),
          ),
          h('div', { style: S.list }, body),
        );

        return h('div', { style: S.root }, row, panel);
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 降级：手机端或精简渲染层可能没有 slots 服务，此时不显示状态条，但不影响插件其他功能
        if (!ctx || !ctx.slots || typeof ctx.slots.register !== 'function') {
          return;
        }
        try {
          const Dock = createDock(ctx);
          ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register(
              { name: 'conversation.composer.dock', id: 'cognition-mood', order: 6 },
              Dock,
            ),
          );
        } catch (error) {
          // 槽位被占用或宿主不支持：静默跳过，工具与记忆功能不受影响
          if (ctx.logger && typeof ctx.logger.warn === 'function') {
            ctx.logger.warn('cognition-engine: 状态条槽位注册失败，已降级为不显示');
          }
        }
      },
    };
  },
});
