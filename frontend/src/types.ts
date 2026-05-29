export type DealStatus = "OPEN" | "WAITING_PAYMENT" | "IN_PROGRESS" | "CLOSED";
export type DealRole = "BUYER" | "SELLER";
export type ChatMessageKind = "TEXT" | "PHOTO" | "SYSTEM" | "REQUISITES" | "NOTIFICATION";

export type User = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
};

export type DealListItem = {
  id: string;
  code: string;
  title: string;
  terms: string;
  status: DealStatus;
  ownerRole: DealRole;
  amount: number;
  createdAt: string;
  owner: User;
  participants: Array<{ role: string; user: User }>;
  messagesCount: number;
};

export type ChatMessage = {
  id: string;
  kind: ChatMessageKind;
  text: string | null;
  photoUrl: string | null;
  createdAt: string;
  user: User | null;
};

export type Deal = Omit<DealListItem, "messagesCount"> & {
  updatedAt: string;
  closedAt: string | null;
  viewer: User;
  messages: ChatMessage[];
};
