/**
 * client.js — 页面可视化（Client 半区）
 *
 * 两个入口：左侧栏图标打开整页面板；输入框上方横条展开为透明浮层。
 * 页签：任务 / 记忆 / 主题 / 设置。
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
        schema: '主题',
        todo: '任务',
        state: '状态',
        settings: '设置',
        connecting: '连接中…',
        offline: '无数据',
        tasks: '任务',
        memories: '记忆',
        schemas: '主题',
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
        storage: '数据文件',
        clear: '数据操作',
        clearMemory: '清空记忆',
        clearAll: '清空全部',
        rulesTitle: '记忆准入规则',
        ruleTransient: '忽略寒暄（ok / 谢谢 / 收到）',
        ruleSensitive: '拦截密钥与密码',
        ruleInjection: '拦截「忽略之前的指令」',
        ruleAuthority: '低权威不得覆盖高权威',
        consolidate: '合并同类记忆',
        backupTitle: '备份与审计',
        restoreLatest: '恢复最近快照',
        viewAudit: '查看最近审计',
        exportData: '导出',
        importData: '导入',
        realModel: '反思引擎',
        engineOff: '已关闭',
        engineLocal: '本地引擎',
        engineReal: '真实模型',
        autoReflectLabel: '巡逻时自动复盘',
        autoReflectOn: '开启（每次约 3100 tokens）',
        autoReflectOff: '关闭（只记录提示，不烧 token）',
        autoReflectHint: '巡视每 3 小时看一次逾期任务。开启后会自动跑一次三段式复盘（3 次模型调用，约 3100 tokens）；关闭后只把「已超期 N 小时」写进任务线索，不调用模型。手动调用 cognition_reflect 不受此开关影响。',
        effortLabel: '推理档位',
        effortAuto: '自动（最低档）',
        effortHint: '反思与蒸馏只需要按格式输出结果，不需要长链推理。当前模型会先吐很长的推理过程，而推理 token 和正文共用同一个输出预算——档位越高越容易把正文挤没，也就越贵。留「自动」时会选模型声明的最低档。',
        engineOffHint: '默认关闭：反思引擎会产生额外 token 消耗，需要时再开。',
        engineLocalHint: '本地引擎不调用模型，输出是固定模板，仅供参考。',
        engineRealHint: '真实模型会调用你当前配置的 AI 做三段式反思，消耗 token。',
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
        playbookTab: '准则',
        playbookPending: '待审',
        playbookActive: '已生效',
        playbookRetired: '已停用',
        playbookExpired: '已过期',
        playbookExtend: '延长',
        playbookConflict: '疑似冲突',
        playbookDelete: '删除',
        topicsHint: '主题 = 人定的适用范围键。记忆回答「发生过什么」，准则回答「应该怎么做」，主题回答「适用于哪类任务」。它不自动聚类——自动发现的主题不稳定，业界可编辑的主题几乎都是人定的容器。',
        topicAdd: '＋ 新建主题',
        topicName: '名称（如：发布流程）',
        topicDesc: '说明（这个主题管什么，用于匹配）',
        topicAliases: '别名（逗号分隔，如：发版,release）',
        topicSave: '保存',
        topicArchive: '停用',
        topicUnclassified: '未归类',
        topicUnclassifiedHint: '还没挂主题的记忆与准则。挂上主题后，注入时会按当前任务分组呈现。',
        topicEmpty: '还没有主题。点「新建主题」开始，或从记忆/准则上挂主题时自动提示。',
        topicAssign: '挂主题',
        subjectPick: '挂主题',
        subjectPickSave: '保存',
        subjectPickNone: '（还没有主题，先去主题页签新建）',
        taskAdd: '＋ 待办',
        taskPlaceholder: '这个主题下要做什么事？',
        taskSave: '保存',
        taskStart: '开始',
        taskDone: '完成',
        taskReopen: '重开',
        taskDelete: '删除',
        taskEmpty: '还没有待办',
        taskPENDING: '待办',
        taskIN_PROGRESS: '进行中',
        taskCOMPLETED: '已完成',
        topicAssignPrompt: '输入主题 id，逗号分隔（留空 = 移回未归类）。\n可用：',
        topicNone: '未挂主题',
        pbGuard: '自查',
        pbEnforce: '拦截',
        pbAudit: '审计',
        pbRules: '规则',
        pbOriginHuman: '用户确认',
        pbOriginAgent: 'AI 记录',
        pbWhen: '何时适用（一句话，如「发布版本时」）',
        pbTrigger: '触发条件（正则，匹配「工具名 + 参数 JSON」）',
        pbRequired: '必须满足（正则，空 = 触发即违反）',
        pbSaveRules: '保存规则',
        pbViolations: '违反',
        pbGuardHint: '自查：动手前要求模型先点名适用的准则',
        pbEnforceHint: '拦截：工具调用前校验，违反则直接拒绝',
        pbAuditHint: '审计：只记录违反，不拦截',
        playbookDistill: '重新蒸馏',
        playbookAccept: '接受',
        playbookReject: '拒绝',
        playbookRetire: '停用',
        playbookRevive: '恢复',
        playbookHint: '准则本 = 从记忆里蒸馏出的一页工作准则，常驻在每个会话的上下文里。它不存事实（那属于记忆），只存能改变下一步动作的约定、坑和当前状态。条目带 helpful/harmful 计数，长期没被用到的会自动退场。页签上的数字是「已生效条数」。',
        playbookAdd: '＋ 手动新增',
        playbookAddTitle: '新增准则',
        playbookContent: '内容（12–80 字，祈使句，写只有这个项目才知道的事）',
        playbookSection: '分节',
        playbookSave: '保存',
        playbookEmpty: '还没有准则。点「重新蒸馏」从记忆里提炼，或手动新增。',
        playbookNoModel: '需要先切到「真实模型」才能蒸馏',
        tasksHint: '任务：让 AI 跨会话记住「要接着做、还没做完」的事。它是给你俩共用的进度台账——你交代的事、或多轮才做得完的活记在这里，重启后还在；太久没动会被提醒，但不会打断你。它记的是「事」，不是聊天记录。',
        memoriesHint: '记忆：AI 跨会话能记住的事实。你说过的决定、约定、偏好都会存在这里，新会话自动带上摘要。改过的旧版本不删除，按时间能查到当时是怎么说的。',
        schemasHint: '主题：系统自动把内容相近的记忆归成一组，再给组分层。记忆多了以后，点开一个主题能看到所有相关的事；回忆时也会顺着主题把关联记忆一起带出来。记忆少于 10 条时这一页通常是空的。',
        needToken: '需要访问口令：打开插件目录下的 cognition-token.txt，把内容粘贴到下面',
      },
      en: {
        name: 'Cognition',
        energy: 'Energy',
        favor: 'Favor',
        memory: 'Memory',
        schema: 'Topics',
        todo: 'Tasks',
        state: 'State',
        settings: 'Settings',
        connecting: 'Connecting…',
        offline: 'No data',
        tasks: 'Tasks',
        memories: 'Memories',
        schemas: 'Topics',
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
        storage: 'Data file',
        clear: 'Data',
        clearMemory: 'Memory',
        clearAll: 'All',
        rulesTitle: 'Memory rules',
        ruleTransient: 'Ignore pleasantries',
        ruleSensitive: 'Block secrets',
        ruleInjection: 'Block instruction injection',
        ruleAuthority: 'Low authority cannot override',
        consolidate: 'Merge similar',
        exportData: 'Export',
        importData: 'Import',
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
        needToken: 'Access token required: open cognition-token.txt in the plugin folder and paste its content below',
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
      wideRoot: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        boxSizing: 'border-box',
      },
      widePanel: {
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: 8,
        width: '66%',
        minWidth: 420,
        maxWidth: 900,
        maxHeight: '60vh',
        overflowY: 'auto',
        padding: '14px 18px',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(28,28,32,0.92)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      panelRoot: {
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '20px 24px',
        height: '100%',
        overflowY: 'auto',
        maxWidth: 900,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      },
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

    function createDock(ctx, options) {
      return function MoodDock(props) {
        const opts = { ...(options || {}), ...(props || {}) };
        const [state, setState] = React.useState(null);
        const [failure, setFailure] = React.useState(null);
        const [open, setOpen] = React.useState(opts.defaultOpen === true);
        const [tab, setTab] = React.useState('tasks');
        const [formOpen, setFormOpen] = React.useState(null);
        const [editingId, setEditingId] = React.useState(null);
        const [expandedSchema, setExpandedSchema] = React.useState(null);
        // 毫秒 → datetime-local 需要的本地时间字符串
        const toLocalInput = (ms) => {
          const d = new Date(ms);
          const pad = (n) => String(n).padStart(2, '0');
          return (
            d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
          );
        };
        const [detail, setDetail] = React.useState(null);
        const [playbookData, setPlaybookData] = React.useState(null);
        const [pbFlagsFor, setPbFlagsFor] = React.useState(null);
        const [topicsData, setTopicsData] = React.useState(null);
        const [topicForm, setTopicForm] = React.useState(false);
        const [taskFormFor, setTaskFormFor] = React.useState(null);
        /** 当前展开「挂主题」面板的目标：{ targetType, id } */
        const [topicPick, setTopicPick] = React.useState(null);
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


        // 准则本单独取数：它和 /detail 是两条接口，只在打开该页签时拉。
        React.useEffect(() => {
          if (!open || tab !== 'playbook') return undefined;
          let alive = true;
          (async () => {
            try {
              const response = await call('/cognition-engine/playbook', { cache: 'no-store' });
              if (!response.ok) return;
              const next = await response.json();
              if (alive) setPlaybookData(next);
            } catch {
              /* 拉不到就保持上一次的数据 */
            }
          })();
          return () => {
            alive = false;
          };
        }, [open, tab, tick]);

        // 主题页签单独取数
        React.useEffect(() => {
          // 记忆/准则页签的「挂主题」按钮也要用主题列表，所以面板一打开就拉
          if (!open) return undefined;
          let alive = true;
          (async () => {
            try {
              const response = await call('/cognition-engine/topics', { cache: 'no-store' });
              if (!response.ok) return;
              const next = await response.json();
              if (alive) setTopicsData(next);
            } catch {
              /* 拉不到保持旧数据 */
            }
          })();
          return () => {
            alive = false;
          };
        }, [open, tab, tick]);

        const addTopic = async () => {
          const name = document.getElementById('topicName').value.trim();
          const description = document.getElementById('topicDesc').value.trim();
          const aliases = document.getElementById('topicAliases').value.trim();
          if (name.length === 0) return;
          await post(
            '/cognition-engine/topics/add?name=' +
              encodeURIComponent(name) +
              '&description=' +
              encodeURIComponent(description) +
              '&aliases=' +
              encodeURIComponent(aliases),
          );
          setTopicForm(false);
          setTick((value) => value + 1);
        };

        // 挂主题：给记忆/准则用。先做成 prompt 版——可用优先于好看。
        // chip 显示主题名而不是裸 id（t_001 对用户没有意义）
        const topicChips = (ids) => {
          if (!ids || ids.length === 0) return null;
          const all = (topicsData && topicsData.list) || [];
          const names = ids.map((id) => {
            const hit = all.find((topic) => topic.id === id);
            return hit ? hit.name : id;
          });
          return h(
            'span',
            { style: { ...S.chip, color: 'var(--dsw-alias-label-secondary)' } },
            names.join(' · '),
          );
        };

        // 「挂主题」不再用 window.prompt（Web 环境里被拦截，点了没反应），
        // 改成内联勾选面板。
        const isPicking = (targetType, id) =>
          topicPick !== null && topicPick.targetType === targetType && topicPick.id === id;

        const topicAssignButton = (targetType, id) =>
          h(
            'button',
            {
              type: 'button',
              style: isPicking(targetType, id) ? { ...S.tab, ...S.tabActive } : S.tab,
              onClick: () => setTopicPick(isPicking(targetType, id) ? null : { targetType, id }),
            },
            dict.subjectPick,
          );

        /** 勾选面板：列出所有生效主题，勾上的就是归属。 */
        const topicPicker = (targetType, id, current) => {
          if (!isPicking(targetType, id)) return null;
          const all = ((topicsData && topicsData.list) || []).filter((topic) => topic.status === 'active');
          if (all.length === 0) return h('div', { style: S.explain }, dict.subjectPickNone);
          const chosen = new Set(current || []);
          const boxes = all.map((topic) =>
            h(
              'label',
              {
                key: topic.id,
                style: { display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 10 },
              },
              h('input', {
                type: 'checkbox',
                id: 'pick-' + targetType + '-' + id + '-' + topic.id,
                defaultChecked: chosen.has(topic.id),
              }),
              topic.name,
            ),
          );
          return h(
            'div',
            { style: S.item },
            h('div', { style: S.meta }, ...boxes),
            h(
              'button',
              {
                type: 'button',
                style: S.tab,
                onClick: async () => {
                  const picked = all
                    .filter((topic) => {
                      const box = document.getElementById('pick-' + targetType + '-' + id + '-' + topic.id);
                      return box !== null && box.checked;
                    })
                    .map((topic) => topic.id);
                  await post(
                    '/cognition-engine/topics/assign?targetType=' + targetType + '&id=' +
                      encodeURIComponent(id) + '&topicIds=' + encodeURIComponent(picked.join(',')),
                  );
                  setTopicPick(null);
                  setTick((v) => v + 1);
                },
              },
              dict.subjectPickSave,
            ),
          );
        };

        // 三道约束开关：一次只改一个 flag，其它参数不动
        const playbookFlag = async (id, name, value) => {
          await post(
            '/cognition-engine/playbook/act?action=flags&id=' +
              encodeURIComponent(id) +
              '&' + name + '=' + (value ? 'true' : 'false'),
          );
          setTick((value2) => value2 + 1);
        };

        // 准则本操作：接受 / 拒绝 / 停用 / 恢复
        const playbookAct = async (id, action) => {
          await post(`/cognition-engine/playbook/act?id=${encodeURIComponent(id)}&action=${action}`);
          setTick((value) => value + 1);
        };

        // 新建表单：任务（含时间段）与记忆（内容 + 主题）
        const formFor = (key) => {
          if (key === 'tasks') {
            if (formOpen !== 'tasks') {
              return h('div', { style: S.meta },
                h('button', { type: 'button', style: S.tab, onClick: () => setFormOpen('tasks') }, '＋ 新建任务'),
              );
            }
            return h(
              'div',
              { style: S.item },
              h('div', { style: S.itemTitle }, '新建任务'),
              h('input', { id: 'cogTaskDesc', placeholder: '任务描述', style: S.input }),
              h('div', { style: S.meta },
                h('span', null, '开始'), h('input', { id: 'cogTaskStart', type: 'datetime-local', style: S.input }),
                h('span', null, '顺序'), h('input', { id: 'cogTaskOrder', type: 'number', placeholder: '1', style: { ...S.input, width: 70 } }),
                h('label', { style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
                  h('input', { id: 'cogTaskParallel', type: 'checkbox' }), '与前一项并行'),
              ),
              h('button', { type: 'button', style: S.tab, onClick: async () => {
                const d = document.getElementById('cogTaskDesc').value.trim();
                if (!d) return;
                const s = document.getElementById('cogTaskStart').value;
                const o = document.getElementById('cogTaskOrder').value;
                const pl = document.getElementById('cogTaskParallel').checked;
                await post(`/cognition-engine/task/create?description=${encodeURIComponent(d)}${s ? `&startAt=${new Date(s).getTime()}` : ''}${o ? `&order=${o}` : ''}${pl ? '&parallel=true' : ''}`);
                setTick((v) => v + 1);
              } }, '创建任务'),
            );
          }
          if (key === 'memories') {
            if (formOpen !== 'memories') {
              return h('div', { style: S.meta },
                h('button', { type: 'button', style: S.tab, onClick: () => setFormOpen('memories') }, '＋ 新建记忆'),
              );
            }
            return h(
              'div',
              { style: S.item },
              h('div', { style: S.itemTitle }, '新建记忆'),
              h('input', { id: 'cogMemContent', placeholder: '记忆内容', style: S.input }),
              h('input', { id: 'cogMemSubject', placeholder: '主题（可留空）', style: S.input }),
              h('button', { type: 'button', style: S.tab, onClick: async () => {
                const c = document.getElementById('cogMemContent').value.trim();
                if (!c) return;
                const s = document.getElementById('cogMemSubject').value.trim();
                await post(`/cognition-engine/memory/create?content=${encodeURIComponent(c)}${s ? `&subject=${encodeURIComponent(s)}` : ''}`);
                setTick((v) => v + 1);
              } }, '写入记忆'),
              h('button', { type: 'button', style: S.tab, onClick: () => setFormOpen(null) }, '收起'),
            );
          }
          if (key === 'playbook') {
            if (formOpen !== 'playbook') {
              return h('div', { style: S.meta },
                h('button', { type: 'button', style: S.tab, onClick: () => setFormOpen('playbook') }, dict.playbookAdd),
              );
            }
            return h(
              'div',
              { style: S.item },
              h('div', { style: S.itemTitle }, dict.playbookAddTitle),
              h('input', { id: 'pbContent', placeholder: dict.playbookContent, style: S.input }),
              h(
                'div',
                { style: S.meta },
                h('span', null, dict.playbookSection),
                h(
                  'select',
                  { id: 'pbSection', style: S.input },
                  ['约定', '坑', '状态'].map((name) => h('option', { key: name, value: name }, name)),
                ),
              ),
              h('button', {
                type: 'button',
                style: S.tab,
                onClick: async () => {
                  const content = document.getElementById('pbContent').value.trim();
                  const section = document.getElementById('pbSection').value;
                  if (content.length === 0) return;
                  await post(
                    '/cognition-engine/playbook/add?content=' +
                      encodeURIComponent(content) +
                      '&section=' +
                      encodeURIComponent(section),
                  );
                  setFormOpen(null);
                  setTick((value) => value + 1);
                },
              }, dict.playbookSave),
              h('button', { type: 'button', style: S.tab, onClick: () => setFormOpen(null) }, '收起'),
            );
          }
          return null;
        };

        const toggle = () => setOpen((value) => !value);
        const rootStyle = opts.variant === 'panel' ? S.panelRoot : opts.variant === 'wide' ? S.wideRoot : S.root;

        if (!state) {
          return h(
            'div',
            { style: S.row, title: failure || '' },
            h('span', { style: { ...S.group, ...S.name } }, dict.name),
            h('span', null, failure ? `${dict.offline} (${failure})` : dict.connecting),
          );
        }

        const memoryCount = (state.memory || {}).total || 0;
        const schemaCount = (state.topics || {}).total || (state.graph || {}).schemas || 0;
        const taskCount = (state.tasks || {}).pending || 0;
        const playbookCount = (state.playbook || {}).active || 0;
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
          h('span', { style: S.sep }, '·'),
          h('span', null, `${dict.playbookTab} ${playbookCount}`),
          samples > 0
            ? h(
                'span',
                { style: { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 } },
                `⚠ ${dict.testData} ${samples}`,
              )
            : null,
          h('span', { style: S.caret }, open ? '▾' : '▸'),
        );

        if (!open) return h('div', { style: rootStyle }, row);

        const tabs = [
          // 「状态」页签已移除：三个数字与页签标签重复，没有信息量
          ['memories', `${dict.memories} ${detail ? detail.memories.length : ''}`.trim()],
          ['schemas', `${dict.schemas} ${topicsData && topicsData.stats ? topicsData.stats.active : 0}`.trim()],
          ['playbook', `${dict.playbookTab}${detail && detail.playbook ? ' ' + detail.playbook.active : ''}`.trim()],
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
              dict.backupTitle,
              button(dict.restoreLatest, async () => {
                try {
                  const res = await fetch('/cognition-engine/snapshots', { cache: 'no-store' });
                  const data = await res.json();
                  const items = Array.isArray(data.items) ? data.items : [];
                  if (items.length === 0) { setNotice('还没有快照可恢复'); return; }
                  await post('/cognition-engine/snapshot/restore?name=' + encodeURIComponent(items[0].name));
                  setNotice('已恢复到最近一份快照');
                } catch (error) {
                  setNotice('✗ 恢复失败：' + (error instanceof Error ? error.message : String(error)));
                }
              }),
              button(dict.viewAudit, async () => {
                try {
                  const res = await fetch('/cognition-engine/audit?limit=5', { cache: 'no-store' });
                  const data = await res.json();
                  const items = Array.isArray(data.items) ? data.items : [];
                  if (items.length === 0) { setNotice('暂无审计记录'); return; }
                  setNotice(items.map((e) => [e.op, e.subject || e.id || '', e.origin || ''].filter(Boolean).join(' ')).join(' ｜ '));
                } catch (error) {
                  setNotice('✗ 读取审计失败：' + (error instanceof Error ? error.message : String(error)));
                }
              }),
            ),
            section(
              dict.rulesTitle,
              ...[
                ['transient', dict.ruleTransient],
                ['sensitive', dict.ruleSensitive],
                ['injection', dict.ruleInjection],
                ['authority', dict.ruleAuthority],
              ].map((pair) =>
                h(
                  'label',
                  { key: pair[0], style: { ...S.tab, cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center' } },
                  h('input', {
                    type: 'checkbox',
                    checked: (state.rules || {})[pair[0]] !== false,
                    onChange: (event) => {
                      post(`/cognition-engine/rules/set?${pair[0]}=${event.target.checked}`).then(() => setTick((v) => v + 1));
                    },
                  }),
                  pair[1],
                ),
              ),
            ),
            section(
              `${dict.storage}：${state.storageFile || '-'}`,
              button(dict.clearMemory, () => post('/cognition-engine/clear?scope=memory')),
              button(dict.clearAll, () => post('/cognition-engine/clear?scope=all')),
              button(dict.consolidate, () => post('/cognition-engine/consolidate').then(() => setTick((v) => v + 1))),
              button(dict.exportData, () => {
                window.open('/cognition-engine/export', '_blank');
              }),
              h(
                'label',
                { style: { ...S.tab, cursor: 'pointer' } },
                dict.importData,
                h('input', {
                  type: 'file',
                  accept: 'application/json,.json',
                  style: { display: 'none' },
                  onChange: async (event) => {
                    const file = event.target.files && event.target.files[0];
                    if (!file) return;
                    const text = await file.text();
                    await post(`/cognition-engine/import?payload=${encodeURIComponent(text)}`);
                    setTick((value) => value + 1);
                  },
                }),
              ),
            ),
            section(
              dict.realModel,
              h(
                'span',
                {
                  style: {
                    color:
                      state.model?.mode === 'real' ? '#58a6ff'
                      : state.model?.mode === 'local' ? '#d29922'
                      : '#f85149',
                    fontWeight: 600,
                  },
                },
                state.model?.mode === 'real' ? dict.engineReal
                  : state.model?.mode === 'local' ? dict.engineLocal
                  : dict.engineOff,
              ),
              h(
                'div',
                { style: S.meta },
                ['off', 'local', 'real'].map((mode) =>
                  h(
                    'button',
                    {
                      key: mode,
                      type: 'button',
                      style: state.model?.mode === mode ? { ...S.tab, ...S.tabActive } : S.tab,
                      onClick: () => post('/cognition-engine/model?mode=' + mode).then(() => setTick((v) => v + 1)),
                    },
                    mode === 'off' ? dict.engineOff : mode === 'local' ? dict.engineLocal : dict.engineReal,
                  ),
                ),
              ),
              h('div', { style: S.explain },
                state.model?.mode === 'real' ? dict.engineRealHint
                  : state.model?.mode === 'local' ? dict.engineLocalHint
                  : dict.engineOffHint),
              state.model?.mode === 'real' && state.model?.available
                ? h('span', null, state.model.provider + '/' + state.model.model)
                : null,
              h(
                'div',
                { style: S.meta },
                h('span', null, dict.autoReflectLabel + '：'),
                h(
                  'button',
                  {
                    type: 'button',
                    style: S.tab,
                    onClick: async () => {
                      const next = !(state.model && state.model.autoReflect);
                      await post('/cognition-engine/model?autoReflect=' + (next ? 'true' : 'false'));
                      setTick((v) => v + 1);
                    },
                  },
                  state.model && state.model.autoReflect ? dict.autoReflectOn : dict.autoReflectOff,
                ),
              ),
              h('div', { style: S.explain }, dict.autoReflectHint),
              h(
                'div',
                { style: S.meta },
                h('span', null, dict.effortLabel + '：'),
                ['', ...((state.model && state.model.efforts) || [])].map((effort) =>
                  h(
                    'button',
                    {
                      key: effort === '' ? 'auto' : effort,
                      type: 'button',
                      style:
                        ((state.model && state.model.effort) || '') === effort
                          ? { ...S.tab, ...S.tabActive }
                          : S.tab,
                      onClick: async () => {
                        await post('/cognition-engine/model?effort=' + encodeURIComponent(effort));
                        setTick((v) => v + 1);
                      },
                    },
                    effort === '' ? dict.effortAuto : effort,
                  ),
                ),
              ),
              h('div', { style: S.explain }, dict.effortHint),
            ),
            section(
              dict.lock,
              h(
                'span',
                { style: { color: state.locked ? '#3fb950' : '#f85149', fontWeight: 600 } },
                state.locked ? dict.locked : dict.unlocked,
              ),
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
          );
        } else if (detailError !== null) {
          // 口令未设置或错误：直接在面板里给输入框，避免「要口令才能开口令入口」的死锁
          const isAuth = /401|unauthorized|口令/i.test(String(detailError));
          if (isAuth) {
            body = h(
              'div',
              { style: S.item },
              h('div', { style: S.itemTitle }, dict.needToken),
              h('input', {
                value: tokenDraft,
                placeholder: dict.token,
                onChange: (event) => setTokenDraft(event.target.value),
                style: S.input,
              }),
              h(
                'button',
                {
                  type: 'button',
                  style: S.tab,
                  onClick: () => {
                    rememberToken(tokenDraft.trim());
                    setTick((value) => value + 1);
                  },
                },
                dict.applyToken,
              ),
            );
          } else {
            body = h('div', { style: S.empty }, `${dict.noDetail} (${detailError})`);
          }
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
        } else if (tab === 'memories') {
          body = renderList(detail.memories, (item) => {
            if (editingId === item.id) {
              return h(
                'div',
                { key: item.id, style: S.item },
                h('div', { style: S.itemTitle }, '编辑记忆'),
                h('input', { id: 'ec-' + item.id, defaultValue: item.content, style: S.input }),
                h('input', { id: 'es-' + item.id, defaultValue: item.subject, style: S.input }),
                h(
                  'div',
                  { style: S.meta },
                  h('span', null, '录入时间'),
                  h('input', { id: 'er-' + item.id, type: 'datetime-local', defaultValue: toLocalInput(item.recordedAt), style: S.input }),
                  h(
                    'label',
                    { style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
                    h('input', { id: 'ep-' + item.id, type: 'checkbox', defaultChecked: !item.current }),
                    '标记为已失效',
                  ),
                ),
                h(
                  'div',
                  { style: S.meta },
                  h('button', { type: 'button', style: S.tab, onClick: async () => {
                    const c = document.getElementById('ec-' + item.id).value.trim();
                    const sj = document.getElementById('es-' + item.id).value.trim();
                    const r = document.getElementById('er-' + item.id).value;
                    const sp = document.getElementById('ep-' + item.id).checked;
                    await post('/cognition-engine/memory/update?id=' + item.id + '&content=' + encodeURIComponent(c) + '&subject=' + encodeURIComponent(sj) + (r ? '&recordedAt=' + new Date(r).getTime() : '') + '&superseded=' + sp);
                    setEditingId(null);
                    setTick((v) => v + 1);
                  } }, '保存'),
                  h('button', { type: 'button', style: S.tab, onClick: () => setEditingId(null) }, '取消'),
                  h('button', { type: 'button', style: { ...S.tab, color: '#f85149' }, onClick: async () => {
                    if (!window.confirm('删除这条记忆？删除后不再参与回忆，但数据仍保留，可恢复。')) return;
                    await post('/cognition-engine/memory/delete?id=' + item.id);
                    setEditingId(null);
                    setTick((v) => v + 1);
                  } }, '删除'),
                ),
              );
            }
            return h(
              'div',
              { key: item.id, style: S.item },
              h('div', { style: S.itemTitle }, item.content),
              h(
                'div',
                { style: S.meta },
                h('span', { style: { ...S.chip, color: item.current ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' } }, item.current ? dict.current : dict.superseded),
                item.revisedAt ? h('span', { style: { ...S.chip, color: 'var(--dsw-alias-state-warn-primary)' } }, '已手动修正') : null,
                item.mergedInto ? h('span', { style: { ...S.chip, color: 'var(--dsw-alias-label-secondary)' } }, '已并入 ' + item.mergedInto) : null,
                h('span', null, item.subject),
                h('span', null, new Date(item.recordedAt).toLocaleString()),
                h('span', null, item.id),
                topicChips(item.topicIds || []),
                topicAssignButton('memory', item.id),
                h('button', { type: 'button', style: S.tab, onClick: () => setEditingId(item.id) }, '编辑'),
              ),
              topicPicker('memory', item.id, item.topicIds || []),
            );
          });
        } else if (tab === 'playbook') {
          const pb = playbookData;
          if (pb === null) {
            body = h('div', { style: S.explain }, '加载中…');
          } else {
            const groups = [
              ['pending', dict.playbookPending],
              ['expired', dict.playbookExpired],
              ['active', dict.playbookActive],
              ['retired', dict.playbookRetired],
            ];
            const item = (entry) =>
              h(
                'div',
                { key: entry.id, style: S.item },
                h('div', { style: S.itemTitle }, entry.content),
                h(
                  'div',
                  { style: S.meta },
                  h('span', { style: { ...S.chip, color: 'var(--dsw-alias-label-secondary)' } }, entry.section),
                  ...[
                    ['guard', dict.pbGuard, entry.guard, dict.pbGuardHint],
                    ['enforce', dict.pbEnforce, entry.enforce, dict.pbEnforceHint],
                    ['audit', dict.pbAudit, entry.audit, dict.pbAuditHint],
                  ].map(([name, label, on, hint]) =>
                    h(
                      'button',
                      {
                        key: name,
                        type: 'button',
                        title: hint,
                        style: on ? { ...S.tab, ...S.tabActive } : S.tab,
                        onClick: () => playbookFlag(entry.id, name, !on),
                      },
                      (on ? '☑ ' : '☐ ') + label,
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: S.tab,
                      onClick: () => setPbFlagsFor(pbFlagsFor === entry.id ? null : entry.id),
                    },
                    dict.pbRules,
                  ),
                  entry.violations > 0
                    ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } },
                        dict.pbViolations + ' ' + entry.violations)
                    : null,
                  h('span', null, entry.id),
                  h(
                    'span',
                    { style: { ...S.chip, color: entry.origin === 'human' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
                    entry.origin === 'human' ? dict.pbOriginHuman : dict.pbOriginAgent,
                  ),
                  topicChips(entry.topicIds || []),
                  topicAssignButton('rule', entry.id),
                  h(
                    'span',
                    { title: 'applied=应用 good=应用且好 bad=应用且差 missed=该用没用 corrected=用户纠正' },
                    entry.usage
                      ? `用 ${entry.usage.applied} · 好 ${entry.usage.appliedGood} · 差 ${entry.usage.appliedBad} · 漏 ${entry.usage.missed}`
                      : `helpful=${entry.helpful} harmful=${entry.harmful}`,
                  ),
                  entry.validTo
                    ? h('span', null, '有效期至 ' + new Date(entry.validTo).toLocaleDateString())
                    : null,
                  entry.conflictWith
                    ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, `${dict.playbookConflict} ${entry.conflictWith}`)
                    : null,
                  entry.status === 'pending'
                    ? h('button', { type: 'button', style: S.tab, onClick: () => playbookAct(entry.id, 'accept') }, dict.playbookAccept)
                    : null,
                  entry.status === 'pending'
                    ? h('button', { type: 'button', style: S.tab, onClick: () => playbookAct(entry.id, 'reject') }, dict.playbookReject)
                    : null,
                  entry.status === 'active'
                    ? h('button', { type: 'button', style: S.tab, onClick: () => playbookAct(entry.id, 'retire') }, dict.playbookRetire)
                    : null,
                  entry.status === 'retired'
                    ? h('button', { type: 'button', style: S.tab, onClick: () => playbookAct(entry.id, 'revive') }, dict.playbookRevive)
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      style: S.tab,
                      onClick: async () => {
                        if (!window.confirm('永久删除这条准则？删除后不再注入，快照里还能找回。')) return;
                        await post(
                          `/cognition-engine/playbook/act?id=${encodeURIComponent(entry.id)}&action=delete`,
                        );
                        setTick((value) => value + 1);
                      },
                    },
                    dict.playbookDelete,
                  ),
                  entry.status === 'active' && entry.expired === true
                    ? h(
                        'button',
                        {
                          type: 'button',
                          style: S.tab,
                          onClick: async () => {
                            const until = Date.now() + 30 * 24 * 3600 * 1000;
                            await post(
                              `/cognition-engine/playbook/act?id=${encodeURIComponent(entry.id)}&action=extend&validTo=${until}`,
                            );
                            setTick((value) => value + 1);
                          },
                        },
                        `${dict.playbookExtend} 30 天`,
                      )
                    : null,
                ),
                pbFlagsFor === entry.id
                  ? h(
                      'div',
                      { style: S.item },
                      h('div', { style: S.meta }, h('span', null, dict.pbWhen)),
                      h('input', {
                        id: 'pbWhen-' + entry.id,
                        defaultValue: entry.when || '',
                        placeholder: '发布版本时',
                        style: S.input,
                      }),
                      h(
                        'div',
                        { style: S.meta },
                        h('span', null, dict.pbTrigger),
                      ),
                      h('input', {
                        id: 'pbTrigger-' + entry.id,
                        defaultValue: entry.trigger || '',
                        placeholder: 'npm\\s+publish',
                        style: S.input,
                      }),
                      h('div', { style: S.meta }, h('span', null, dict.pbRequired)),
                      h('input', {
                        id: 'pbRequired-' + entry.id,
                        defaultValue: entry.required || '',
                        placeholder: '--registry',
                        style: S.input,
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: S.tab,
                          onClick: async () => {
                            const when = document.getElementById('pbWhen-' + entry.id).value;
                            const trigger = document.getElementById('pbTrigger-' + entry.id).value;
                            const required = document.getElementById('pbRequired-' + entry.id).value;
                            await post(
                              '/cognition-engine/playbook/act?action=flags&id=' +
                                encodeURIComponent(entry.id) +
                                '&when=' + encodeURIComponent(when) +
                                '&trigger=' + encodeURIComponent(trigger) +
                                '&required=' + encodeURIComponent(required),
                            );
                            setPbFlagsFor(null);
                            setTick((value) => value + 1);
                          },
                        },
                        dict.pbSaveRules,
                      ),
                    )
                  : null,
                topicPicker('rule', entry.id, entry.topicIds || []),
              );

            const sections = groups
              .map(([status, label]) => {
                const list = (pb.entries || []).filter((entry) => entry.status === status);
                if (list.length === 0) return null;
                return h(
                  'div',
                  { key: status },
                  h('div', { style: S.explain }, `${label} ${list.length}`),
                  ...list.map(item),
                );
              })
              .filter(Boolean);

            body = h(
              'div',
              null,
              sections.length === 0 ? h('div', { style: S.explain }, dict.playbookEmpty) : null,
              ...sections,
            );
          }
        } else {
          const td = topicsData;
          const topicList = (td && Array.isArray(td.list) ? td.list : []).filter(
            (topic) => topic.status === 'active',
          );
          const unclassified = (td && td.unclassified) || { memories: 0, rules: 0 };
          const card = (topic) => {
            const memoryCount = topic.memoryCount || 0;
            const ruleCount = topic.ruleCount || 0;
            return h(
              'div',
              { key: topic.id, style: S.item },
              h(
                'div',
                { style: S.meta },
                h('span', { style: S.itemTitle }, topic.name),
                h('span', null, '记忆 ' + memoryCount + ' 条 · 准则 ' + ruleCount + ' 条'),
                h(
                  'button',
                  {
                    type: 'button',
                    style: S.tab,
                    onClick: async () => {
                      if (!window.confirm('停用主题「' + topic.name + '」？已经挂上去的记忆和准则都还在，只是不再出现在这个分类里。')) return;
                      await post('/cognition-engine/topics/archive?id=' + encodeURIComponent(topic.id));
                      setTick((v) => v + 1);
                    },
                  },
                  dict.topicArchive,
                ),
              ),
              topic.description ? h('div', { style: S.explain }, topic.description) : null,
              topic.aliases.length > 0
                ? h('div', { style: S.explain }, '也叫：' + topic.aliases.join('、'))
                : null,
              // 任务不再是独立台账：主题下直接增删改任务
              h(
                'div',
                { style: S.meta },
                h('span', null, '待办 ' + (topic.tasks || []).length + ' 项'),
                h(
                  'button',
                  {
                    type: 'button',
                    style: S.tab,
                    onClick: () => setTaskFormFor(taskFormFor === topic.id ? null : topic.id),
                  },
                  dict.taskAdd,
                ),
              ),
              taskFormFor === topic.id
                ? h(
                    'div',
                    { style: S.meta },
                    h('input', {
                      id: 'nt-' + topic.id,
                      placeholder: dict.taskPlaceholder,
                      style: S.input,
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') document.getElementById('save-task-' + topic.id).click();
                      },
                    }),
                    h(
                      'button',
                      {
                        id: 'save-task-' + topic.id,
                        type: 'button',
                        style: S.tab,
                        onClick: async () => {
                          const input = document.getElementById('nt-' + topic.id);
                          const desc = input && input.value ? input.value.trim() : '';
                          if (desc.length === 0) return;
                          await post(
                            '/cognition-engine/task/create?description=' +
                              encodeURIComponent(desc) +
                              '&topicIds=' +
                              encodeURIComponent(topic.id),
                          );
                          setTaskFormFor(null);
                          setTick((v) => v + 1);
                        },
                      },
                      dict.taskSave,
                    ),
                  )
                : null,
              (topic.tasks || []).length === 0
                ? null
                : h(
                    'div',
                    { style: S.list },
                    (topic.tasks || []).map((task) =>
                      h(
                        'div',
                        { key: task.id, style: S.clue },
                        h(
                          'div',
                          { style: S.meta },
                          h(
                            'span',
                            {
                              style: {
                                ...S.chip,
                                color:
                                  task.status === 'COMPLETED'
                                    ? 'var(--dsw-alias-state-success-primary)'
                                    : task.status === 'IN_PROGRESS'
                                      ? 'var(--dsw-alias-brand-primary)'
                                      : 'var(--dsw-alias-label-secondary)',
                              },
                            },
                            dict['task' + task.status] || task.status,
                          ),
                          h('span', null, task.description),
                        ),
                        h(
                          'div',
                          { style: S.meta },
                          task.status === 'PENDING'
                            ? h(
                                'button',
                                {
                                  type: 'button',
                                  style: S.tab,
                                  onClick: async () => {
                                    await post(
                                      '/cognition-engine/task/status?id=' +
                                        encodeURIComponent(task.id) +
                                        '&status=IN_PROGRESS',
                                    );
                                    setTick((v) => v + 1);
                                  },
                                },
                                dict.taskStart,
                              )
                            : null,
                          task.status !== 'COMPLETED'
                            ? h(
                                'button',
                                {
                                  type: 'button',
                                  style: S.tab,
                                  onClick: async () => {
                                    await post(
                                      '/cognition-engine/task/status?id=' +
                                        encodeURIComponent(task.id) +
                                        '&status=COMPLETED',
                                    );
                                    setTick((v) => v + 1);
                                  },
                                },
                                dict.taskDone,
                              )
                            : h(
                                'button',
                                {
                                  type: 'button',
                                  style: S.tab,
                                  onClick: async () => {
                                    await post(
                                      '/cognition-engine/task/status?id=' +
                                        encodeURIComponent(task.id) +
                                        '&status=PENDING',
                                    );
                                    setTick((v) => v + 1);
                                  },
                                },
                                dict.taskReopen,
                              ),
                          h(
                            'button',
                            {
                              type: 'button',
                              style: { ...S.tab, color: '#f85149' },
                              onClick: async () => {
                                if (!window.confirm('删除待办「' + task.description + '」？')) return;
                                await post(
                                  '/cognition-engine/task/delete?id=' + encodeURIComponent(task.id),
                                );
                                setTick((v) => v + 1);
                              },
                            },
                            dict.taskDelete,
                          ),
                        ),
                      ),
                    ),
                  ),
            );
          };

          body = h(
            'div',
            null,
            h('div', { style: S.explain }, dict.topicsHint),
            h(
              'div',
              { style: S.meta },
              h(
                'button',
                { type: 'button', style: S.tab, onClick: () => setTopicForm(!topicForm) },
                dict.topicAdd,
              ),
              h('span', null, '共 ' + topicList.length + ' 个主题'),
            ),
            topicForm
              ? h(
                  'div',
                  { style: S.item },
                  h('input', { id: 'topicName', placeholder: dict.topicName, style: S.input }),
                  h('input', { id: 'topicDesc', placeholder: dict.topicDesc, style: S.input }),
                  h('input', { id: 'topicAliases', placeholder: dict.topicAliases, style: S.input }),
                  h(
                    'button',
                    { type: 'button', style: S.tab, onClick: addTopic },
                    dict.topicSave,
                  ),
                )
              : null,
            topicList.length === 0
              ? h('div', { style: S.explain }, dict.topicEmpty)
              : h('div', null, ...topicList.map(card)),
            h(
              'div',
              { style: S.item },
              h('div', { style: S.itemTitle }, dict.topicUnclassified),
              h('div', { style: S.explain }, dict.topicUnclassifiedHint),
              h(
                'div',
                { style: S.meta },
                h('span', null, '记忆 ' + unclassified.memories),
                h('span', null, '准则 ' + unclassified.rules),
              ),
            ),
          );
        }

        const panel = h(
          'div',
          { style: opts.variant === 'wide' ? S.widePanel : S.panel, role: 'dialog', 'aria-label': dict.name },
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
          h(
            'div',
            { style: S.list },
            notice
              ? h(
                  'div',
                  {
                    style: {
                      ...S.explain,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: notice.startsWith('✗') ? 'rgba(248,81,73,0.12)' : 'rgba(63,185,80,0.12)',
                      color: notice.startsWith('✗') ? '#f85149' : '#3fb950',
                      border: '1px solid ' + (notice.startsWith('✗') ? 'rgba(248,81,73,0.35)' : 'rgba(63,185,80,0.35)'),
                    },
                  },
                  notice,
                )
              : null,
            tab === 'playbook'
              ? h('div', { style: S.explain }, dict.playbookHint)
              : null,
            tab === 'playbook'
              ? h(
                  'div',
                  { style: S.meta },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: S.tab,
                      onClick: async () => {
                        await post('/cognition-engine/playbook/distill?maxCandidates=5');
                        setTick((value) => value + 1);
                      },
                    },
                    dict.playbookDistill,
                  ),
                  playbookData === null
                    ? null
                    : h(
                        'span',
                        null,
                        `active ${playbookData.stats.active} · pending ${playbookData.stats.pending} · ${playbookData.stats.chars} 字符 · 注入源 ${playbookData.stats.injectSource ?? '-'}`,
                      ),
                )
              : null,
            formFor(tab),
            body,
          ),
        );

        return h('div', { style: rootStyle }, row, panel);
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
          // 输入框上方全宽入口（居中、透明浮层，展开不挤压对话框）
          const Wide = (props) => h(Dock, { ...props, defaultOpen: false, variant: 'wide' });
          ctx.slots.inject('conversation.input.dock', () =>
            ctx.slots.register({ name: 'conversation.input.dock', id: 'cognition-engine', order: 5 }, Wide),
          );
          // 侧边栏图标 + 整页面板已移除：侧边栏 UI 使用频率低，只保留输入框上方的浮层。
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
