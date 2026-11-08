import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import { useToast } from "../components/ui/Toast";
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_MESSAGE_LENGTH,
  normalizeChatDeleteAck,
  normalizeChatHistoryAck,
  normalizeChatMessage,
  normalizeChatRolePayload,
  normalizeChatSendAck,
  normalizeChatStatusPayload,
  normalizeChatToggleAck
} from "../lib/chat-protocol";
import { sanitizeChatText } from "../lib/security";
import type { ChatDeleteAck, ChatMessage, ChatSendAck, ChatToggleAck } from "../types";

const DEFAULT_CHAT_COOLDOWN_MS = 10_000;

const msToSeconds = (value: number) => Math.max(1, Math.ceil(value / 1000));

/** Состояние чата: сообщения, лимиты, команды админа и события сокета. */
export function useChat(socketRef: RefObject<Socket | null>) {
  const { toast } = useToast();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isTogglingChat, setIsTogglingChat] = useState(false);
  const [chatCooldownUntilMs, setChatCooldownUntilMs] = useState(0);
  const [chatMutedUntilMs, setChatMutedUntilMs] = useState(0);
  const [chatClockMs, setChatClockMs] = useState(Date.now());
  const [isChatAdmin, setIsChatAdmin] = useState(false);
  const [isChatSendingEnabled, setIsChatSendingEnabled] = useState(true);

  const applyChatPenalty = useCallback((retryAfterMs?: number, mutedUntilMs?: number) => {
    const now = Date.now();
    setChatClockMs(now);

    if (typeof mutedUntilMs === "number" && mutedUntilMs > now) {
      setChatMutedUntilMs((prev) => Math.max(prev, mutedUntilMs));
    }

    if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
      const target = now + retryAfterMs;
      setChatCooldownUntilMs((prev) => Math.max(prev, target));
    }
  }, []);

  const handleChatErrorAck = useCallback((errorAck: Exclude<ChatSendAck, { ok: true }>) => {
    if (errorAck.code === "COOLDOWN" || errorAck.code === "RATE_LIMIT" || errorAck.code === "MUTED") {
      applyChatPenalty(errorAck.retryAfterMs, errorAck.mutedUntilMs);
    }

    const retrySec = errorAck.retryAfterMs ? msToSeconds(errorAck.retryAfterMs) : 0;
    if (errorAck.code === "STOPPED") {
      setIsChatSendingEnabled(false);
      toast("Чат остановлен админом", "warning", 2400);
      return;
    }

    if (errorAck.code === "COOLDOWN") {
      toast(`Подождите ${retrySec}с перед следующим сообщением`, "warning", 2200);
      return;
    }

    if (errorAck.code === "MUTED") {
      toast(
        retrySec > 0 ? `Чат временно заблокирован на ${retrySec}с` : "Чат временно заблокирован",
        "error",
        2600
      );
      return;
    }

    if (errorAck.code === "RATE_LIMIT") {
      toast(`Слишком часто. Повторите через ${retrySec}с`, "warning", 2400);
      return;
    }

    if (errorAck.code === "UNAUTHORIZED") {
      toast("Чат недоступен: авторизация не подтверждена", "error");
      return;
    }

    if (errorAck.code === "EMPTY_MESSAGE") {
      toast("Введите сообщение", "warning", 1800);
      return;
    }

    toast("Не удалось отправить сообщение", "error");
  }, [applyChatPenalty, toast]);

  const sendChatMessage = useCallback(async (rawText: string) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      toast("Чат временно недоступен", "error");
      return;
    }

    if (!isChatSendingEnabled) {
      toast("Чат остановлен админом", "warning", 2400);
      return;
    }

    const text = sanitizeChatText(rawText, CHAT_MAX_MESSAGE_LENGTH);
    if (!text) {
      toast("Введите сообщение", "warning", 1800);
      return;
    }

    const now = Date.now();
    if (chatMutedUntilMs > now) {
      const retrySec = msToSeconds(chatMutedUntilMs - now);
      toast(`Чат временно заблокирован на ${retrySec}с`, "error", 2600);
      return;
    }

    if (chatCooldownUntilMs > now) {
      const retrySec = msToSeconds(chatCooldownUntilMs - now);
      toast(`Подождите ${retrySec}с перед следующим сообщением`, "warning", 2200);
      return;
    }

    setIsSendingChat(true);
    try {
      const ack = await new Promise<ChatSendAck | null>((resolve) => {
        let resolved = false;
        const timeoutId = window.setTimeout(() => {
          if (resolved) return;
          resolved = true;
          resolve(null);
        }, 5000);

        socket.emit("chat:send", { text }, (response: unknown) => {
          if (resolved) return;
          resolved = true;
          window.clearTimeout(timeoutId);
          resolve(normalizeChatSendAck(response));
        });
      });

      if (!ack) {
        toast("Чат не ответил. Попробуйте еще раз", "error");
        return;
      }

      if (!ack.ok) {
        handleChatErrorAck(ack);
        return;
      }

      setChatClockMs(Date.now());
      const nextAllowedAtMs =
        Number.isFinite(ack.nextMessageAtMs) && ack.nextMessageAtMs > 0
          ? ack.nextMessageAtMs
          : Date.now() + DEFAULT_CHAT_COOLDOWN_MS;
      setChatCooldownUntilMs((prev) => Math.max(prev, nextAllowedAtMs));
      setChatMessages((prev) => {
        if (prev.some((entry) => entry.id === ack.message.id)) return prev;
        return [...prev, ack.message].slice(-CHAT_HISTORY_LIMIT);
      });
    } finally {
      setIsSendingChat(false);
    }
  }, [chatCooldownUntilMs, chatMutedUntilMs, handleChatErrorAck, isChatSendingEnabled, toast]);

  const deleteChatMessage = useCallback(async (messageId: string) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      toast("Нет соединения с чатом", "error", 2200);
      return;
    }

    if (!isChatAdmin) {
      toast("Недостаточно прав", "error", 2200);
      return;
    }

    const ack = await new Promise<ChatDeleteAck | null>((resolve) => {
      let resolved = false;
      const timeoutId = window.setTimeout(() => {
        if (resolved) return;
        resolved = true;
        resolve(null);
      }, 5000);

      socket.emit("chat:delete", { messageId }, (response: unknown) => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutId);
        resolve(normalizeChatDeleteAck(response));
      });
    });

    if (!ack) {
      toast("Сервер чата не ответил", "error", 2200);
      return;
    }

    if (!ack.ok) {
      toast(ack.error || "Не удалось удалить сообщение", "error", 2400);
      return;
    }

    setChatMessages((prev) => prev.filter((entry) => entry.id !== ack.messageId));
  }, [isChatAdmin, toast]);

  const toggleChatSending = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      toast("Нет соединения с чатом", "error", 2200);
      return;
    }

    if (!isChatAdmin || isTogglingChat) {
      return;
    }

    setIsTogglingChat(true);
    try {
      const ack = await new Promise<ChatToggleAck | null>((resolve) => {
        let resolved = false;
        const timeoutId = window.setTimeout(() => {
          if (resolved) return;
          resolved = true;
          resolve(null);
        }, 5000);

        socket.emit("chat:toggle", { enabled: !isChatSendingEnabled }, (response: unknown) => {
          if (resolved) return;
          resolved = true;
          window.clearTimeout(timeoutId);
          resolve(normalizeChatToggleAck(response));
        });
      });

      if (!ack) {
        toast("Сервер чата не ответил", "error", 2200);
        return;
      }

      if (!ack.ok) {
        toast(ack.error || "Не удалось изменить режим чата", "error", 2400);
        return;
      }

      setIsChatSendingEnabled(ack.sendingEnabled);
      toast(ack.sendingEnabled ? "Чат включен" : "Чат остановлен", "info", 2200);
    } finally {
      setIsTogglingChat(false);
    }
  }, [isChatAdmin, isChatSendingEnabled, isTogglingChat, toast]);

  useEffect(() => {
    const now = Date.now();
    if (chatCooldownUntilMs <= now && chatMutedUntilMs <= now) {
      setChatClockMs(now);
      return;
    }

    setChatClockMs(now);
    const interval = window.setInterval(() => {
      setChatClockMs(Date.now());
    }, 250);
    return () => window.clearInterval(interval);
  }, [chatCooldownUntilMs, chatMutedUntilMs]);

  /** Подписывает сокет на события чата и возвращает запрос актуального состояния. */
  const bindChatSocket = useCallback((socket: Socket) => {
    const requestChatHistory = () => {
      socket.emit("chat:getHistory", (response: unknown) => {
        const ack = normalizeChatHistoryAck(response);
        if (!ack || !ack.ok) return;
        setChatMessages(ack.messages.slice(-CHAT_HISTORY_LIMIT));
      });
    };

    const requestChatStatus = () => {
      socket.emit("chat:getStatus", (response: unknown) => {
        if (!response || typeof response !== "object") return;
        const source = response as Record<string, unknown>;
        if (source.ok !== true) return;
        const status = normalizeChatStatusPayload(source);
        if (!status) return;
        setIsChatSendingEnabled(status.sendingEnabled);
      });
    };

    socket.on("chat:history", (payload: unknown) => {
      if (!Array.isArray(payload)) return;
      const normalized = payload
        .map((entry) => normalizeChatMessage(entry))
        .filter((entry): entry is ChatMessage => entry !== null)
        .slice(-CHAT_HISTORY_LIMIT);
      setChatMessages(normalized);
    });
    socket.on("chat:new", (payload: unknown) => {
      const message = normalizeChatMessage(payload);
      if (!message) return;
      setChatMessages((prev) => {
        if (prev.some((entry) => entry.id === message.id)) return prev;
        return [...prev, message].slice(-CHAT_HISTORY_LIMIT);
      });
    });
    socket.on("chat:deleted", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const source = payload as Record<string, unknown>;
      if (typeof source.messageId !== "string" || source.messageId.length === 0) return;
      setChatMessages((prev) => prev.filter((entry) => entry.id !== source.messageId));
    });
    socket.on("chat:status", (payload: unknown) => {
      const status = normalizeChatStatusPayload(payload);
      if (!status) return;
      setIsChatSendingEnabled(status.sendingEnabled);
    });
    socket.on("chat:role", (payload: unknown) => {
      const role = normalizeChatRolePayload(payload);
      if (!role) return;
      setIsChatAdmin(role.isAdmin);
    });
    socket.on("chat:error", (payload: unknown) => {
      const ack = normalizeChatSendAck(payload);
      if (!ack || ack.ok) return;
      handleChatErrorAck(ack);
    });

    return () => {
      requestChatHistory();
      requestChatStatus();
    };
  }, [handleChatErrorAck]);

  const resetChatRole = useCallback(() => setIsChatAdmin(false), []);

  return {
    messages: chatMessages,
    isSending: isSendingChat,
    isSendingEnabled: isChatSendingEnabled,
    isAdmin: isChatAdmin,
    isToggling: isTogglingChat,
    cooldownMsLeft: Math.max(0, chatCooldownUntilMs - chatClockMs),
    mutedMsLeft: Math.max(0, chatMutedUntilMs - chatClockMs),
    send: sendChatMessage,
    deleteMessage: deleteChatMessage,
    toggleSending: toggleChatSending,
    bindChatSocket,
    resetChatRole
  };
}
