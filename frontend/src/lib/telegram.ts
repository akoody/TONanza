import WebApp from "@twa-dev/sdk";

export const initTelegram = () => {
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor("#0b182b");
    WebApp.setBackgroundColor("#0b182b");
  } catch {
    // Browser preview outside Telegram.
  }
};

export const authHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (WebApp.initData) {
    headers["X-Telegram-Init-Data"] = WebApp.initData;
  } else if (import.meta.env.DEV) {
    headers["x-bypass-auth"] = "true";
    headers["x-dev-user-id"] = window.localStorage.getItem("sdelki_dev_user_id") || "100000001";
  }
  return headers;
};

export const multipartAuthHeaders = (): Record<string, string> => {
  const headers = authHeaders();
  delete headers["Content-Type"];
  return headers;
};

export const haptic = () => {
  try {
    WebApp.HapticFeedback.selectionChanged();
  } catch {
    // No-op outside Telegram.
  }
};
