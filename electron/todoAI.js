/**
 * todoAI.js — AI-powered TODO management via Anthropic-format streaming API.
 *
 * Supports all Anthropic-format providers configured in the app:
 *   glm, minimax, kimi, qwencp
 *
 * IPC channels (renderer → main):
 *   todo:chat:start         — { providerId, providerConfigs, messages, todos }
 *   todo:chat:abort         — abort current in-flight request
 *   todo:providers:available — { providerConfigs } → [providerId, ...]
 *
 * IPC push events (main → renderer):
 *   todo:stream:chunk   — { text }  text delta during generation
 *   todo:stream:done    — { stopReason, toolCalls: [{ id, name, input }] }
 *   todo:stream:error   — { message }
 *
 * Architecture: renderer manages the multi-turn loop.
 * When stopReason === 'tool_use', renderer executes tools via Zustand store,
 * then calls startTodoChat again with updated messages (including tool_result).
 * Main process is stateless: one IPC call = one API request.
 */

const https   = require('https');
const http    = require('http');
const { ipcMain, BrowserWindow } = require('electron');
const { getKey }           = require('./keychain');
const { PROVIDER_CATALOG } = require('./tools');

// ─── In-flight request state ─────────────────────────────────────────────────

let _currentReq       = null;
let _currentRequestId = 0;

// ─── Tool definitions (Anthropic tool-use format) ────────────────────────────

