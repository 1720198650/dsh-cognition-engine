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
        personaTab: '人格',
        learnTab: '学习',
        superagentTab: '超级代理',
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
        playbookTab: 'Rules',
        personaTab: 'Persona',
        learnTab: 'Learning',
        superagentTab: 'Super-agent',
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
        gap: 0,
        // 面板形态用 flex:1 撑满外层（外层是 flex column + height:100%）；
        // 用 height:100% 在 flex 容器里等于「和父元素一样高」，会把正文区的
        // flex:1 挤成 0，结果整页不能滚动——这就是记忆页滚不动的原因。
        flex: '1 1 auto',
        minHeight: 0,
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
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
        // 面板形态（侧边栏一级页面）**不设底色、不设外框**：
        // bg-overlay 比主列底色亮一档，铺满整列就成了那种「整块发亮」的感觉。
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
        boxShadow: 'none',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        // 它也是纵向 flex：必须自己占满剩余高度并把高度往下传，
        // 否则里面的正文区拿不到可用高度，滚动条永远不出现。
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'hidden',
      },
      tabs: {
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '10px 16px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        flexWrap: 'wrap',
      },
      tab: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13,
        lineHeight: '20px',
        padding: '6px 12px',
        borderRadius: '6px 6px 0 0',
        cursor: 'pointer',
        fontFamily: 'inherit',
        // 未选中页签下面留一条透明边，选中时换成品牌色，避免整体跳动
        borderBottom: '2px solid transparent',
        marginBottom: -1,
        transition: 'color 0.16s ease, border-color 0.16s ease',
      },
      tabActive: {
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontWeight: 600,
        borderBottom: '2px solid var(--dsw-alias-brand-primary)',
      },
      action: {
        marginLeft: 'auto',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        cursor: 'pointer',
        padding: '3px 10px',
        borderRadius: 6,
        fontFamily: 'inherit',
      },
      // 列表与卡片：面板形态下不再限制高度（整列都能滚），浮层形态保持 280 的帽子
      list: {
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        padding: '12px 20px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      },
      item: {
        padding: '12px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      },
      itemTitle: {
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '20px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      },
      meta: {
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        fontVariantNumeric: 'tabular-nums',
      },
      explain: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px', whiteSpace: 'normal' },
      chip: {
        display: 'inline-block',
        padding: '0 7px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        lineHeight: '18px',
        fontVariantNumeric: 'tabular-nums',
      },
      clue: {
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        paddingLeft: 10,
        borderLeft: '2px solid var(--dsw-alias-border-l2)',
        lineHeight: '18px',
      },
      empty: { padding: '24px 12px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      input: {
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        fontSize: 12,
        padding: '4px 8px',
        width: 160,
        fontFamily: 'inherit',
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
      // 人格页签复用设置页那套组件，只是换成嵌入式排版
      const PersonaEmbedded = createPersonaPage(ctx);
      // 学习面板：预算 / shadow / CPE / 提醒 / 检索一屏看完
      const LearningEmbedded = createLearningPage(ctx);
      // 超级代理：只读镜像 superagent 的工单与健康（另一个进程，不可达只显示未连接）
      const SuperagentEmbedded = createSuperagentPane(ctx);
      return function MoodDock(props) {
        const opts = { ...(options || {}), ...(props || {}) };
        const [state, setState] = React.useState(null);
        const [failure, setFailure] = React.useState(null);
        const [open, setOpen] = React.useState(opts.defaultOpen === true || opts.variant === 'panel');
        // 默认停在「记忆」页签：早先默认值是已删除的 'tasks'，导致打开时没有任何页签高亮
        const [tab, setTab] = React.useState('memories');
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
        // panel = 侧边栏一级页面：整列铺满，自己管滚动，不显示摘要行
        const rootStyle = opts.variant === 'panel' ? SIDEBAR_PANEL_STYLE : opts.variant === 'wide' ? S.wideRoot : S.root;
        const isPanel = opts.variant === 'panel';

        if (!state) {
          if (isPanel) {
            return h('div', { style: SIDEBAR_PANEL_STYLE }, h('div', { style: S.panelRoot }, h('div', { style: S.explain }, failure || dict.connecting)));
          }
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

        let row = null;
        // 面板形态不需要这一行：它和下面的标题区重复（同样的四个计数），
        // 而且这行本身是「折叠条」，永远展开的面板用不上它。只在浮层形态保留。
        if (!isPanel) {
          row = h(
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
        }

        // 面板形态没有「收起」：永远展开。浮层形态才有折叠成一行摘要的行为。
        if (!isPanel && !open) return h('div', { style: rootStyle }, row);

        const tabs = [
          // 页签文案不带计数（原来「记忆 21」这类数字让一行晃来晃去）；
          // 计数放到每个页签自己的正文顶部，视觉上更稳。
          ['memories', dict.memories],
          ['schemas', dict.schemas],
          ['playbook', dict.playbookTab],
          ['persona', dict.personaTab],
          ['superagent', dict.superagentTab],
          ['learning', dict.learnTab],
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
        } else if (tab === 'persona') {
          body = h(PersonaEmbedded, { variant: 'embedded' });
        } else if (tab === 'learning') {
          body = h(LearningEmbedded, { variant: 'embedded' });
        } else if (tab === 'superagent') {
          body = h(SuperagentEmbedded, { variant: 'embedded' });
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
          {
            style: opts.variant === 'wide' ? S.widePanel : S.panel,
            ...(opts.variant === 'wide' ? {} : { role: 'dialog', 'aria-label': dict.name }),
          },
          // 页签栏上方的标题区：面板形态给一个明确的页面标题，浮层形态不需要。
          // 计数**只在这里出现一次**——原来折叠条上还有一行同样的数字，两行重复。
          isPanel
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    padding: '20px 20px 10px',
                  },
                },
                h('h2', {
                  style: { margin: 0, fontSize: 17, fontWeight: 600, lineHeight: '24px', color: 'var(--dsw-alias-label-primary)' },
                }, dict.name),
                h('span', {
                  style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
                }, `记忆 ${memoryCount} · 主题 ${schemaCount} · 准则 ${playbookCount} · 任务 ${taskCount}`),
                samples > 0
                  ? h('span', {
                      style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 },
                    }, `⚠ ${dict.testData} ${samples}`)
                  : null,
              )
            : null,
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
            // 面板形态（侧边栏一级页面）里没有「收起」的概念：整页就是全局的，收起反而突兀
            opts.variant === 'panel'
              ? null
              : h(
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
            { style: isPanel ? { ...S.list, ...PANEL_SCROLL_STYLE, flex: '1 1 auto' } : { ...S.list, maxHeight: 280, overflowY: 'auto' } },
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

    /**
     * 侧边栏一级面板视图（`sidebar.panellist`）。
     *
     * 为什么要有它：原来六个页签全挤在输入框上方的浮层里（66% 宽、60vh 高），
     * 记忆/主题/准则那种长列表在里面根本看不全。这里复用同一套组件，
     * 只把外框换成「占满整列、自己滚动」的形态——**视图逻辑一份都不重写**。
     *
     * 侧边栏是全局的（不绑定某个会话），所以某些需要会话上下文的操作
     * 在这里可能拿不到 sessionId。当前各页签都不依赖它，先不处理。
     */
    function createSidebarPanel(ctx) {
      const Dock = createDock(ctx);
      const dict = pickDict(ctx);
      return function SidebarPanel(props) {
        return h(Dock, { ...(props || {}), variant: 'panel' });
      };
    }

    /** 面板形态的外框样式：整列可用，自己管滚动。 */
    const SIDEBAR_PANEL_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      width: '100%',
      boxSizing: 'border-box',
      // **不能设背景**：侧栏主列自己有一层底，这里再铺任何颜色都会变成「灰上叠灰」，
      // 整个面板看起来蒙了一层雾、比周围亮一档。透明就对了。
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 13,
    };

    /** 面板里可滚动的正文区（页签栏固定、正文独立滚动）。 */
    const PANEL_SCROLL_STYLE = {
      flex: '1 1 auto',
      minHeight: 0,
      overflowY: 'auto',
      scrollbarGutter: 'stable',
    };

    /* ---------------- 人格页面（settings.section） ---------------- */

    const PERSONA_TEXT = {
      zh: {
        nav: '人格',
        title: '人格',
        subtitle: '决定它「是谁」。保存立即生效，每次改动都留快照、可撤销。',
        loading: '加载中…',
        absent: '还没有人格文件',
        absentHint:
          '下面是一份骨架：把尖括号里的内容改成你自己的，再点创建。创建后这段文字会每轮注入系统提示（约 200–600 字，占预算很小）。',
        personaBlock: '人格（它是什么助手）',
        humanBlock: '用户画像（你是谁）',
        create: '创建人格',
        save: '保存并生效',
        undo: '撤销最近一次改动',
        preview: '实际注入内容',
        showPreview: '展开预览',
        hidePreview: '收起预览',
        pending: '待确认的提案',
        confirm: '确认生效',
        reject: '放弃',
        noPending: '没有待确认的提案',
        locked: '锁定边界',
        readonly: '只读',
        audit: '审计信息（不注入上下文）',
        saveError: '上次写入失败',
        created: '已创建',
        saved: '已保存',
        undone: '已撤销',
        failed: '操作失败',
        insufficient: '没有人格文件，页面处于未启用状态',
        chars: '字',
        rev: '版本',
        budget: '注入预算',
      },
      en: {
        nav: 'Persona',
        title: 'Persona',
        subtitle: 'Decides "who it is". Saving applies immediately; every change keeps a snapshot and can be undone.',
        loading: 'Loading…',
        absent: 'No persona file yet',
        absentHint:
          'A skeleton is pre-filled below. Replace the bracketed text, then create it. The text is injected into the system prompt every turn (about 200–600 chars).',
        personaBlock: 'Persona (who the assistant is)',
        humanBlock: 'User profile (who you are)',
        create: 'Create persona',
        save: 'Save & apply',
        undo: 'Undo last change',
        preview: 'Actually injected text',
        showPreview: 'Show preview',
        hidePreview: 'Hide preview',
        pending: 'Pending proposals',
        confirm: 'Confirm',
        reject: 'Discard',
        noPending: 'No pending proposals',
        locked: 'Locked boundaries',
        readonly: 'read-only',
        audit: 'Audit (not injected)',
        saveError: 'Last write failed',
        created: 'Created',
        saved: 'Saved',
        undone: 'Undone',
        failed: 'Failed',
        insufficient: 'No persona file; the feature is inactive',
        chars: 'chars',
        rev: 'revision',
        budget: 'injection budget',
      },
    };

    function personaText(ctx) {
      let id = 'zh';
      try {
        const snap = ctx && ctx.locale && typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : null;
        id = (snap && (snap.id || snap.locale || snap.language)) || 'zh';
      } catch {
        id = 'zh';
      }
      return String(id).toLowerCase().startsWith('en') ? PERSONA_TEXT.en : PERSONA_TEXT.zh;
    }

    const PS = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '20px 24px 40px',
        maxWidth: 860,
        width: '100%',
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary)',
      },
      pageEmbedded: {
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '2px 0 8px',
        width: '100%',
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary)',
        // 作为面板正文的根：必须自己撑满并负责滚动，
        // 否则内容一长就把面板撑高、被外层 overflow:hidden 裁掉（滚不动）。
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        scrollbarGutter: 'stable',
      },
      title: { fontSize: 18, fontWeight: 600, margin: 0 },
      sub: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      card: {
        // 不加底色块：面板本身已经是底，再叠一层 layer-1 只会发灰。
        // 用「上细线 + 上下留白」分组，视觉更轻，也和宿主其它设置页一致。
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        padding: '14px 0 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      blockHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
      label: { fontSize: 13, fontWeight: 600 },
      counter: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      counterOver: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', fontVariantNumeric: 'tabular-nums' },
      ta: {
        width: '100%',
        minHeight: 108,
        resize: 'vertical',
        boxSizing: 'border-box',
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        // 输入框用 bg-base（和面板同底）而不是 layer-2：
        // layer-2 在深色主题下是一大块浅灰，整页会显得发白/发灰。
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: 13,
        lineHeight: 1.65,
      },
      rowFlex: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      btn: {
        padding: '6px 14px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'inherit',
      },
      primary: {
        // 不能假设 brand-primary 是饱和色：本主题里它接近白色，
        // 之前的「brand 底 + #fff 字」就渲染成一整块白（字看不见）。
        // 现在主按钮用「label-primary 反色」：深浅主题都自动对比正确。
        padding: '6px 14px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-label-primary)',
        color: 'var(--dsw-alias-bg-base)',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'inherit',
      },
      btnDisabled: { opacity: 0.5, cursor: 'default' },
      chip: {
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      pre: {
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 12,
        lineHeight: 1.65,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l1)',
        padding: '10px 12px',
        borderRadius: 8,
      },
      meta: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', display: 'flex', gap: 14, flexWrap: 'wrap' },
      err: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
      hint: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
    };

    const PERSONA_DEFAULT_PERSONA = [
      '我是<一句话：你希望它是什么身份的助手>。',
      '风格：当<某场景>时<怎么做>；当<另一场景>时<怎么做>；当没把握时直接说「没把握」。',
      '价值观：<更重要的>优先于<次要的>。',
      '边界：不编造事实；不替你做出不可逆的决定。',
    ].join('\n');
    const PERSONA_DEFAULT_HUMAN = '做<你的行业>，中文为主；<你的偏好>。';

    function createPersonaPage(ctx) {
      return function PersonaPage(props) {
        const dict = personaText(ctx);
        // 两种挂载点共用一套逻辑：设置里的整页（默认）与输入框浮层里的页签（embedded）
        const pageStyle = props && props.variant === 'embedded' ? PS.pageEmbedded : PS.page;
        const [data, setData] = React.useState(null);
        const [error, setError] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const [personaDraft, setPersonaDraft] = React.useState(null);
        const [humanDraft, setHumanDraft] = React.useState(null);
        const [showPreview, setShowPreview] = React.useState(false);

        const reload = React.useCallback(async () => {
          try {
            const res = await fetch('/cognition-engine/persona', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            setData(json);
            setError(null);
            if (json.present && json.blocks) {
              setPersonaDraft((prev) => (prev === null ? json.blocks.persona.value : prev));
              setHumanDraft((prev) => (prev === null ? json.blocks.human.value : prev));
            } else {
              setPersonaDraft((prev) => (prev === null ? PERSONA_DEFAULT_PERSONA : prev));
              setHumanDraft((prev) => (prev === null ? PERSONA_DEFAULT_HUMAN : prev));
            }
          } catch (e) {
            setError(e && e.message ? e.message : String(e));
          }
        }, []);

        React.useEffect(() => {
          reload();
        }, [reload]);

        const call = async (path, init) => {
          setBusy(true);
          setNotice(null);
          try {
            const options = Object.assign({ cache: 'no-store' }, init || {});
            const res = await fetch(path, options);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
            return json;
          } finally {
            setBusy(false);
          }
        };

        const say = (kind, text) => setNotice({ kind, text });

        const doCreate = async () => {
          try {
            const result = await call(
              '/cognition-engine/persona/create?persona=' +
                encodeURIComponent(personaDraft || '') +
                '&human=' +
                encodeURIComponent(humanDraft || ''),
              { method: 'POST' },
            );
            if (!result.ok) return say('err', result.reason || dict.failed);
            say('ok', dict.created + ' · ' + dict.rev + ' ' + result.revision);
            await reload();
          } catch (e) {
            say('err', e && e.message ? e.message : String(e));
          }
        };

        const saveBlock = async (label) => {
          const value = (label === 'persona' ? personaDraft : humanDraft) || '';
          try {
            const proposed = await call(
              '/cognition-engine/persona/propose?label=' + label + '&by=user&value=' + encodeURIComponent(value),
              { method: 'POST' },
            );
            if (proposed.rejected) return say('err', proposed.rejected);
            const id = proposed.proposal && proposed.proposal.id;
            if (!id) return say('err', dict.failed);
            const confirmed = await call('/cognition-engine/persona/confirm?id=' + encodeURIComponent(id), {
              method: 'POST',
            });
            if (!confirmed.ok) return say('err', confirmed.reason || dict.failed);
            const warn = proposed.warnings && proposed.warnings.length > 0 ? ' · ' + proposed.warnings.join('；') : '';
            say('ok', dict.saved + ' · ' + dict.rev + ' ' + confirmed.revision + warn);
            await reload();
          } catch (e) {
            say('err', e && e.message ? e.message : String(e));
          }
        };

        const doUndo = async () => {
          try {
            const result = await call('/cognition-engine/persona/undo', { method: 'POST' });
            if (!result.ok) return say('err', result.reason || dict.failed);
            say('ok', dict.undone + ' · ' + dict.rev + ' ' + result.revision);
            // 撤销后编辑器要跟着文件走
            setPersonaDraft(null);
            setHumanDraft(null);
            await reload();
          } catch (e) {
            say('err', e && e.message ? e.message : String(e));
          }
        };

        const resolveProposal = async (id, action) => {
          try {
            const result = await call(
              '/cognition-engine/persona/' + action + '?id=' + encodeURIComponent(id),
              { method: 'POST' },
            );
            if (action === 'confirm' && !result.ok) return say('err', result.reason || dict.failed);
            say('ok', action === 'confirm' ? dict.saved : dict.reject);
            setPersonaDraft(null);
            setHumanDraft(null);
            await reload();
          } catch (e) {
            say('err', e && e.message ? e.message : String(e));
          }
        };

        const editorFor = (label, value, setValue, block) => {
          const limit = block && typeof block.limit === 'number' ? block.limit : label === 'persona' ? 600 : 500;
          const len = (value || '').length;
          const over = len > limit;
          const readOnly = block && block.readOnly === true;
          const locked = (block && block.lockedPhrases) || [];
          return h(
            'div',
            { style: PS.card, key: label },
            h(
              'div',
              { style: PS.blockHead },
              h('span', { style: PS.label }, label === 'persona' ? dict.personaBlock : dict.humanBlock),
              h('span', { style: over ? PS.counterOver : PS.counter }, len + ' / ' + limit + ' ' + dict.chars),
            ),
            locked.length > 0
              ? h(
                  'div',
                  { style: PS.rowFlex },
                  h('span', { style: PS.counter }, dict.locked + '：'),
                  locked.map((phrase) => h('span', { style: PS.chip, key: phrase }, phrase)),
                )
              : null,
            h('textarea', {
              style: PS.ta,
              value: value || '',
              spellCheck: false,
              readOnly: readOnly,
              onChange: (event) => setValue(event.target.value),
            }),
            h(
              'div',
              { style: PS.rowFlex },
              readOnly
                ? h('span', { style: PS.counter }, dict.readonly)
                : h(
                    'button',
                    {
                      type: 'button',
                      style: busy || over ? Object.assign({}, PS.primary, PS.btnDisabled) : PS.primary,
                      disabled: busy || over,
                      onClick: () => saveBlock(label),
                    },
                    dict.save,
                  ),
              over ? h('span', { style: PS.err }, '超出预算，需先删减') : null,
            ),
          );
        };

        if (data === null && error === null) {
          return h('div', { style: pageStyle }, h('p', { style: PS.hint }, dict.loading));
        }
        if (error !== null && data === null) {
          return h(
            'div',
            { style: pageStyle },
            h('p', { style: PS.err }, dict.failed + '：' + error),
            h(
              'button',
              { type: 'button', style: PS.btn, onClick: () => { setError(null); setData(null); reload(); } },
              '重试',
            ),
          );
        }

        const present = data.present === true && data.blocks;
        const pending = data.pending || [];
        const usage = data.usage || {};
        const audit = data.audit || {};
        const saveError = data.saveError;

        return h(
          'div',
          { style: pageStyle },
          props && props.variant === 'embedded'
            ? null
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('h2', { style: PS.title }, dict.title),
                h('p', { style: PS.sub }, dict.subtitle),
              ),
          notice
            ? h('div', { style: notice.kind === 'err' ? PS.err : PS.ok }, (notice.kind === 'err' ? '✗ ' : '✓ ') + notice.text)
            : null,
          saveError ? h('div', { style: PS.err }, dict.saveError + '：' + saveError) : null,
          present
            ? h(
                'div',
                { style: PS.meta },
                h('span', null, dict.rev + ' ' + data.revision),
                h('span', null, dict.budget + ' ' + usage.rendered + ' / ' + (data.budget ? data.budget.total : 1100)),
                h('span', null, data.path),
              )
            : null,
          !present
            ? h(
                'div',
                { style: PS.card },
                h('span', { style: PS.label }, dict.absent),
                h('span', { style: PS.hint }, dict.absentHint),
              )
            : null,
          editorFor('persona', personaDraft, setPersonaDraft, present ? data.blocks.persona : { limit: 600, lockedPhrases: [] }),
          editorFor('human', humanDraft, setHumanDraft, present ? data.blocks.human : { limit: 500, lockedPhrases: [] }),
          h(
            'div',
            { style: PS.rowFlex },
            !present
              ? h(
                  'button',
                  { type: 'button', style: busy ? Object.assign({}, PS.primary, PS.btnDisabled) : PS.primary, disabled: busy, onClick: doCreate },
                  dict.create,
                )
              : null,
            present
              ? h('button', { type: 'button', style: busy ? Object.assign({}, PS.btn, PS.btnDisabled) : PS.btn, disabled: busy, onClick: doUndo }, dict.undo)
              : null,
            present
              ? h(
                  'button',
                  { type: 'button', style: PS.btn, onClick: () => setShowPreview((v) => !v) },
                  showPreview ? dict.hidePreview : dict.showPreview,
                )
              : null,
          ),
          present && showPreview
            ? h(
                'div',
                { style: PS.card },
                h('span', { style: PS.label }, dict.preview),
                h('pre', { style: PS.pre }, data.render || ''),
              )
            : null,
          present
            ? h(
                'div',
                { style: PS.card },
                h('span', { style: PS.label }, dict.pending + ' (' + pending.length + ')'),
                pending.length === 0
                  ? h('span', { style: PS.hint }, dict.noPending)
                  : pending.map((item) =>
                      h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6 }, key: item.id },
                        h(
                          'div',
                          { style: PS.rowFlex },
                          h('span', { style: PS.chip }, item.label),
                          h('span', { style: PS.counter }, item.by + ' · ' + new Date(item.at).toLocaleString()),
                          item.reason ? h('span', { style: PS.counter }, item.reason) : null,
                        ),
                        h('pre', { style: PS.pre }, item.value),
                        h(
                          'div',
                          { style: PS.rowFlex },
                          h(
                            'button',
                            { type: 'button', style: PS.primary, disabled: busy, onClick: () => resolveProposal(item.id, 'confirm') },
                            dict.confirm,
                          ),
                          h(
                            'button',
                            { type: 'button', style: PS.btn, disabled: busy, onClick: () => resolveProposal(item.id, 'reject') },
                            dict.reject,
                          ),
                        ),
                      ),
                    ),
              )
            : null,
          present && (audit.personaTraits || audit.humanSlots)
            ? h(
                'div',
                { style: PS.card },
                h('span', { style: PS.label }, dict.audit),
                h(
                  'pre',
                  { style: PS.pre },
                  JSON.stringify(
                    {
                      personaTraits: audit.personaTraits || {},
                      personaInteractionStyle: audit.personaInteractionStyle || {},
                      humanSlots: audit.humanSlots || {},
                      humanFacts: audit.humanFacts || [],
                    },
                    null,
                    2,
                  ),
                ),
              )
            : null,
        );
      };
    }

    /* ---------------- 学习面板（预算 / shadow / CPE / 提醒 / 检索） ---------------- */

    const LEARN_TEXT = {
      zh: {
        nav: '学习',
        title: '学习',
        budget: '这周还能学多少',
        budgetHint: '学新东西有上限，用完就先搁着试用，不会硬塞进我的提示里。',
        used: '已用',
        remaining: '还剩',
        revise: '改旧规则',
        fresh: '加新规则',
        paused: '暂时停学',
        cpe: '改动前的自检',
        cpeHint: '改规则前先跑一遍旧题目；明显不如以前就自动退回。',
        cases: '题目',
        baseline: '上次成绩',
        lastCheck: '最近一次',
        shadow: '试用中的新规则',
        shadowHint: '先记下来观察，不进我的提示；确实有用才正式收下。',
        active: '试用中',
        promoted: '已收下',
        ready: '可收下',
        wouldDo: '想提醒你的事',
        wouldDoHint: '现在只记录、不打扰你。想让我以后真的提醒，再单独开。',
        adopt: '好，我去处理',
        dismiss: '不用管',
        syncHint: '（会同步改任务：处理→进行中，不用管→删除）',
        noWouldDo: '暂时没有要提醒的',
        retrieval: '记忆找得准不准',
        retrievalHint: '用你真问过的问题抽查：该找到的东西有没有找到。',
        logged: '查过',
        zeroRate: '什么都没找到',
        top1: '第一条就对',
        top3: '前三条里有',
        feedback: '你的反馈记到了吗',
        feedbackHint: '我注入了多少轮内容、你说过几次「不对」「没错」。',
        audit: '体检报告',
        auditHint: '分四项看，不给总分——不同维度本来就是不同的事。',
        tickets: '工单',
        ticketsHint: '把「积压的事」按阶段摆开：草稿、待办、进行中、待验收、已完成。',
        stage: { draft: '草稿', open: '待办', doing: '进行中', review: '待验收', done: '已完成' },
        deliverable: '产物',
        deliverableHint: '做完要交什么？写一句就够。',
        background: '背景',
        blockedBy: '依赖',
        save: '保存',
        next: '下一步',
        advance: '推进',
        empty: '空',
        evaluator: '谁评的',
        provider: '谁评的',
        repair: '修一下',
        reparired: '已修复',
        turns: '轮',
        corrected: '说不对',
        confirmed: '说没错',
        style: '说话风格',
        styleHint: '只看句长这类统计，不保存原话。',
        recording: '正在记录',
        modeRecordOnly: '只记录',
        modeByRule: '按你定的规则',
        modeAuto: '可主动提醒',
        insufficient: '数据还不够',
        green: '正常',
        yellow: '有点偏',
        red: '要注意',
        loading: '加载中…',
        failed: '加载失败',
        refresh: '刷新',
        checkpoint: '自检一下',
        done: '记下了',
        register: '场合判定（只记录，未改行为）',
        registerHint: '每轮判一次「干活还是闲聊」。现在只攒样本、不改任何注入内容；你标出判错的，我才敢动阈值。',
        registerEmpty: '还没有记录。说几句话就会开始积累。',
        registerVerdict: { work: '干活', chat: '闲聊' },
        registerMarkWrong: '判错了',
        registerWrong: '已标判错',
      },
      en: {
        nav: 'Learning',
        title: 'Learning',
        budget: 'How much it can learn this week',
        budgetHint: 'Learning has a weekly cap; beyond it, new items wait in trial instead of being injected.',
        used: 'used',
        remaining: 'left',
        revise: 'edit rules',
        fresh: 'add rules',
        paused: 'paused',
        cpe: 'Self-check before changes',
        cpeHint: 'Re-runs old questions first; if clearly worse, the change is reverted.',
        cases: 'questions',
        baseline: 'last score',
        lastCheck: 'last run',
        shadow: 'New rules on trial',
        shadowHint: 'Observed only, never injected; kept only if it proves useful.',
        active: 'on trial',
        promoted: 'kept',
        ready: 'ready',
        wouldDo: 'Things it wanted to remind you',
        wouldDoHint: 'Recorded only, no interruption. Turn on reminders later if you want.',
        adopt: 'On it',
        dismiss: 'Skip',
        noWouldDo: 'Nothing to remind right now',
        retrieval: 'Is memory finding the right thing',
        retrievalHint: 'Spot-checks with questions you actually asked.',
        logged: 'looked up',
        zeroRate: 'found nothing',
        top1: 'right on first',
        top3: 'in top three',
        feedback: 'Is your feedback recorded',
        feedbackHint: 'How many turns were injected, and how often you said "wrong"/"right".',
        turns: 'turns',
        corrected: 'said wrong',
        confirmed: 'said right',
        style: 'Speaking style',
        styleHint: 'Length-type stats only; raw text is not stored.',
        recording: 'recording',
        modeRecordOnly: 'record only',
        modeByRule: 'by your rule',
        modeAuto: 'may remind',
        insufficient: 'not enough data',
        green: 'ok',
        yellow: 'slightly off',
        red: 'attention',
        loading: 'Loading…',
        failed: 'Load failed',
        refresh: 'Refresh',
        checkpoint: 'Run self-check',
        done: 'Noted',
        register: 'Work vs chitchat (record only)',
        registerHint: 'Judged every turn. Nothing is changed yet — it only collects samples; you mark the wrong ones before any threshold moves.',
        registerEmpty: 'No records yet. They start accumulating as you talk.',
        registerVerdict: { work: 'work', chat: 'chitchat' },
        registerMarkWrong: 'Misjudged',
        registerWrong: 'marked wrong',
      },
    };

    function learnText(ctx) {
      let id = 'zh';
      try {
        const snap = ctx && ctx.locale && typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : null;
        id = (snap && (snap.id || snap.locale || snap.language)) || 'zh';
      } catch {
        id = 'zh';
      }
      return String(id).toLowerCase().startsWith('en') ? LEARN_TEXT.en : LEARN_TEXT.zh;
    }

    const LS = {
      barTrack: {
        position: 'relative',
        height: 6,
        borderRadius: 3,
        background: 'transparent',
        overflow: 'hidden',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, background: 'var(--dsw-alias-label-primary)' },
      kv: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      badge: (kind) => ({
        fontSize: 11,
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        color:
          kind === 'green'
            ? 'var(--dsw-alias-state-success-primary)'
            : kind === 'yellow'
              ? 'var(--dsw-alias-state-warn-primary)'
              : kind === 'red'
                ? 'var(--dsw-alias-state-error-primary)'
                : 'var(--dsw-alias-label-secondary)',
      }),
      item: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 0 8px 10px',
        borderLeft: '2px solid var(--dsw-alias-border-l2)',
      },
    };

    function statusWord(dict, status) {
      if (status === 'green') return dict.green;
      if (status === 'yellow' || status === 'orange') return dict.yellow;
      if (status === 'red') return dict.red;
      return dict.insufficient;
    }

    /* ---------------- 超级代理页签：只读镜像 dsh-superagent ---------------- */

    const SA_TEXT = {
      zh: {
        title: '超级代理',
        hint: '只读镜像 superagent 的工单与健康状态，字段可能随它的版本变化。派活、改它的配置请去它自己的面板。',
        online: '已连接',
        unreachable: '未连接',
        retryHint: 'superagent 没起，或 WSL 端口没通。',
        failed: '读取失败',
        loading: '加载中…',
        refresh: '刷新',
        paused: '已暂停处理',
        pause: '暂停处理',
        resume: '继续处理',
        running: '执行中',
        queued: '排队',
        maxWorkers: '并发上限',
        noTickets: '现在没有工单',
        needsPerson: '需要你',
        working: '进行中',
        idle: '等待',
        other: '其他',
        retry: '重试',
        stop: '停止',
        actionOk: '已提交',
        actionFailed: '操作失败',
        healthProblems: '有问题的部件',
        healthAllOk: '部件全部正常',
        dispatch: '派活',
        dispatchHint: '写一句要它做的事，生成派单文本。到你已登录的 GitHub 里发评论或新建 Issue。',
        dispatchPlaceholder: '例如：把这个仓库的 README 补一节安装说明',
        copy: '复制',
        copied: '已复制',
        openIssue: '打开新建 Issue',
        needRepo: '（未配置 superagentRepo，只能复制文本）',
        link: '关联本地工单',
        linkNone: '（不关联）',
        stage: { person: '需要你', working: '进行中', idle: '等待', unknown: '其他' },
      },
      en: {
        title: 'Super-agent',
        hint: 'Read-only mirror of superagent tickets and health; fields may change with its version. Dispatch and its own settings live in its panel.',
        online: 'connected',
        unreachable: 'not reachable',
        retryHint: 'superagent is not running, or the WSL port is not forwarded.',
        failed: 'read failed',
        loading: 'Loading…',
        refresh: 'Refresh',
        paused: 'processing paused',
        pause: 'Pause processing',
        resume: 'Resume processing',
        running: 'running',
        queued: 'queued',
        maxWorkers: 'max workers',
        noTickets: 'No tickets right now',
        needsPerson: 'Needs you',
        working: 'Working',
        idle: 'Idle',
        other: 'Other',
        retry: 'Retry',
        stop: 'Stop',
        actionOk: 'Submitted',
        actionFailed: 'Action failed',
        healthProblems: 'Parts with problems',
        healthAllOk: 'All parts healthy',
        dispatch: 'Dispatch',
        dispatchHint: 'Write one line; get a dispatch text. Post it as a comment or new Issue in GitHub where you are signed in.',
        dispatchPlaceholder: 'e.g. add an install section to this repo’s README',
        copy: 'Copy',
        copied: 'Copied',
        openIssue: 'Open new Issue',
        needRepo: '(superagentRepo not configured; copy the text instead)',
        link: 'Link local ticket',
        linkNone: '(none)',
        stage: { person: 'needs you', working: 'working', idle: 'idle', unknown: 'other' },
      },
    };

    function superagentText(ctx) {
      let id = 'zh';
      try {
        const snap = ctx && ctx.locale && typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : null;
        id = (snap && (snap.id || snap.locale || snap.language)) || 'zh';
      } catch {
        id = 'zh';
      }
      return String(id).toLowerCase().startsWith('en') ? SA_TEXT.en : SA_TEXT.zh;
    }

    function createSuperagentPane(ctx) {
      return function SuperagentPane() {
        const dict = superagentText(ctx);
        const [data, setData] = React.useState(null);
        const [failure, setFailure] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const [draft, setDraft] = React.useState('');
        const [copied, setCopied] = React.useState(false);
        const [localTickets, setLocalTickets] = React.useState([]);

        const load = React.useCallback(async () => {
          try {
            const [res, tRes] = await Promise.all([
              fetch('/cognition-engine/superagent/overview', { cache: 'no-store' }),
              fetch('/cognition-engine/tickets', { cache: 'no-store' }).catch(() => null),
            ]);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            setData(await res.json());
            if (tRes && tRes.ok) {
              const board = (await tRes.json()).board || [];
              // 只取还活着的本地工单（草稿/待办/进行中/待验收），用于关联
              const flat = [];
              for (const col of board) {
                if (col.stage === 'done') continue;
                for (const item of col.items || []) flat.push(item);
              }
              setLocalTickets(flat);
            }
            setFailure(null);
          } catch (error) {
            setFailure(error && error.message ? error.message : String(error));
          }
        }, []);

        React.useEffect(() => {
          load();
        }, [load]);

        const act = async (query) => {
          setBusy(true);
          setNotice(null);
          try {
            const res = await fetch('/cognition-engine/superagent/action?' + query, { method: 'POST', cache: 'no-store' });
            const json = await res.json().catch(() => ({}));
            setNotice(json && json.ok ? dict.actionOk : dict.actionFailed + (json && json.error ? '：' + json.error : ''));
            await load();
          } catch (error) {
            setNotice(dict.actionFailed + '：' + (error && error.message ? error.message : String(error)));
          } finally {
            setBusy(false);
          }
        };

        if (failure !== null) return h('div', { style: S.empty }, dict.failed + '：' + failure);
        if (data === null) return h('div', { style: S.empty }, dict.loading);

        const header = h(
          'div',
          { style: { display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' } },
          h('span', { style: LS.badge(data.reachable ? (data.paused ? 'yellow' : 'green') : 'red') }, data.reachable ? (data.paused ? dict.paused : dict.online) : dict.unreachable),
          h('span', { style: LS.explain }, data.baseUrl || ''),
          data.load
            ? h('span', { style: LS.kv }, h('span', null, `${dict.running} ${data.load.running}`), h('span', null, `${dict.queued} ${data.load.queued}`), h('span', null, `${dict.maxWorkers} ${data.load.maxWorkers}`))
            : null,
          h(
            'button',
            { type: 'button', style: PS.btn, onClick: load, disabled: busy },
            dict.refresh,
          ),
        );

        if (!data.reachable) {
          return h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            header,
            h('div', { style: LS.item }, h('div', { style: LS.explain }, data.error || dict.retryHint)),
          );
        }

        const tickets = data.tickets || [];
        // C：外部工单 ↔ 本地工单的关联（只存引用，不合并两套状态机）
        const linkedLocal = (externalId) => {
          const found = localTickets.find((lt) => lt.linkedTicket === externalId);
          return found ? found.id : '';
        };
        const applyLink = async (externalId, localId) => {
          setBusy(true);
          setNotice(null);
          try {
            const prev = localTickets.find((lt) => lt.linkedTicket === externalId);
            if (prev && prev.id !== localId) {
              await fetch('/cognition-engine/tickets/link?id=' + encodeURIComponent(prev.id) + '&ticket=', { method: 'POST', cache: 'no-store' });
            }
            if (localId) {
              await fetch('/cognition-engine/tickets/link?id=' + encodeURIComponent(localId) + '&ticket=' + encodeURIComponent(externalId), { method: 'POST', cache: 'no-store' });
            }
            await load();
          } finally {
            setBusy(false);
          }
        };
        const group = (key, label, items) =>
          items.length === 0
            ? null
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 }, key },
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                  h('span', { style: { fontSize: 12, fontWeight: 600 } }, label),
                  h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, String(items.length)),
                ),
                items.map((t) =>
                  h(
                    'div',
                    { style: LS.item, key: t.id },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
                      h('span', { style: LS.badge(t.stage === 'person' ? 'yellow' : t.stage === 'working' ? 'green' : 'red') }, dict.stage[t.stage] || dict.stage.unknown),
                      t.action ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t.action) : null,
                      t.assignments ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '×' + t.assignments) : null,
                      h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', marginLeft: 'auto' } }, String(t.id).slice(0, 8)),
                    ),
                    h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } }, t.title),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' } },
                      t.canRetry
                        ? h('button', { type: 'button', style: PS.btn, disabled: busy, onClick: () => act('action=retry&id=' + encodeURIComponent(t.id)) }, dict.retry)
                        : null,
                      t.canStop
                        ? h('button', { type: 'button', style: PS.btn, disabled: busy, onClick: () => act('action=stop&id=' + encodeURIComponent(t.id)) }, dict.stop)
                        : null,
                      h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, dict.link),
                      h(
                        'select',
                        {
                          style: { fontSize: 11, padding: '2px 6px', borderRadius: 6, background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2)' },
                          value: linkedLocal(t.id),
                          disabled: busy || localTickets.length === 0,
                          onChange: (event) => applyLink(t.id, event.target.value),
                        },
                        h('option', { value: '' }, dict.linkNone),
                        localTickets.map((lt) =>
                          h('option', { value: lt.id, key: lt.id }, String(lt.deliverable || lt.action || lt.id).slice(0, 28)),
                        ),
                      ),
                    ),
                  ),
                ),
              );

        const unhealthy = data.unhealthy || [];
        const issueUrl =
          data.repo && draft.trim().length > 0
            ? 'https://github.com/' +
              data.repo +
              '/issues/new?title=' +
              encodeURIComponent(draft.trim().slice(0, 80)) +
              '&body=' +
              encodeURIComponent(draft.trim())
            : null;

        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          header,
          h('div', { style: LS.explain }, dict.hint),
          notice ? h('div', { style: { ...LS.explain, color: 'var(--dsw-alias-state-success-primary)' } }, notice) : null,
          // 暂停/继续
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h(
              'button',
              { type: 'button', style: PS.btn, disabled: busy, onClick: () => act('action=' + (data.paused ? 'resume' : 'pause')) },
              data.paused ? dict.resume : dict.pause,
            ),
          ),
          // 健康问题
          unhealthy.length > 0
            ? h(
                'div',
                { style: LS.item },
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } }, h('span', { style: LS.badge('red') }, dict.healthProblems), h('span', { style: { fontSize: 11 } }, String(unhealthy.length))),
                unhealthy.map((h2) =>
                  h('div', { style: LS.explain, key: h2.name }, `${h2.name} · ${h2.state}${h2.detail ? ' · ' + h2.detail : ''}`),
                ),
              )
            : h('div', { style: LS.explain }, dict.healthAllOk),
          // 工单
          tickets.length === 0
            ? h('div', { style: S.empty }, dict.noTickets)
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                group('person', dict.needsPerson, tickets.filter((t) => t.stage === 'person')),
                group('working', dict.working, tickets.filter((t) => t.stage === 'working')),
                group('idle', dict.idle, tickets.filter((t) => t.stage === 'idle')),
                group('other', dict.other, tickets.filter((t) => t.stage !== 'person' && t.stage !== 'working' && t.stage !== 'idle')),
              ),
          // 派活（D）：生成文本 + 可选新建 Issue 链接；不存任何凭据
          h(
            'div',
            { style: LS.item },
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, dict.dispatch),
            h('div', { style: LS.explain }, dict.dispatchHint),
            h('textarea', {
              style: Object.assign({}, PS.ta, { minHeight: 60 }),
              placeholder: dict.dispatchPlaceholder,
              value: draft,
              onChange: (event) => {
                setDraft(event.target.value);
                setCopied(false);
              },
            }),
            h(
              'div',
              { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h(
                'button',
                {
                  type: 'button',
                  style: PS.btn,
                  disabled: draft.trim().length === 0,
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(draft.trim());
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  },
                },
                copied ? dict.copied : dict.copy,
              ),
              issueUrl
                ? h('a', { href: issueUrl, target: '_blank', rel: 'noreferrer', style: Object.assign({}, PS.btn, { textDecoration: 'none', display: 'inline-block' }) }, dict.openIssue)
                : h('span', { style: LS.explain }, dict.needRepo),
            ),
          ),
        );
      };
    }

    function createLearningPage(ctx) {
      return function LearningPage(props) {
        const dict = learnText(ctx);
        const embedded = props && props.variant === 'embedded';
        const pageStyle = embedded ? PS.pageEmbedded : PS.page;
        const [state, setState] = React.useState(null);
        const [proactive, setProactive] = React.useState(null);
        const [cpe, setCpe] = React.useState(null);
        const [retrieval, setRetrieval] = React.useState(null);
        const [shadow, setShadow] = React.useState(null);
        const [audit, setAudit] = React.useState(null);
        const [tickets, setTickets] = React.useState(null);
        const [register, setRegister] = React.useState(null);
        const [error, setError] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(null);

        const load = React.useCallback(async () => {
          try {
            const [a, b, c, d, e] = await Promise.all([
              fetch('/cognition-engine/state', { cache: 'no-store' }).then((r) => r.json()),
              fetch('/cognition-engine/proactive', { cache: 'no-store' }).then((r) => r.json()),
              fetch('/cognition-engine/cpe', { cache: 'no-store' }).then((r) => r.json()),
              fetch('/cognition-engine/retrieval', { cache: 'no-store' }).then((r) => r.json()),
              fetch('/cognition-engine/shadow', { cache: 'no-store' }).then((r) => r.json()),
            ]);
            setState(a);
            setProactive(b);
            setCpe(c);
            setRetrieval(d);
            setShadow(e);
            try {
              setAudit(await fetch('/cognition-engine/audit/dimensions', { cache: 'no-store' }).then((r) => r.json()));
            } catch {
              setAudit(null);
            }
            try {
              setTickets(await fetch('/cognition-engine/tickets', { cache: 'no-store' }).then((r) => r.json()));
            } catch {
              setTickets(null);
            }
            try {
              setRegister(await fetch('/cognition-engine/register?limit=12', { cache: 'no-store' }).then((r) => r.json()));
            } catch {
              setRegister(null);
            }
            setError(null);
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          }
        }, []);

        React.useEffect(() => {
          load();
        }, [load]);

        const post = async (path) => {
          setBusy(true);
          setNotice(null);
          try {
            const res = await fetch(path, { method: 'POST', cache: 'no-store' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
            setNotice(dict.done);
            await load();
            return json;
          } catch (err) {
            setNotice('✗ ' + (err && err.message ? err.message : String(err)));
          } finally {
            setBusy(false);
          }
        };

        if (state === null && error === null) {
          return h('div', { style: pageStyle }, h('p', { style: PS.hint }, dict.loading));
        }
        if (error !== null && state === null) {
          return h(
            'div',
            { style: pageStyle },
            h('p', { style: PS.err }, dict.failed + '：' + error),
            h('button', { type: 'button', style: PS.btn, onClick: () => { setError(null); load(); } }, dict.refresh),
          );
        }

        const budget = state.budget || {};
        const quota = budget.quota || { total: 0, revise: 0, new: 0 };
        const used = budget.used || { total: 0, revise: 0, new: 0 };
        const ratio = quota.total > 0 ? Math.min(1, used.total / quota.total) : 0;
        const cpeInfo = cpe || {};
        const retInfo = retrieval || {};
        const shadowInfo = shadow || {};
        const pending = (proactive && proactive.pending) || [];
        const fb = state.feedback || {};
        const st = state.style || {};

        const card = (title, hint, children) =>
          h(
            'div',
            { style: PS.card },
            h(
              'div',
              { style: PS.blockHead },
              h('span', { style: PS.label }, title),
              hint ? h('span', { style: PS.counter }, hint) : null,
            ),
            children,
          );

        return h(
          'div',
          { style: pageStyle },
          embedded
            ? null
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('h2', { style: PS.title }, dict.title),
              ),
          notice ? h('div', { style: notice.startsWith('✗') ? PS.err : PS.ok }, notice) : null,
          h(
            'div',
            { style: PS.rowFlex },
            h('button', { type: 'button', style: PS.btn, onClick: () => load(), disabled: busy }, dict.refresh),
            h('button', { type: 'button', style: PS.btn, onClick: () => post('/cognition-engine/cpe/check'), disabled: busy }, dict.checkpoint),
          ),

          // —— 本周预算 ——
          card(
            dict.budget + (budget.paused ? ' · ' + dict.paused : ''),
            dict.budgetHint,
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              h('div', { style: LS.barTrack }, h('div', { style: { ...LS.barFill, width: Math.round(ratio * 100) + '%' } })),
              h(
                'div',
                { style: LS.kv },
                h('span', null, `${dict.used} ${used.total}/${quota.total}`),
                h('span', null, `${dict.revise} ${used.revise}/${quota.revise}`),
                h('span', null, `${dict.fresh} ${used.new}/${quota.new}`),
              ),
              budget.pauseReason ? h('div', { style: PS.err }, budget.pauseReason) : null,
            ),
          ),

          // —— CPE ——
          card(
            dict.cpe,
            dict.cpeHint,
            h(
              'div',
              { style: LS.kv },
              h('span', null, `${dict.cases} ${(cpeInfo.holdout && cpeInfo.holdout.cases) || 0}`),
              h('span', null, `${dict.baseline} ${cpeInfo.baseline ? cpeInfo.baseline.passRate : '-'}`),
              h('span', null, `${dict.lastCheck} ${statusWord(dict, (cpeInfo.lastCheck && cpeInfo.lastCheck.status) || 'insufficient')}`),
              h('span', { style: LS.badge((cpeInfo.lastCheck && cpeInfo.lastCheck.status) || 'insufficient') }, statusWord(dict, (cpeInfo.lastCheck && cpeInfo.lastCheck.status) || 'insufficient')),
            ),
          ),

          // —— shadow ——
          card(
            dict.shadow,
            dict.shadowHint,
            h(
              'div',
              { style: LS.kv },
              h('span', null, `${dict.active} ${(shadowInfo.stats && shadowInfo.stats.active) || 0}`),
              h('span', null, `${dict.promoted} ${(shadowInfo.stats && shadowInfo.stats.promoted) || 0}`),
              h('span', null, `${dict.ready} ${(shadowInfo.stats && shadowInfo.stats.readyToPromote) || 0}`),
            ),
          ),

          // —— 主动提醒 ——
          card(
            dict.wouldDo +
              ' · ' +
              ((proactive && proactive.phase) === 'P2'
                ? dict.modeByRule
                : (proactive && proactive.phase) === 'P3'
                  ? dict.modeAuto
                  : dict.modeRecordOnly),
            dict.wouldDoHint,
            pending.length === 0
              ? h('span', { style: PS.hint }, dict.noWouldDo)
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  pending.slice(0, 6).map((item) =>
                    h(
                      'div',
                      { style: LS.item, key: item.id },
                      h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } }, item.action),
                      h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, item.userAction + ' · ' + item.benefit),
                      h(
                        'div',
                        { style: PS.rowFlex },
                        h('button', { type: 'button', style: PS.btn, disabled: busy, onClick: () => post('/cognition-engine/proactive/adopt?id=' + encodeURIComponent(item.id)) }, dict.adopt),
                        h('button', { type: 'button', style: PS.btn, disabled: busy, onClick: () => post('/cognition-engine/proactive/dismiss?id=' + encodeURIComponent(item.id)) }, dict.dismiss),
                        item.kind === 'pending-due'
                          ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, dict.syncHint)
                          : null,
                      ),
                    ),
                  ),
                ),
          ),

          // —— 检索度量 ——
          card(
            dict.retrieval,
            dict.retrievalHint,
            h(
              'div',
              { style: LS.kv },
              h('span', null, `${dict.logged} ${(retInfo.logs && retInfo.logs.total) || 0}`),
              h('span', null, `${dict.zeroRate} ${retInfo.logs ? Math.round((retInfo.logs.zeroRate || 0) * 100) + '%' : '-'}`),
              h('span', null, `${dict.top1} ${retInfo.eval && retInfo.eval.top1 !== null ? Math.round(retInfo.eval.top1 * 100) + '%' : '-'}`),
              h('span', null, `${dict.top3} ${retInfo.eval && retInfo.eval.top3 !== null ? Math.round(retInfo.eval.top3 * 100) + '%' : '-'}`),
              h('span', { style: LS.badge((retInfo.eval && retInfo.eval.status) || 'insufficient') }, statusWord(dict, (retInfo.eval && retInfo.eval.status) || 'insufficient')),
            ),
          ),

          // —— 体检报告（分维度，不给总分）——
          audit && audit.dimensions
            ? card(
                dict.audit,
                dict.auditHint,
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  audit.dimensions.map((dim) =>
                    h(
                      'div',
                      { style: LS.item, key: dim.key },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
                        h('span', { style: { fontSize: 12, fontWeight: 600 } }, dim.title),
                        h('span', { style: LS.badge(dim.status === 'attention' ? 'red' : dim.status) }, statusWord(dict, dim.status)),
                        h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } }, dim.evaluator),
                      ),
                      h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, dim.note),
                      dim.key === 'memory' && dim.facts && dim.facts.orphans > 0
                        ? h(
                            'button',
                            {
                              type: 'button',
                              style: PS.btn,
                              disabled: busy,
                              onClick: () => post('/cognition-engine/memory/repair'),
                            },
                            dict.repair + '（' + dim.facts.orphans + '）',
                          )
                        : null,
                    ),
                  ),
                ),
              )
            : null,

          // —— 工单看板（S10）——
          tickets && tickets.board
            ? card(
                dict.tickets,
                dict.ticketsHint,
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  tickets.board.map((col) =>
                    h(
                      'div',
                      { key: col.stage, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
                        h('span', { style: { fontSize: 12, fontWeight: 600 } }, dict.stage[col.stage] || col.label),
                        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, col.items.length + ' 项'),
                      ),
                      col.items.length === 0
                        ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', paddingLeft: 2 } }, dict.empty)
                        : col.items.map((t) =>
                            h(
                              'div',
                              { style: LS.item, key: t.id },
                              h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } }, t.action),
                              t.deliverable
                                ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, dict.deliverable + '：' + t.deliverable)
                                : null,
                              h(
                                'div',
                                { style: PS.rowFlex },
                                ['draft', 'open', 'doing', 'review', 'done']
                                  .filter((s) => s !== t.stage)
                                  .slice(0, 2)
                                  .map((s) =>
                                    h(
                                      'button',
                                      {
                                        type: 'button',
                                        style: PS.btn,
                                        disabled: busy,
                                        key: s,
                                        onClick: () =>
                                          post(
                                            '/cognition-engine/tickets/stage?id=' +
                                              encodeURIComponent(t.id) +
                                              '&stage=' +
                                              s,
                                          ),
                                      },
                                      dict.stage[s],
                                    ),
                                  ),
                                h(
                                  'input',
                                  {
                                    placeholder: dict.deliverableHint,
                                    defaultValue: t.deliverable || '',
                                    style: Object.assign({}, PS.ta, { minHeight: 0, height: 26, padding: '2px 8px', fontSize: 11, flex: '1 1 120px' }),
                                    onKeyDown: (event) => {
                                      if (event.key !== 'Enter') return;
                                      const v = event.target.value || '';
                                      post(
                                        '/cognition-engine/tickets/update?id=' +
                                          encodeURIComponent(t.id) +
                                          '&deliverable=' +
                                          encodeURIComponent(v),
                                      );
                                    },
                                  },
                                ),
                              ),
                            ),
                          ),
                    ),
                  ),
                ),
              )
            : null,

          // —— 场合判定（只记录，不改行为）——
          register && register.overview
            ? card(
                dict.register,
                dict.registerHint,
                h(
                  'div',
                  { style: LS.kv },
                  h('span', null, `共 ${register.overview.total} 轮`),
                  h('span', null, `干活 ${register.overview.work}`),
                  h('span', null, `闲聊 ${register.overview.chat}`),
                  h('span', null, `兜底 ${register.overview.uncertain}`),
                  h(
                    'span',
                    null,
                    `关键词 ${register.overview.byLayer.keyword} / 打分 ${register.overview.byLayer.score} / 兜底 ${register.overview.byLayer.fallback}`,
                  ),
                  register.overview.labelled > 0
                    ? h('span', null, `已标 ${register.overview.labelled}，判错 ${register.overview.wrong}`)
                    : null,
                ),
                (register.recent || []).length === 0
                  ? h('span', { style: LS.explain }, dict.registerEmpty)
                  : h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                      (register.recent || []).map((row, index) =>
                        h(
                          'div',
                          { style: LS.item, key: `${row.sessionId}-${row.turn}-${index}` },
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
                            h('span', { style: LS.badge(row.verdict === 'chat' ? 'yellow' : 'green') }, dict.registerVerdict[row.verdict] || row.verdict),
                            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `第 ${row.turn} 轮`),
                            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `${row.confidence}`),
                            row.label === 'wrong'
                              ? h('span', { style: LS.badge('red') }, dict.registerWrong)
                              : null,
                          ),
                          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' } }, row.excerpt || '（空）'),
                          h('span', { style: LS.explain }, row.reason),
                          row.label === 'wrong'
                            ? null
                            : h(
                                'button',
                                {
                                  type: 'button',
                                  style: { ...PS.btn, padding: '2px 8px', fontSize: 11, marginTop: 2 },
                                  disabled: busy,
                                  onClick: () =>
                                    post(
                                      '/cognition-engine/register/label?sessionId=' +
                                        encodeURIComponent(row.sessionId) +
                                        '&turn=' +
                                        row.turn +
                                        '&label=wrong',
                                    ),
                                },
                                dict.registerMarkWrong,
                              ),
                        ),
                      ),
                    ),
              )
            : null,

          // —— 反馈闭环 + 风格 ——
          card(
            dict.feedback,
            dict.feedbackHint,
            h(
              'div',
              { style: LS.kv },
              h('span', null, `${dict.turns} ${fb.total || 0}`),
              h('span', null, `${dict.corrected} ${fb.corrected || 0}`),
              h('span', null, `${dict.confirmed} ${fb.confirmed || 0}`),
              h('span', null, `${dict.recording} ${fb.tracking ? '✓' : '✗'}`),
              h('span', null, `${dict.style} ${st.turns || 0} ${dict.turns}`),
              h('span', { style: LS.badge(st.status || 'insufficient') }, statusWord(dict, st.status || 'insufficient')),
            ),
          ),
        );
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 降级：手机端或精简渲染层可能没有 slots 服务，此时不显示状态条，但不影响插件其他功能
        if (!ctx || !ctx.slots || typeof ctx.slots.register !== 'function') {
          return;
        }
        // 输入框上方的浮层入口已移除：东西太多反而挡视线，
        // 认知引擎统一走侧边栏一级面板（下方注册）。工具与记忆功能完全不受影响。

        // 侧边栏一级面板：整列铺满，六个页签不再挤在输入框上方的小浮层里。
        //
        // **关键**：`sidebar.panellist` 注册的是**图标**，`main` 注册的才是**面板主体**。
        // 之前只注册了 panellist，结果整个面板被当成图标塞进侧栏列表里、
        // 把工作区列表盖住了——这正是用户在截图里看到的那个问题。
        try {
          const Panel = createSidebarPanel(ctx);
          const CogIcon = (props) =>
            h(
              'svg',
              {
                width: (props && props.size) || 16,
                height: (props && props.size) || 16,
                viewBox: '0 0 16 16',
                fill: 'none',
                'aria-hidden': true,
                style: { display: 'block' },
              },
              h('circle', { cx: 8, cy: 8, r: 5.2, stroke: 'currentColor', strokeWidth: 1.4 }),
              h('circle', { cx: 8, cy: 8, r: 1.8, stroke: 'currentColor', strokeWidth: 1.4 }),
              h('path', { d: 'M8 1.4v2.2M8 12.4v2.2M1.4 8h2.2M12.4 8h2.2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
            );

          // 1) 主列面板主体：按 key 注册，key 与侧栏图标 id 相同才会被点开
          ctx.slots.inject('main', () => [
            ctx.slots.register({ name: 'main', key: 'cognition-engine', label: () => pickDict(ctx).name }, Panel),
          ]);
          // 2) 侧栏图标：只放图标，不放整个面板
          ctx.slots.inject('sidebar.panellist', () => [
            ctx.slots.register({ name: 'sidebar.panellist', id: 'cognition-engine', order: 30, label: () => pickDict(ctx).name }, CogIcon),
          ]);
        } catch (error) {
          if (ctx.logger && typeof ctx.logger.warn === 'function') {
            ctx.logger.warn('cognition-engine: 侧边栏面板注册失败，已跳过');
          }
        }

        // 设置里的人格页签已移除：人格就在侧边栏面板的「人格」页签里，
        // 两处入口只会让人困惑「改哪边生效」。设置页保持干净。
      },
    };
  },
});
