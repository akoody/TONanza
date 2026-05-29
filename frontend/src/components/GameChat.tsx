import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MessageCircle, Send } from "lucide-react";
import type { ChatMessage } from "../types";

interface GameChatProps {
  messages: ChatMessage[];
  currentUserId?: string | null;
  isConnected: boolean;
  isSending: boolean;
  isSendingEnabled: boolean;
  isAdmin?: boolean;
  isTogglingChat?: boolean;
  cooldownMsLeft: number;
  mutedMsLeft: number;
  maxMessageLength?: number;
  onSend: (text: string) => Promise<void> | void;
  onDeleteMessage?: (messageId: string) => Promise<void> | void;
  onToggleChat?: () => Promise<void> | void;
  onViewportRestore?: () => void;
}

const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  });
};

const formatMs = (ms: number): string => {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) {
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }
  return `${sec}с`;
};

const initialsFromName = (name: string): string => {
  const cleaned = name.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  return cleaned.slice(0, 2) || "U";
};

const findScrollableParent = (element: HTMLElement | null): HTMLElement | null => {
  let current = element?.parentElement ?? null;

  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const isScrollable = /(auto|scroll|overlay)/.test(overflowY);
    if (isScrollable && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
};

const isIosWebView = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|od|ad)/i.test(navigator.userAgent);
};