const TODO_TOOLS = [
  {
    name: 'add_todo',
    description: '添加一个新的待办事项',
    input_schema: {
      type: 'object',
      properties: {
        text:      { type: 'string', description: '待办内容' },
        priority:  { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: '优先级' },
        dueDate:   { type: 'string', description: '截止日期 YYYY-MM-DD，可不填' },
        projectId: { type: 'string', description: '关联项目的 ID，不填则使用当前项目' },
      },
      required: ['text'],
    },
  },
  {
    name: 'update_todo',
    description: '更新一个已有待办事项的内容、优先级或截止日期',
    input_schema: {
      type: 'object',
      properties: {
        id:       { type: 'string', description: '待办事项的 ID（列表中方括号内的字符串）' },
        text:     { type: 'string', description: '新的待办内容（可选）' },
        priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: '新的优先级（可选）' },
        dueDate:  { type: 'string', description: '新的截止日期 YYYY-MM-DD；传空字符串表示清除' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_todo',
    description: '删除一个待办事项（不可撤销）',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '待办事项的 ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'toggle_todo_done',
    description: '切换一个待办事项的完成/未完成状态',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '待办事项的 ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'bulk_create_todos',
    description: '批量添加多个待办事项',
    input_schema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: '要批量添加的待办列表',
          items: {
            type: 'object',
            properties: {
              text:      { type: 'string' },
              priority:  { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
              dueDate:   { type: 'string' },
              projectId: { type: 'string', description: '关联项目的 ID' },
            },
            required: ['text'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'clear_done_todos',
    description: '清除所有已完成的待办事项',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(todos, projectContext) {
  const today = new Date().toISOString().slice(0, 10);
  const todoList = todos.length === 0
    ? '（当前没有待办事项）'
    : todos.map((t) => {
        const statusStr = t.status === 'done' ? '[✓]' : t.status === 'in_progress' ? '[~]' : '[ ]';
        const priStr = (t.priority && t.priority !== 'none') ? ` [${t.priority}]` : '';
        const dueStr = t.dueDate ? ` (截止: ${t.dueDate})` : '';
        const projStr = t.projectId ? ` (项目ID: ${t.projectId})` : ' (全局)';
        return `${statusStr} [${t.id}] ${t.text}${priStr}${dueStr}${projStr}`;
      }).join('\n');

  const projectSection = projectContext
    ? `## 当前项目\n项目名称: ${projectContext.name}\n项目路径: ${projectContext.path}\n\n用户正在这个项目下工作，优先管理该项目的待办。`
    : '';

  const projectNameHint = projectContext ? projectContext.name : '全局';

  return `你是智枢 (ZhiShu) AI 终端管理器内置的待办助手。帮助用户高效管理开发工作的待办事项。

${projectSection}

## 今日
${today}

## 当前待办列表
${todoList}

## 工作原则
- 用提供的工具（add_todo/update_todo/delete_todo/toggle_todo_done/bulk_create_todos/clear_done_todos）来管理待办
- 操作前先确认意图，操作后简要告知结果
- 操作时必须使用列表中 [id] 里的实际 ID，不要假设
- 如果用户说"第一个"、"高优先级的"等相对引用，先从列表推断出 ID
- 用中文回复，简洁友好
- 不要重复显示整个待办列表，用户已经能看到列表了
- 如果用户说"加个 TODO"、"记一下"，默认添加到当前项目 (${projectNameHint})
- 可以用 projectId 字段指定项目`;
}

// ─── Provider config resolution ───────────────────────────────────────────────

function resolveProviderConfig(providerId, providerConfigs) {
  const catalog = PROVIDER_CATALOG[providerId];
  if (!catalog) return null;
  const userCfg = (providerConfigs && providerConfigs[providerId]) || {};
  return {
    baseUrl: userCfg.baseUrl || catalog.defaults.baseUrl,
    model:   userCfg.sonnetModel || catalog.defaults.sonnetModel,
  };
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

function pushToRenderer(channel, payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// ─── Core streaming request ───────────────────────────────────────────────────

/**
 * Make a single streaming Anthropic-format API request.
 * Returns a Promise that resolves with { stopReason, toolCalls }.
 * Pushes text chunks to renderer via IPC as they arrive.
 *
 * Calling this while a previous request is in flight automatically aborts the
 * previous one (via the requestId monotone counter + currentReq.destroy()).
 */
async function startChatStream({ providerId, providerConfigs, messages, todos, projectContext }) {
  const myId    = ++_currentRequestId;
  const isStale = () => myId !== _currentRequestId;

  // Abort any existing in-flight request
  if (_currentReq) {
    try { _currentReq.destroy(); } catch (_) {}
    _currentReq = null;
  }

  // Resolve provider config
  const cfg = resolveProviderConfig(providerId, providerConfigs);
  if (!cfg) {
    throw new Error(`未知 provider: ${providerId}`);
  }

  // Get API key from macOS Keychain (async — must await!)
  const apiKey = await getKey(providerId);
  if (!apiKey) {
    throw new Error(`Provider ${providerId} 未配置 API Key，请在设置中配置`);
  }

  return new Promise((resolve, reject) => {

    const systemPrompt = buildSystemPrompt(todos || [], projectContext || null);
    const reqBody = JSON.stringify({
      model:      cfg.model,
      max_tokens: 4096,
      system:     systemPrompt,
      messages,
      tools:      TODO_TOOLS,
      stream:     true,
    });

    // Parse URL
    let parsedUrl;
    try {
      parsedUrl = new URL(`${cfg.baseUrl}/v1/messages`);
    } catch (e) {
      return reject(new Error(`无效的 baseUrl: ${cfg.baseUrl}`));
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const defaultPort = parsedUrl.protocol === 'https:' ? 443 : 80;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port ? parseInt(parsedUrl.port, 10) : defaultPort,
      path:     parsedUrl.pathname + (parsedUrl.search || ''),
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        // Send both header forms for maximum provider compatibility:
        //   x-api-key       — Anthropic native
        //   Authorization   — most third-party providers (GLM / Kimi / MiniMax / Qwen)
        'x-api-key':         apiKey,
        'Authorization':     `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(reqBody),
      },
    };

    // ─── Timeout guards ───────────────────────────────────────────────
    // connectTimeout: 30s — destroy request if no response headers arrive
    // idleTimeout: 60s — destroy if >60s passes between consecutive data chunks
    const CONNECT_TIMEOUT_MS = 30_000;
    const IDLE_TIMEOUT_MS    = 60_000;

    let connectTimer = null;
    let idleTimer    = null;

    function clearTimeouts() {
      if (connectTimer !== null) { clearTimeout(connectTimer); connectTimer = null; }
      if (idleTimer !== null)    { clearTimeout(idleTimer);    idleTimer = null; }
    }

    function onTimeout(label) {
      return () => {
        clearTimeouts();
        if (!isStale()) {
          req.destroy(new Error(`请求超时 (${label})`));
        }
      };
    }

    // Start connect timer — fires if no response within CONNECT_TIMEOUT_MS
    connectTimer = setTimeout(onTimeout(`连接 ${CONNECT_TIMEOUT_MS / 1000}s`), CONNECT_TIMEOUT_MS);

    const req = transport.request(reqOptions, (res) => {
      if (isStale()) { clearTimeouts(); return; }

      // Response headers received — clear connect timer, start idle timer
      clearTimeout(connectTimer); connectTimer = null;
      idleTimer = setTimeout(onTimeout(`数据空闲 ${IDLE_TIMEOUT_MS / 1000}s`), IDLE_TIMEOUT_MS);

      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (c) => { errBody += c.toString(); });
        res.on('end', () => {
          clearTimeouts();
          if (!isStale()) reject(new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 300)}`));
        });
        return;
      }

      let lineBuffer  = '';        // SSE line accumulation buffer
      let toolCalls   = [];        // Completed tool calls: [{ id, name, inputRaw }]
      let currentTool = null;      // In-progress tool call being assembled
      let stopReason  = 'end_turn';

      res.on('data', (chunk) => {
        if (isStale()) return;
        // Reset idle timer on each data chunk
        if (idleTimer !== null) { clearTimeout(idleTimer); }
        idleTimer = setTimeout(onTimeout(`数据空闲 ${IDLE_TIMEOUT_MS / 1000}s`), IDLE_TIMEOUT_MS);

        lineBuffer += chunk.toString();

        const lines     = lineBuffer.split('\n');
        lineBuffer      = lines.pop() || ''; // Keep potentially incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;

          let evt;
          try { evt = JSON.parse(raw); } catch (_) { continue; }

          switch (evt.type) {
            case 'content_block_start': {
              const block = evt.content_block;
              if (block && block.type === 'tool_use') {
                currentTool = { id: block.id, name: block.name, inputRaw: '' };
              }
              break;
            }
            case 'content_block_delta': {
              const delta = evt.delta;
              if (!delta) break;
              if (delta.type === 'text_delta') {
                pushToRenderer('todo:stream:chunk', { text: delta.text });
              } else if (delta.type === 'input_json_delta' && currentTool) {
                currentTool.inputRaw += (delta.partial_json || '');
              }
              break;
            }
            case 'content_block_stop': {
              if (currentTool) {
                toolCalls.push({ ...currentTool });
                currentTool = null;
              }
              break;
            }
            case 'message_delta': {
              if (evt.delta && evt.delta.stop_reason) {
                stopReason = evt.delta.stop_reason;
              }
              break;
            }
            default:
              break;
          }
        }
      });

      res.on('end', () => {
        clearTimeouts();
        if (isStale()) return;
        _currentReq = null;

        // Parse accumulated JSON for each tool call
        const parsedCalls = toolCalls.map((tc) => {
          let input = {};
          try {
            if (tc.inputRaw) input = JSON.parse(tc.inputRaw);
          } catch (_) {
            // Partial JSON on abort — treat as empty input
          }
          return { id: tc.id, name: tc.name, input };
        });

        resolve({ stopReason, toolCalls: parsedCalls });
      });

      res.on('error', (err) => {
        clearTimeouts();
        if (!isStale()) reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeouts();
      if (!isStale()) reject(err);
    });

    req.write(reqBody);
    req.end();
    _currentReq = req;
  });
}

// ─── IPC registration ─────────────────────────────────────────────────────────

function initTodoAIIPC() {
  /**
   * Return list of provider IDs that have API keys stored in Keychain.
   * Renderer passes its current providerConfigs (for baseUrl/model lookup only;
   * API keys are never transmitted from renderer).
   */
  ipcMain.handle('todo:providers:available', async (_event, _providerConfigs) => {
    const available = [];
    const PROVIDER_IDS = ['glm', 'minimax', 'kimi', 'qwencp'];
    for (const id of PROVIDER_IDS) {
      try {
        const key = await getKey(id);
        if (key) available.push(id);
      } catch (_) {
        // No key or keychain error — skip
      }
    }
    return available;
  });

  /**
   * Start a streaming chat request.
   * Pushes todo:stream:chunk events during generation.
   * Sends todo:stream:done when complete, or todo:stream:error on failure.
   */
  ipcMain.on('todo:chat:start', async (_event, opts) => {
    try {
      const result = await startChatStream(opts);
      pushToRenderer('todo:stream:done', result);
    } catch (err) {
      // Swallow "socket hang up" from intentional abort
      if (!err.message.includes('socket hang up') && !err.message.includes('aborted')) {
        pushToRenderer('todo:stream:error', { message: err.message });
      }
    }
  });

  /**
   * Abort current in-flight request immediately.
   */
  ipcMain.on('todo:chat:abort', () => {
    ++_currentRequestId;           // Mark all pending callbacks stale
    if (_currentReq) {
      try { _currentReq.destroy(); } catch (_) {}
      _currentReq = null;
    }
  });
}

module.exports = { initTodoAIIPC };
