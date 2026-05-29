import WebApp from "@twa-dev/sdk";

let initialized = false;
const DEFAULT_FULLSCREEN_RETRY_DELAYS_MS = [0, 180, 520, 1200, 2200] as const;
const DESKTOP_TG_PLATFORMS = new Set(["tdesktop", "macos", "web", "weba", "webk", "webz"]);

type TelegramWebAppRuntime = {
  platform?: string;
  isFullscreen?: boolean;
  isExpanded?: boolean;
  version?: string;
  openTelegramLink?: (link: string) => void;
  openLink?: (link: string, options?: { try_instant_view: boolean }) => void;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  requestFullscreen?: () => void;
  requestWriteAccess?: (callback?: (access: boolean) => unknown) => void;
  onEvent?: (eventType: string, callback: (...args: any[]) => void) => void;
  offEvent?: (eventType: string, callback: (...args: any[]) => void) => void;
  isVersionAtLeast?: (version: string) => boolean;
};

const getTelegramRuntime = (): TelegramWebAppRuntime | null => {
  if (typeof window === "undefined") return null;
  return ((window as any).Telegram?.WebApp as TelegramWebAppRuntime | undefined) ?? null;
};

const getTelegramPlatform = (): string => {
  try {
    const twa = getTelegramRuntime();
    return (twa?.platform ?? WebApp.platform ?? "").toLowerCase();
  } catch {
    return "";
  }
};

const isDesktopTelegramPlatform = (): boolean => {
  return DESKTOP_TG_PLATFORMS.has(getTelegramPlatform());
};

const postTelegramEvent = (eventType: string, eventData?: unknown) => {
  if (typeof window === "undefined") return;
  const webView = (window as any).Telegram?.WebView;
  if (!webView || typeof webView.postEvent !== "function") return;

  try {
    if (typeof eventData === "undefined") {
      webView.postEvent(eventType);
      return;
    }
    webView.postEvent(eventType, false, eventData);
  } catch (e) {
    console.warn(`[TG] postEvent(${eventType}) error:`, e);
  }
};

let viewportNudgeAttached = false;

const attachViewportFullscreenNudge = () => {
  if (viewportNudgeAttached) return;
  if (isDesktopTelegramPlatform()) return;

  const twa = getTelegramRuntime();
  if (!twa || typeof twa.onEvent !== "function" || typeof twa.offEvent !== "function") return;

  viewportNudgeAttached = true;
  let requestsCount = 0;

  const onViewportChanged = (payload?: { isStateStable?: boolean }) => {
    requestsCount += 1;

    // Telegram can open in compact/full-size first and then stabilize viewport.
    // Re-request fullscreen during first stable viewport updates.
    if (payload?.isStateStable || requestsCount <= 3) {
      requestFullscreenOnce();
    }

    if (requestsCount >= 6) {
      twa.offEvent?.("viewportChanged", onViewportChanged);
      viewportNudgeAttached = false;
    }
  };

  twa.onEvent("viewportChanged", onViewportChanged);
  window.setTimeout(() => {
    twa.offEvent?.("viewportChanged", onViewportChanged);
    viewportNudgeAttached = false;
  }, 6000);
};

const requestExpandOnce = () => {
  const twa = getTelegramRuntime();
  if (!twa) return;

  try {
    twa.expand?.();
    postTelegramEvent("web_app_expand");
  } catch (e) {
    console.warn("[TG] expand error:", e);
  }
};

const requestFullscreenOnce = () => {
  if (isDesktopTelegramPlatform()) {
    requestExpandOnce();
    return;
  }

  const twa = getTelegramRuntime();
  if (!twa) return;

  try {
    // Fallback-safe: fullscreen is preferred, expand keeps max height on older clients.
    twa.expand?.();
    postTelegramEvent("web_app_expand");

    // Older @twa-dev/sdk builds don't expose requestFullscreen on WebApp,
    // so we also post the raw Telegram event directly.
    if (typeof twa.requestFullscreen === "function" && !twa.isFullscreen) {
      twa.requestFullscreen();
    }
    if (!twa.isFullscreen) {
      postTelegramEvent("web_app_request_fullscreen");
    }
  } catch (e) {
    console.warn("[TG] requestFullscreen error:", e);
  }
};

export const ensureTelegramFullscreen = (
  retryDelaysMs: readonly number[] = DEFAULT_FULLSCREEN_RETRY_DELAYS_MS
) => {
  if (isDesktopTelegramPlatform()) {
    requestExpandOnce();
    return;
  }

  const delays = Array.from(new Set(retryDelaysMs))
    .filter((value): value is number => Number.isFinite(value) && value >= 0)
    .map((value) => Math.trunc(value))
    .sort((left, right) => left - right);

  if (delays.length === 0) {
    requestFullscreenOnce();
    return;
  }

  for (const delay of delays) {
    if (delay === 0) {
      requestFullscreenOnce();
      continue;
    }
    window.setTimeout(requestFullscreenOnce, delay);
  }
};

