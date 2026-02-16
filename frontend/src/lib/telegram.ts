import WebApp from "@twa-dev/sdk";

let initialized = false;

export const initTelegram = () => {
  if (initialized) {
    return;
  }

  try {
    WebApp.ready();
    WebApp.expand();
    initialized = true;
  } catch {
    initialized = false;
  }
};

const safeHaptic = (callback: () => void) => {
  try {
    callback();
  } catch {
    // Ignore haptic calls outside Telegram runtime.
  }
};

export const hapticImpactLight = () => {
  safeHaptic(() => WebApp.HapticFeedback.impactOccurred("light"));
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
