import { createHash, randomBytes } from "crypto";

export const generateServerSeed = (): string => randomBytes(32).toString("hex");

export const hashSeed = (seed: string): string => {
  return createHash("sha256").update(seed).digest("hex");
};

export const deriveWinningTicket = (input: {
  serverSeed: string;
  clientSeed: string;
  maxTicket: bigint;
}): bigint => {
  if (input.maxTicket <= 0n) {
    throw new Error("maxTicket must be positive");
  }

  // Deterministic hash from both seeds allows public post-round verification.
  const digestHex = createHash("sha256")
    .update(`${input.serverSeed}:${input.clientSeed}`)
    .digest("hex");

  const randomNumber = BigInt(`0x${digestHex}`);
  return (randomNumber % input.maxTicket) + 1n;
};

export const buildRoundProof = (input: {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  totalTickets: bigint;
  winningTicket: bigint;
}) => {
  return {
    algorithm: "winningTicket = (sha256(serverSeed:clientSeed) % totalTickets) + 1",
    serverSeed: input.serverSeed,
    serverSeedHash: input.serverSeedHash,
    clientSeed: input.clientSeed,
    totalTickets: input.totalTickets,
    winningTicket: input.winningTicket
  };
};
