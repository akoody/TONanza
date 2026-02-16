export type PlayerChance = {
  userId: string;
  name: string;
  amountNanotons: bigint;
  color: string;
};

export type ActiveGameResponse = {
  id: string;
  serverSeedHash: string;
  status: "OPEN" | "LOCKED" | "FINISHED" | "CANCELLED";
  totalPotNanotons: string;
  nextTicket: string;
  startsAt: string;
  endsAt: string;
};

export type PlaceBetResponse = {
  betId: string;
  userId: string;
  gameId: string;
  amountNanotons: string;
  ticketStart: string;
  ticketEnd: string;
  totalPotNanotons: string;
  endsAt: string;
};

export type ResolveResponse = {
  status: "FINISHED" | "CANCELLED";
  gameId: string;
  winnerId: string | null;
  winnerBetId?: string;
  winningTicket: string | null;
  payoutNanotons: string;
  commissionNanotons: string;
  totalPotNanotons: string;
  proof: {
    algorithm: string;
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    totalTickets: string;
    winningTicket: string;
  } | null;
};

export type LiveEvent = {
  id: string;
  text: string;
  createdAt: number;
};
