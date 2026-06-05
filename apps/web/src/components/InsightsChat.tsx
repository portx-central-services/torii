import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { streamInsightsChat, type ChatMessage, type InsightsChatEvent } from '../api/endpoints.js';

interface ToolEvent {
  name: string;
  status: 'started' | 'completed';
  summary?: string;
}

interface UiMessage {
  role: 'user' | 'assistant';
  /** Streamed text content (may be empty mid-flight). */
  text: string;
  /** Tool calls emitted alongside this assistant turn. */
  toolEvents: ToolEvent[];
  /** When set, the assistant message ended in a transient error. */
  error?: string;
}

const SUGGESTED_PROMPTS = [
  'Which projects are red?',
  "Who's available for new work?",
  'Show me hours billed by customer last 30 days.',
];

export function InsightsChat({ disabled }: { disabled?: boolean }) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Cancel in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Keep the message list scrolled to the bottom as new content arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || inFlight || disabled) return;

      // Cancel any prior in-flight stream — newest prompt wins.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: UiMessage = { role: 'user', text: trimmed, toolEvents: [] };
      const assistantMsg: UiMessage = { role: 'assistant', text: '', toolEvents: [] };
      // Snapshot prior history for the API call; the new pair gets appended.
      const apiHistory: ChatMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: trimmed },
      ];
      setMessages((m) => [...m, userMsg, assistantMsg]);
      setInput('');
      setInFlight(true);

      const updateLastAssistant = (mut: (msg: UiMessage) => UiMessage) => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = prev.slice();
          for (let i = next.length - 1; i >= 0; i--) {
            const msg = next[i];
            if (msg && msg.role === 'assistant') {
              next[i] = mut(msg);
              break;
            }
          }
          return next;
        });
      };

      const handleEvent = (event: InsightsChatEvent) => {
        switch (event.type) {
          case 'text_delta':
            updateLastAssistant((msg) => ({ ...msg, text: msg.text + event.text }));
            break;
          case 'tool_call':
            updateLastAssistant((msg) => {
              if (event.status === 'started') {
                return {
                  ...msg,
                  toolEvents: [...msg.toolEvents, { name: event.name, status: 'started' }],
                };
              }
              // completed → update the matching started entry in place.
              const idx = (() => {
                for (let i = msg.toolEvents.length - 1; i >= 0; i--) {
                  if (msg.toolEvents[i]?.name === event.name && msg.toolEvents[i]?.status === 'started') {
                    return i;
                  }
                }
                return -1;
              })();
              if (idx === -1) {
                return {
                  ...msg,
                  toolEvents: [
                    ...msg.toolEvents,
                    { name: event.name, status: 'completed', summary: event.summary },
                  ],
                };
              }
              const nextEvents = msg.toolEvents.slice();
              nextEvents[idx] = { name: event.name, status: 'completed', summary: event.summary };
              return { ...msg, toolEvents: nextEvents };
            });
            break;
          case 'error':
            updateLastAssistant((msg) => ({ ...msg, error: event.message }));
            break;
          case 'done':
            break;
        }
      };

      try {
        await streamInsightsChat({
          messages: apiHistory,
          onEvent: handleEvent,
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        updateLastAssistant((msg) => ({ ...msg, error: message }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setInFlight(false);
      }
    },
    [disabled, inFlight, messages],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void submit(input);
    },
    [input, submit],
  );

  const onSuggested = useCallback(
    (prompt: string) => {
      setInput(prompt);
      void submit(prompt);
    },
    [submit],
  );

  const isEmpty = useMemo(() => messages.length === 0, [messages]);

  if (disabled) {
    return (
      <aside className="insights-chat-pane">
        <header className="insights-chat-header">Insights Chat</header>
        <div className="insights-chat-empty">
          Chat is not configured. Set <code>ANTHROPIC_API_KEY</code> on the API to enable.
        </div>
      </aside>
    );
  }

  return (
    <aside className="insights-chat-pane">
      <header className="insights-chat-header">Insights Chat</header>

      <div className="insights-chat-messages" ref={scrollRef}>
        {isEmpty ? (
          <div className="insights-chat-suggested">
            <p className="insights-chat-suggested-label">Ask anything about the portfolio.</p>
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                className="insights-chat-suggested-btn"
                onClick={() => onSuggested(p)}
              >
                {p}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'insights-chat-message-user'
                  : 'insights-chat-message-assistant'
              }
            >
              {m.toolEvents.map((evt, j) => (
                <div key={j} className="insights-chat-tool-line">
                  → {evt.status === 'completed' && evt.summary
                    ? evt.summary
                    : `${evt.status === 'started' ? 'Calling' : 'Called'} ${evt.name}…`}
                </div>
              ))}
              {m.text ? (
                <div className="insights-chat-text">{renderChatMarkdown(m.text)}</div>
              ) : (
                m.role === 'assistant' && !m.error && (
                  <div className="insights-chat-thinking">thinking…</div>
                )
              )}
              {m.error && (
                <div className="insights-chat-error">(connection error: {m.error})</div>
              )}
            </div>
          ))
        )}
      </div>

      <form className="insights-chat-input-row" onSubmit={handleSubmit}>
        <input
          type="text"
          className="insights-chat-input"
          placeholder="Ask about the portfolio…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={inFlight}
        />
        <button
          type="submit"
          className="btn-primary insights-chat-send"
          disabled={inFlight || input.trim().length === 0}
        >
          {inFlight ? '…' : 'Send'}
        </button>
      </form>
    </aside>
  );
}

/**
 * Tiny markdown renderer — `**bold**`, `` `code` ``, and `[label](path)`. Anything
 * starting with `http(s)://` becomes an external link; anything else routes
 * through react-router's `<Link>` so internal navigation stays SPA.
 */
function renderChatMarkdown(text: string): React.ReactNode[] {
  // Split on links first so the bold/code regexes don't accidentally eat them.
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = linkRe.exec(text)) !== null) {
    const [whole, label, href] = match;
    if (match.index > lastIndex) {
      nodes.push(...renderInline(text.slice(lastIndex, match.index), `t${key++}`));
    }
    if (label && href) {
      const isExternal = /^https?:\/\//.test(href);
      nodes.push(
        isExternal ? (
          <a key={`l${key++}`} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <Link key={`l${key++}`} to={href}>
            {label}
          </Link>
        ),
      );
    }
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < text.length) {
    nodes.push(...renderInline(text.slice(lastIndex), `t${key++}`));
  }
  return nodes;
}

function renderInline(chunk: string, keyPrefix: string): React.ReactNode[] {
  // Order matters: bold tokens may contain `code` but not vice versa.
  const segments: React.ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = chunk.split(tokenRe);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) {
      segments.push(<strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      segments.push(<code key={`${keyPrefix}-c${i}`}>{part.slice(1, -1)}</code>);
    } else {
      segments.push(part);
    }
  });
  return segments;
}
