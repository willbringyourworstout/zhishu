/**
 * TodoAIChat.jsx — AI-powered TODO assistant chat panel.
 *
 * Architecture: renderer manages the multi-turn conversation loop.
 *   1. User sends message → startTodoChat(opts)
 *   2. Main process streams text via todo:stream:chunk
 *   3. On todo:stream:done with stopReason='tool_use':
 *      a. Execute each tool call via Zustand store
 *      b. Append tool_result block to messages
 *      c. startTodoChat again (continue loop)
 *   4. On stopReason='end_turn': conversation complete
 *
 * This component is self-contained and mounted inside TodoPanel.
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { useSessionStore } from '../store/sessions';
import { TOOL_COLORS, TOOL_LABELS } from '../constants/toolVisuals';

// ─── Aliases for local readability ────────────────────────────────────────────

const PROVIDER_LABELS = TOOL_LABELS;
const PROVIDER_COLORS = TOOL_COLORS;

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system'; // internal status messages

  if (isSystem) {
    return (
      <div style={bubbleStyles.systemMsg}>
        {msg.content}
      </div>
    );
  }

  return (
    <div style={{ ...bubbleStyles.bubble, alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && (
        <div style={bubbleStyles.assistantLabel}>AI</div>
      )}
      <div
        style={{
          ...bubbleStyles.text,
          background:  isUser ? '#1a2840' : '#141414',
          border:      `1px solid ${isUser ? '#2a4a70' : '#222'}`,
          borderRadius: isUser ? '10px 10px 2px 10px' : '2px 10px 10px 10px',
          color:       isUser ? '#b0c4de' : '#d4d4d4',
        }}
      >
        {msg.content}
        {msg.streaming && (
          <span style={bubbleStyles.cursor} />
        )}
      </div>
    </div>
  );
}

const bubbleStyles = {
  bubble: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    maxWidth: '88%',
  },
  assistantLabel: {
    fontSize: 9,
    color: '#444',
    paddingLeft: 6,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  text: {
    fontSize: 12,
    lineHeight: 1.55,
    padding: '6px 10px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'system-ui, -apple-system',
  },
  systemMsg: {
    fontSize: 10.5,
    color: '#444',
    textAlign: 'center',
    padding: '3px 0',
    fontFamily: 'system-ui, -apple-system',
    fontStyle: 'italic',
  },
  cursor: {
    display: 'inline-block',
    width: 6,
    height: 12,
    background: '#60a5fa',
    marginLeft: 2,
    verticalAlign: 'text-bottom',
    borderRadius: 1,
    animation: 'blink 0.8s step-end infinite',
  },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function TodoAIChat() {
  const todos           = useSessionStore((s) => s.todos);
  const providerConfigs = useSessionStore((s) => s.providerConfigs);
  const todoChatProvider  = useSessionStore((s) => s.todoChatProvider);
  const setTodoChatProvider = useSessionStore((s) => s.setTodoChatProvider);

  // TODO store actions (tool execution)
  const addTodo       = useSessionStore((s) => s.addTodo);
  const updateTodo    = useSessionStore((s) => s.updateTodo);
  const deleteTodo    = useSessionStore((s) => s.deleteTodo);
  const toggleTodoDone = useSessionStore((s) => s.toggleTodoDone);
  const clearDoneTodos = useSessionStore((s) => s.clearDoneTodos);

  const [availableProviders, setAvailableProviders] = useState([]);
  const [messages, setMessages]   = useState([]); // display messages
  const [apiMessages, setApiMessages] = useState([]); // actual API message history
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');

  const inputRef   = useRef(null);
  const listRef    = useRef(null);
  const streamRef  = useRef(''); // live buffer during streaming
  const isMountedRef = useRef(true);
  const runChatRef = useRef(null); // always-latest runChat reference for setTimeout safety

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Stable key derived from provider config identities (sorted so order-insensitive).
  const providerConfigKeys = useMemo(
    () => Object.keys(providerConfigs).sort().join(','),
    [providerConfigs],
  );

  // Probe available providers on mount and whenever providerConfigs change.
  // Auto-select the first available provider if none is selected or selection is no longer valid.
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getAvailableAIProviders(providerConfigs).then((ids) => {
      if (cancelled || !isMountedRef.current) return;
      const list = ids || [];
      setAvailableProviders(list);
      if (!todoChatProvider || !list.includes(todoChatProvider)) {
        if (list.length > 0) setTodoChatProvider(list[0]);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [providerConfigKeys, providerConfigs, todoChatProvider, setTodoChatProvider]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  // ── Tool execution ──────────────────────────────────────────────────────────

  const executeTool = useCallback((toolName, input) => {
    switch (toolName) {
      case 'add_todo':
        addTodo(input.text, input.priority || 'none', input.dueDate || null);
        return `已添加待办: "${input.text}"`;

      case 'update_todo':
        updateTodo(input.id, {
          ...(input.text     !== undefined ? { text: input.text }         : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueDate  !== undefined ? { dueDate: input.dueDate || null } : {}),
        });
        return `已更新待办 ${input.id}`;

      case 'delete_todo':
        deleteTodo(input.id);
        return `已删除待办 ${input.id}`;

      case 'toggle_todo_done':
        toggleTodoDone(input.id);
        return `已切换待办 ${input.id} 的完成状态`;

      case 'bulk_create_todos': {
        const items = input.todos || [];
        items.forEach((item) => addTodo(item.text, item.priority || 'none', item.dueDate || null));
        return `已批量添加 ${items.length} 条待办`;
      }

      case 'clear_done_todos':
        clearDoneTodos();
        return '已清除所有已完成的待办';

      default:
        return `未知工具: ${toolName}`;
    }
  }, [addTodo, updateTodo, deleteTodo, toggleTodoDone, clearDoneTodos]);

  // ── Start / continue a chat turn ────────────────────────────────────────────

  const runChat = useCallback((msgs) => {
    if (!todoChatProvider) return;

    setIsStreaming(true);
    streamRef.current = '';
    setStreamingText('');

    // Add a placeholder streaming bubble
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', streaming: true, id: `stream-${Date.now()}` },
    ]);

    window.electronAPI.startTodoChat({
      providerId:     todoChatProvider,
      providerConfigs,
      messages:       msgs,
      todos,
    });
  }, [todoChatProvider, providerConfigs, todos]);

  // Keep ref in sync so setTimeout inside setState always calls the latest version
  runChatRef.current = runChat;

  // ── IPC subscriptions ───────────────────────────────────────────────────────

  useEffect(() => {
    const unsubChunk = window.electronAPI.onTodoStreamChunk(({ text }) => {
      if (!isMountedRef.current) return;
      streamRef.current += text;
      setStreamingText(streamRef.current);
      // Update the last (streaming) bubble in place
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || !last.streaming) return prev;
        return [
          ...prev.slice(0, -1),
          { ...last, content: streamRef.current },
        ];
      });
    });

    const unsubDone = window.electronAPI.onTodoStreamDone(async ({ stopReason, toolCalls }) => {
      if (!isMountedRef.current) return;

      // Finalize the streaming bubble
      const finalText = streamRef.current;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last?.streaming) return prev;
        return [
          ...prev.slice(0, -1),
          { ...last, content: finalText, streaming: false },
        ];
      });
      streamRef.current = '';
      setStreamingText('');

      if (stopReason === 'tool_use' && toolCalls && toolCalls.length > 0) {
        // Execute all tool calls and build the tool_result messages for the next turn
        const assistantContent = [];
        if (finalText) assistantContent.push({ type: 'text', text: finalText });
        toolCalls.forEach((tc) => {
          assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        });

        const toolResults = toolCalls.map((tc) => {
          let resultText;
          try {
            resultText = executeTool(tc.name, tc.input);
          } catch (err) {
            resultText = `工具执行出错: ${err.message}`;
          }
          return {
            type: 'tool_result',
            tool_use_id: tc.id,
            content: resultText,
          };
        });

        // Show a brief system status (no need to show raw tool results to user)
        const toolSummary = toolCalls.map((tc) => TOOL_ACTION_LABELS[tc.name] || tc.name).join(', ');
        setMessages((prev) => [...prev, { role: 'system', content: `执行: ${toolSummary}` }]);

        // Continue conversation with tool results (functional update avoids stale closure)
        setApiMessages((prev) => {
          const updated = [
            ...prev,
            { role: 'assistant', content: assistantContent },
            { role: 'user',      content: toolResults },
          ];
          // Schedule next turn using ref to avoid stale closure in setTimeout
          setTimeout(() => runChatRef.current?.(updated), 0);
          return updated;
        });
      } else {
        // Conversation complete
        setIsStreaming(false);
        setApiMessages((prev) => [
          ...prev,
          { role: 'assistant', content: finalText },
        ]);
      }
    });

    const unsubError = window.electronAPI.onTodoStreamError(({ message }) => {
      if (!isMountedRef.current) return;
      setIsStreaming(false);
      streamRef.current = '';
      setStreamingText('');
      // Replace streaming bubble with error message
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.streaming);
        return [...filtered, { role: 'system', content: `❌ ${message}` }];
      });
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, [executeTool, runChat]);

  // ── Send user message ────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isStreaming || !todoChatProvider) return;

    setInputText('');

    const userMsg = { role: 'user', content: text };
    const nextApiMsgs = [...apiMessages, userMsg];

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, id: `user-${Date.now()}` },
    ]);
    setApiMessages(nextApiMsgs);
    runChat(nextApiMsgs);
  }, [inputText, isStreaming, todoChatProvider, apiMessages, runChat]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleAbort = useCallback(() => {
    window.electronAPI.abortTodoChat();
    setIsStreaming(false);
    setMessages((prev) => prev.filter((m) => !m.streaming));
    streamRef.current = '';
  }, []);

  const handleClearHistory = useCallback(() => {
    setMessages([]);
    setApiMessages([]);
    streamRef.current = '';
  }, []);

  // ─ No providers configured ─────────────────────────────────────────────────
  if (availableProviders.length === 0) {
    return (
      <div style={chatStyles.emptyState}>
        <div style={chatStyles.emptyIcon}>🤖</div>
        <div style={chatStyles.emptyText}>
          在设置中配置 GLM / MiniMax / Kimi / Qwen 等 Provider 后，即可用 AI 管理待办
        </div>
      </div>
    );
  }

  return (
    <div style={chatStyles.root}>
      {/* ── Header bar ── */}
      <div style={chatStyles.header}>
        <span style={chatStyles.headerLabel}>AI 助手</span>
        <div style={chatStyles.headerRight}>
          {/* Provider selector */}
          <select
            value={todoChatProvider || ''}
            onChange={(e) => setTodoChatProvider(e.target.value)}
            style={chatStyles.providerSelect}
            title="选择 AI Provider"
          >
            {availableProviders.map((id) => (
              <option key={id} value={id}>{PROVIDER_LABELS[id] || id}</option>
            ))}
          </select>
          {messages.length > 0 && (
            <button
              onClick={handleClearHistory}
              style={chatStyles.clearBtn}
              title="清空对话历史"
              disabled={isStreaming}
            >
              清空
            </button>
          )}
        </div>
      </div>

      {/* ── Message list ── */}
      <div ref={listRef} style={chatStyles.messageList}>
        {messages.length === 0 ? (
          <div style={chatStyles.placeholder}>
            <span style={{ color: PROVIDER_COLORS[todoChatProvider] || '#666' }}>
              {PROVIDER_LABELS[todoChatProvider] || 'AI'}
            </span>
            {' '}在线 · 告诉我你想怎么整理待办吧
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={msg.id || i} msg={msg} />
          ))
        )}
      </div>

      {/* ── Input area ── */}
      <div style={chatStyles.inputArea}>
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? '等待响应...' : '描述你想做什么... (Enter 发送)'}
          disabled={isStreaming || !todoChatProvider}
          rows={2}
          style={{
            ...chatStyles.textarea,
            opacity: isStreaming ? 0.5 : 1,
          }}
        />
        <div style={chatStyles.inputActions}>
          {isStreaming ? (
            <button onClick={handleAbort} style={chatStyles.abortBtn}>
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || !todoChatProvider}
              style={{
                ...chatStyles.sendBtn,
                opacity: (inputText.trim() && todoChatProvider) ? 1 : 0.35,
                cursor:  (inputText.trim() && todoChatProvider) ? 'pointer' : 'not-allowed',
              }}
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tool action labels for status display ────────────────────────────────────

const TOOL_ACTION_LABELS = {
  add_todo:         '添加待办',
  update_todo:      '更新待办',
  delete_todo:      '删除待办',
  toggle_todo_done: '切换完成',
  bulk_create_todos:'批量添加',
  clear_done_todos: '清除已完成',
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const chatStyles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    borderTop: '1px solid #1e1e1e',
    height: 280,
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px',
    height: 32,
    borderBottom: '1px solid #1a1a1a',
    flexShrink: 0,
  },
  headerLabel: {
    fontSize: 10.5,
    color: '#555',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontFamily: 'system-ui, -apple-system',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  providerSelect: {
    background: '#141414',
    border: '1px solid #252525',
    borderRadius: 4,
    color: '#888',
    fontSize: 10.5,
    padding: '2px 4px',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system',
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: '#444',
    fontSize: 10.5,
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 3,
    fontFamily: 'system-ui, -apple-system',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  placeholder: {
    color: '#333',
    fontSize: 11.5,
    textAlign: 'center',
    padding: '20px 0 10px',
    fontFamily: 'system-ui, -apple-system',
  },
  inputArea: {
    borderTop: '1px solid #1a1a1a',
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flexShrink: 0,
  },
  textarea: {
    width: '100%',
    background: '#111',
    border: '1px solid #242424',
    borderRadius: 5,
    color: '#d4d4d4',
    fontSize: 12,
    padding: '5px 8px',
    resize: 'none',
    outline: 'none',
    fontFamily: 'system-ui, -apple-system',
    lineHeight: 1.4,
    boxSizing: 'border-box',
    transition: 'opacity 0.15s',
  },
  inputActions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  sendBtn: {
    background: '#1d3050',
    border: '1px solid #2a4a80',
    borderRadius: 4,
    color: '#60a5fa',
    fontSize: 11.5,
    padding: '4px 14px',
    fontFamily: 'system-ui, -apple-system',
    fontWeight: 500,
    transition: 'opacity 0.15s',
  },
  abortBtn: {
    background: '#3a1414',
    border: '1px solid #6b2828',
    borderRadius: 4,
    color: '#f87171',
    fontSize: 11.5,
    padding: '4px 14px',
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system',
    fontWeight: 500,
  },
  emptyState: {
    borderTop: '1px solid #1e1e1e',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '18px 14px',
    background: '#0a0a0a',
    flexShrink: 0,
  },
  emptyIcon: {
    fontSize: 20,
  },
  emptyText: {
    fontSize: 11,
    color: '#444',
    textAlign: 'center',
    lineHeight: 1.6,
    fontFamily: 'system-ui, -apple-system',
  },
};
