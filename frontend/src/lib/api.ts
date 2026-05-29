import type { Deal, DealListItem, DealRole, User } from "../types";
import { authHeaders, multipartAuthHeaders } from "./telegram";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorBody.message || "Ошибка запроса");
  }
  return (await response.json()) as T;
};

export const getMe = async () => {
  const response = await fetch(`${API_BASE}/v1/me`, { headers: authHeaders() });
  return readJson<User>(response);
};

export const listDeals = async (q = "") => {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const response = await fetch(`${API_BASE}/v1/deals?${params.toString()}`, { headers: authHeaders() });
  return readJson<DealListItem[]>(response);
};

export const createDeal = async (payload: {
  title: string;
  terms: string;
  ownerRole: DealRole;
  amount: number;
}) => {
  const response = await fetch(`${API_BASE}/v1/deals`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  return readJson<Deal>(response);
};

export const getDeal = async (code: string) => {
  const response = await fetch(`${API_BASE}/v1/deals/${encodeURIComponent(code)}`, { headers: authHeaders() });
  return readJson<Deal>(response);
};

export const sendMessage = async (code: string, text: string) => {
  const response = await fetch(`${API_BASE}/v1/deals/${encodeURIComponent(code)}/messages`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ text })
  });
  return readJson<Deal>(response);
};

export const sendPhotos = async (code: string, files: File[]) => {
  const body = new FormData();
  files.slice(0, 10).forEach((file) => body.append("photos", file));
  const response = await fetch(`${API_BASE}/v1/deals/${encodeURIComponent(code)}/photos`, {
    method: "POST",
    headers: multipartAuthHeaders(),
    body
  });
  return readJson<Deal>(response);
};

export const sendRequisites = async (code: string, text: string) => adminPost(code, "requisites", text);
export const sendNotification = async (code: string, text: string) => adminPost(code, "notify", text);

export const closeDeal = async (code: string) => {
  const response = await fetch(`${API_BASE}/v1/deals/${encodeURIComponent(code)}/admin/close`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return readJson<Deal>(response);
};

const adminPost = async (code: string, action: string, text: string) => {
  const response = await fetch(`${API_BASE}/v1/deals/${encodeURIComponent(code)}/admin/${action}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ text })
  });
  return readJson<Deal>(response);
};