export function GameChat({
  messages,
  currentUserId,
  isConnected,
  isSending,
  isSendingEnabled,
  isAdmin = false,
  isTogglingChat = false,
  cooldownMsLeft,
  mutedMsLeft,
  maxMessageLength = 160,
  onSend,
  onDeleteMessage,
  onToggleChat,
  onViewportRestore
}: GameChatProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusRafRef = useRef<number | null>(null);
  const focusTimeoutsRef = useRef<number[]>([]);
  const viewportCleanupRef = useRef<(() => void) | null>(null);

  const scrollToLatestMessage = useCallback(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (isCollapsed) return;
    const rafId = window.requestAnimationFrame(scrollToLatestMessage);
    return () => window.cancelAnimationFrame(rafId);
  }, [isCollapsed, messages, scrollToLatestMessage]);

  useEffect(() => {
    if (isCollapsed) return;

    const restoreChatScroll = () => {
      window.requestAnimationFrame(scrollToLatestMessage);
    };

    const onVisibilityChange = () => {
      if (document.hidden) return;
      restoreChatScroll();
    };

    window.addEventListener("focus", restoreChatScroll);
    window.addEventListener("pageshow", restoreChatScroll);
    window.addEventListener("resize", restoreChatScroll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.visualViewport?.addEventListener("resize", restoreChatScroll);

    return () => {
      window.removeEventListener("focus", restoreChatScroll);
      window.removeEventListener("pageshow", restoreChatScroll);
      window.removeEventListener("resize", restoreChatScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.visualViewport?.removeEventListener("resize", restoreChatScroll);
    };
  }, [isCollapsed, scrollToLatestMessage]);

  const isMuted = mutedMsLeft > 0;
  const isCooldown = !isMuted && cooldownMsLeft > 0;
  const isStopped = !isSendingEnabled;
  const isBlocked = isMuted || isCooldown || isStopped || !isConnected || isSending;

  const statusLabel = useMemo(() => {
    if (!isConnected) return "Чат недоступен";
    if (isStopped) return "Чат остановлен";
    if (isMuted) return `Мут: ${formatMs(mutedMsLeft)}`;
    if (isCooldown) return `Кулдаун: ${formatMs(cooldownMsLeft)}`;
    return "Онлайн";
  }, [cooldownMsLeft, isConnected, isCooldown, isMuted, isStopped, mutedMsLeft]);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || isBlocked) return;
    await onSend(text);
    setDraft("");
    inputRef.current?.blur();
  };

  const clearFocusAdjustments = useCallback(() => {
    if (focusRafRef.current !== null) {
      window.cancelAnimationFrame(focusRafRef.current);
      focusRafRef.current = null;
    }

    if (focusTimeoutsRef.current.length > 0) {
      for (const timeoutId of focusTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      focusTimeoutsRef.current = [];
    }

    if (viewportCleanupRef.current) {
      viewportCleanupRef.current();
      viewportCleanupRef.current = null;
    }
  }, []);

  const focusChatInput = useCallback((behavior: ScrollBehavior = "smooth") => {
    const input = inputRef.current;
    if (!input) return;

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const targetTop = viewportHeight * 0.42;
    const rect = input.getBoundingClientRect();
    const delta = rect.top - targetTop;

    if (Math.abs(delta) < 6) return;

    const scrollParent = findScrollableParent(input);
    if (scrollParent) {
      scrollParent.scrollBy({ top: delta, behavior });
      return;
    }

    window.scrollBy({ top: delta, behavior });
  }, []);

  useEffect(() => {
    return () => {
      clearFocusAdjustments();
    };
  }, [clearFocusAdjustments]);

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-slate-950/60 backdrop-blur-md overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <MessageCircle size={15} className="text-cyan-300" />
          <span className="text-xs font-bold uppercase tracking-widest text-white">Чат</span>
        </div>
        <div className="inline-flex items-center gap-2">
          {isAdmin && onToggleChat && (
            <button
              type="button"
              onClick={() => {
                void onToggleChat();
              }}
              disabled={isTogglingChat}
              className={`h-6 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wide transition-colors ${
                isStopped
                  ? "border-emerald-400/45 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                  : "border-rose-400/45 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
              } disabled:opacity-50`}
              aria-label={isStopped ? "Включить чат" : "Остановить чат"}
              title={isStopped ? "Включить чат" : "Остановить чат"}
            >
              {isStopped ? "Start" : "Stop"}
            </button>
          )}
          <span className={`text-[11px] font-semibold ${isConnected ? "text-cyan-200/75" : "text-rose-300/90"}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!isCollapsed) {
                inputRef.current?.blur();
                onViewportRestore?.();
              }
              setIsCollapsed((prev) => !prev);
            }}
            className="h-6 w-6 rounded-md border border-white/15 bg-white/5 text-white/80 hover:text-white hover:bg-white/10 transition-colors inline-flex items-center justify-center"
            aria-label={isCollapsed ? "Развернуть чат" : "Свернуть чат"}
            aria-expanded={!isCollapsed}
          >
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${isCollapsed ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div ref={listRef} className="max-h-[220px] overflow-y-auto px-3 py-2 space-y-2 no-scrollbar">
            {messages.length === 0 ? (
              <div className="py-8 text-center text-xs uppercase tracking-widest text-white/35">
                Сообщений пока нет
              </div>
            ) : (
              messages.map((message) => {
                const isMine = currentUserId && message.userId === currentUserId;
                return (
                  <div
                    key={message.id}
                    className={`rounded-xl border px-2.5 py-2 ${isMine
                      ? "bg-cyan-500/10 border-cyan-400/25"
                      : "bg-white/5 border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="inline-flex items-center gap-2 min-w-0">
                        {message.avatarUrl ? (
                          <img
                            src={message.avatarUrl}
                            alt={message.username}
                            className="h-5 w-5 rounded-full border border-white/20 object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onLoad={scrollToLatestMessage}
                          />
                        ) : (
                          <span className="h-5 w-5 rounded-full bg-white/10 border border-white/15 text-[10px] font-bold text-white/80 inline-flex items-center justify-center">
                            {initialsFromName(message.username)}
                          </span>
                        )}
                        <span className={`text-xs font-semibold truncate ${isMine ? "text-cyan-200" : "text-white/85"}`}>
                          {message.username}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/40 shrink-0">
                        {formatMessageTime(message.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-white/85 break-words whitespace-pre-wrap leading-snug">
                      {message.text}
                    </p>
                    {isAdmin && onDeleteMessage && (
                      <div className="mt-1.5 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            void onDeleteMessage(message.id);
                          }}
                          className="h-5 w-5 rounded-md border border-rose-400/35 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 transition-colors inline-flex items-center justify-center"
                          aria-label="Удалить сообщение"
                          title="Удалить сообщение"
                        >
                          <span className="text-[11px] leading-none font-black">×</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-white/10 p-2.5">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={draft}
                maxLength={maxMessageLength}
                onChange={(event) => setDraft(event.target.value)}
                onFocus={() => {
                  clearFocusAdjustments();
                  if (isIosWebView()) {
                    // iOS Telegram WebView can render a black frame when aggressive scroll/focus adjustments run.
                    focusChatInput("auto");
                    return;
                  }

                  focusChatInput("auto");

                  focusRafRef.current = window.requestAnimationFrame(() => {
                    focusChatInput("smooth");
                    focusRafRef.current = null;
                  });

                  const firstTimeout = window.setTimeout(() => focusChatInput("auto"), 120);
                  const secondTimeout = window.setTimeout(() => focusChatInput("auto"), 260);
                  focusTimeoutsRef.current.push(firstTimeout, secondTimeout);

                  if (window.visualViewport) {
                    const onViewportChange = () => focusChatInput("auto");
                    window.visualViewport.addEventListener("resize", onViewportChange);
                    window.visualViewport.addEventListener("scroll", onViewportChange);
                    viewportCleanupRef.current = () => {
                      window.visualViewport?.removeEventListener("resize", onViewportChange);
                      window.visualViewport?.removeEventListener("scroll", onViewportChange);
                    };
                  }
                }}
                onBlur={() => {
                  clearFocusAdjustments();
                  onViewportRestore?.();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={isStopped ? "Чат остановлен админом" : isBlocked ? "Подождите перед отправкой..." : "Введите сообщение..."}
                disabled={isBlocked}
                className="flex-1 h-10 rounded-xl border border-white/15 bg-black/25 px-3 text-base text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:opacity-60"
                style={{ fontSize: 16 }}
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={isBlocked || draft.trim().length === 0}
                className="h-10 w-10 rounded-xl border border-cyan-400/35 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-45 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center"
                aria-label="Отправить сообщение"
              >
                <Send size={15} />
              </button>
            </div>
            <div className="mt-1.5 px-1 text-[10px] text-white/35">
              Лимит: 1 сообщение / 10 секунд
            </div>
          </div>
        </>
      )}
    </section>
  );
}