const isHapticsAllowed = (): boolean => {
  try {
    const rawSettings = localStorage.getItem("tonanza_settings");
    if (!rawSettings) return true;
    const parsed = JSON.parse(rawSettings) as { hapticsEnabled?: boolean };
    return parsed.hapticsEnabled !== false;
  } catch {
    return true;
  }
};

export const initTelegram = () => {
  if (initialized) {
    return;
  }

  const twa = getTelegramRuntime();

  try {
    if (twa) {
      twa.ready?.();
      twa.disableVerticalSwipes?.();
    }

    // Force fullscreen (or fallback to expanded mode) for all launch entry points.
    ensureTelegramFullscreen();
    attachViewportFullscreenNudge();

    initialized = true;
  } catch (e) {
    console.warn("[TG] init error:", e);
    initialized = true;
  }
};

const safeHaptic = (callback: () => void) => {
  if (!isHapticsAllowed()) {
    return;
  }
  try {
    callback();
  } catch {
    // Ignore haptic calls outside Telegram runtime.
  }
};

export const hapticImpactLight = () => {
  safeHaptic(() => WebApp.HapticFeedback.impactOccurred("light"));
};

export const hapticImpactMedium = () => {
  safeHaptic(() => WebApp.HapticFeedback.impactOccurred("medium"));
};

export const hapticSelectionChanged = () => {
  safeHaptic(() => WebApp.HapticFeedback.selectionChanged());
};

export const hapticNotificationSuccess = () => {
  safeHaptic(() => WebApp.HapticFeedback.notificationOccurred("success"));
};

export const getTelegramUserId = (): string | null => {
  try {
    const id = WebApp.initDataUnsafe?.user?.id;
    if (typeof id === "number") {
      return String(id);
    }

    return null;
  } catch {
    return null;
  }
};

export const isTWA = (): boolean => {
  try {
    return !!WebApp.initData;
  } catch {
    return false;
  }
};

export const getInitData = (): string => {
  return WebApp.initData;
};

export const isDesktopPlatform = (): boolean => {
  return isDesktopTelegramPlatform();
};

export const getStartParam = (): string | undefined => {
  try {
    return WebApp.initDataUnsafe?.start_param;
  } catch {
    return undefined;
  }
};

export const openTelegramUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const twa = getTelegramRuntime();
    if (typeof twa?.openTelegramLink === "function") {
      twa.openTelegramLink(trimmed);
      return true;
    }
  } catch (e) {
    console.warn("[TG] openTelegramLink runtime error:", e);
  }

  try {
    WebApp.openTelegramLink(trimmed);
    return true;
  } catch (e) {
    console.warn("[TG] WebApp.openTelegramLink error:", e);
  }

  try {
    if (typeof window !== "undefined") {
      window.open(trimmed, "_blank", "noopener,noreferrer");
      return true;
    }
  } catch (e) {
    console.warn("[TG] window.open fallback error:", e);
  }

  return false;
};

const WRITE_ACCESS_RESULT_TIMEOUT_MS = 12_000;

export type TelegramWriteAccessResult =
  | "allowed"
  | "cancelled"
  | "unsupported"
  | "unavailable"
  | "error";

export const requestTelegramWriteAccess = async (): Promise<TelegramWriteAccessResult> => {
  const twa = getTelegramRuntime();
  if (!twa) return "unavailable";

  if (typeof twa.isVersionAtLeast === "function" && !twa.isVersionAtLeast("6.9")) {
    return "unsupported";
  }

  if (typeof twa.requestWriteAccess !== "function" && typeof WebApp.requestWriteAccess !== "function") {
    return "unsupported";
  }

  return await new Promise<TelegramWriteAccessResult>((resolve) => {
    let settled = false;
    let cleanup: () => void = () => {};
    const finish = (result: TelegramWriteAccessResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const handleEvent = (payload?: { status?: "allowed" | "cancelled" }) => {
      finish(payload?.status === "allowed" ? "allowed" : "cancelled");
    };

    const onWriteAccessResult = (allowed: boolean) => {
      finish(allowed ? "allowed" : "cancelled");
    };

    const timeoutId = window.setTimeout(() => {
      finish("error");
    }, WRITE_ACCESS_RESULT_TIMEOUT_MS);

    cleanup = () => {
      window.clearTimeout(timeoutId);
      try {
        twa.offEvent?.("writeAccessRequested", handleEvent);
      } catch {
        // Ignore listener cleanup errors.
      }
    };

    try {
      twa.onEvent?.("writeAccessRequested", handleEvent);
    } catch {
      // If events are not supported, callback result still works.
    }

    try {
      if (typeof twa.requestWriteAccess === "function") {
        twa.requestWriteAccess(onWriteAccessResult);
      } else {
        WebApp.requestWriteAccess(onWriteAccessResult);
      }
    } catch (e) {
      console.warn("[TG] requestWriteAccess error:", e);
      finish("error");
    }
  });
};
