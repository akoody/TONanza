import { GameStatus, PrismaClient } from "@prisma/client";
import { GameService } from "../game/game.service.js";
import { TonEntropyService } from "../wallet/ton-entropy.service.js";

export class RoundScheduler {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly gameService: GameService,
    private readonly entropyService: TonEntropyService,
    private readonly pollIntervalMs = 1_000
  ) {}

  start() {
    if (this.intervalId) {
      return;
    }

    void this.tick();
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop() {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  private async tick() {
    try {
      const expiredRounds = await this.prisma.game.findMany({
        where: {
          status: GameStatus.OPEN,
          endsAt: {
            lte: new Date()
          }
        },
        select: {
          id: true
        },
        orderBy: {
          endsAt: "asc"
        },
        take: 5
      });

      for (const round of expiredRounds) {
        const clientSeed = await this.entropyService.getClientSeed();
        await this.gameService.determineWinner(round.id, clientSeed);
      }
    } catch (error) {
      console.error("RoundScheduler tick failed", error);
    }
  }
}
