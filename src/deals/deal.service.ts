import crypto from "node:crypto";
import { ChatMessageKind, DealParticipantRole, DealRole, DealStatus, Prisma, type PrismaClient, type User } from "@prisma/client";
import { AppError } from "../shared/errors.js";
import type { TelegramAuthContext } from "../shared/telegram-auth.js";

const DEAL_INCLUDE = {
  owner: true,
  participants: { include: { user: true }, orderBy: { createdAt: "asc" } },
  messages: {
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 150
  }
} satisfies Prisma.DealInclude;

type DealWithRelations = Prisma.DealGetPayload<{ include: typeof DEAL_INCLUDE }>;

export class DealService {
  constructor(
    private readonly db: PrismaClient,
    private readonly adminIds: Set<string>
  ) {}

  async upsertUser(auth: TelegramAuthContext): Promise<User> {
    const telegramId = auth.telegramId;
    const isAdmin = this.adminIds.has(telegramId.toString());

    return this.db.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        username: auth.username,
        firstName: auth.firstName,
        lastName: auth.lastName,
        avatarUrl: auth.avatarUrl,
        isAdmin
      },
      update: {
        username: auth.username,
        firstName: auth.firstName,
        lastName: auth.lastName,
        avatarUrl: auth.avatarUrl,
        isAdmin
      }
    });
  }

  async createDeal(user: User, input: { title: string; terms: string; ownerRole: DealRole; amount: number }) {
    const code = await this.createUniqueCode();
    const amountCents = Math.round(input.amount * 100);

    const deal = await this.db.deal.create({
      data: {
        code,
        title: input.title,
        terms: input.terms,
        ownerRole: input.ownerRole,
        amountCents,
        ownerId: user.id,
        participants: {
          create: {
            userId: user.id,
            role: user.isAdmin ? DealParticipantRole.ADMIN : DealParticipantRole.OWNER
          }
        },
        messages: {
          create: {
            kind: ChatMessageKind.SYSTEM,
            text: `Сделка создана. Код сделки: ${code}`
          }
        }
      },
      include: DEAL_INCLUDE
    });

    return this.serializeDeal(deal, user);
  }

  async listDeals(user: User, q = "") {
    const where = this.buildDealListWhere(user, q);
    const deals = await this.db.deal.findMany({
      where,
      include: {
        owner: true,
        participants: { include: { user: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { messages: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return deals.map((deal) => ({
      id: deal.id.toString(),
      code: deal.code,
      title: deal.title,
      terms: deal.terms,
      status: deal.status,
      ownerRole: deal.ownerRole,
      amount: deal.amountCents / 100,
      createdAt: deal.createdAt.toISOString(),
      owner: this.serializeUser(deal.owner),
      participants: deal.participants.map((participant) => ({
        role: participant.role,
        user: this.serializeUser(participant.user)
      })),
      messagesCount: deal._count.messages
    }));
  }

  async getDealByCode(user: User, code: string) {
    const deal = await this.db.deal.findUnique({
      where: { code: code.toUpperCase() },
      include: DEAL_INCLUDE
    });
    if (!deal) {
      throw new AppError(404, "Сделка не найдена", "DEAL_NOT_FOUND");
    }

    await this.ensureAccessOrJoin(deal, user);
    const reloaded = await this.db.deal.findUniqueOrThrow({
      where: { id: deal.id },
      include: DEAL_INCLUDE
    });
    return this.serializeDeal(reloaded, user);
  }

  async addTextMessage(user: User, code: string, text: string) {
    const deal = await this.findAccessibleDeal(user, code);
    await this.assertDealOpen(deal.status);
    await this.db.chatMessage.create({
      data: {
        dealId: deal.id,
        userId: user.id,
        kind: ChatMessageKind.TEXT,
        text
      }
    });
    return this.getDealByCode(user, code);
  }

  async addPhotoMessage(user: User, code: string, photoUrl: string) {
    const deal = await this.findAccessibleDeal(user, code);
    await this.assertDealOpen(deal.status);
    await this.db.chatMessage.create({
      data: {
        dealId: deal.id,
        userId: user.id,
        kind: ChatMessageKind.PHOTO,
        photoUrl
      }
    });
    return this.getDealByCode(user, code);
  }

  async addAdminRequisites(user: User, code: string, text: string) {
    const deal = await this.findAdminDeal(user, code);
    await this.db.$transaction([
      this.db.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.WAITING_PAYMENT }
      }),
      this.db.chatMessage.create({
        data: {
          dealId: deal.id,
          userId: user.id,
          kind: ChatMessageKind.REQUISITES,
          text
        }
      })
    ]);
    return this.getDealByCode(user, code);
  }

  async addAdminNotification(user: User, code: string, text: string) {
    const deal = await this.findAdminDeal(user, code);
    await this.db.chatMessage.create({
      data: {
        dealId: deal.id,
        userId: user.id,
        kind: ChatMessageKind.NOTIFICATION,
        text
      }
    });
    return this.getDealByCode(user, code);
  }

  async closeDeal(user: User, code: string) {
    const deal = await this.findAdminDeal(user, code);
    await this.db.$transaction([
      this.db.deal.update({
        where: { id: deal.id },
        data: { status: DealStatus.CLOSED, closedAt: new Date() }
      }),
      this.db.chatMessage.create({
        data: {
          dealId: deal.id,
          userId: user.id,
          kind: ChatMessageKind.SYSTEM,
          text: "Сделка закрыта администратором."
        }
      })
    ]);
    return this.getDealByCode(user, code);
  }

  private buildDealListWhere(user: User, q: string): Prisma.DealWhereInput {
    const visible: Prisma.DealWhereInput = user.isAdmin
      ? {}
      : {
          OR: [{ ownerId: user.id }, { participants: { some: { userId: user.id } } }]
        };

    const query = q.trim();
    if (!query) return visible;

    return {
      AND: [
        visible,
        {
          OR: [
            { code: { equals: query.toUpperCase() } },
            { title: { contains: query, mode: "insensitive" } }
          ]
        }
      ]
    };
  }

  private async createUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      const existing = await this.db.deal.findUnique({ where: { code }, select: { id: true } });
      if (!existing) return code;
    }
    throw new AppError(500, "Не удалось сгенерировать код сделки", "DEAL_CODE_GENERATION_FAILED");
  }

  private async ensureAccessOrJoin(deal: DealWithRelations, user: User) {
    if (user.isAdmin || deal.participants.some((participant) => participant.userId === user.id)) return;
    if (deal.status === DealStatus.CLOSED) {
      throw new AppError(403, "Сделка закрыта", "DEAL_CLOSED");
    }

    await this.db.dealParticipant.create({
      data: {
        dealId: deal.id,
        userId: user.id,
        role: DealParticipantRole.MEMBER
      }
    });
  }

  private async findAccessibleDeal(user: User, code: string) {
    const deal = await this.db.deal.findUnique({
      where: { code: code.toUpperCase() },
      include: { participants: true }
    });
    if (!deal) throw new AppError(404, "Сделка не найдена", "DEAL_NOT_FOUND");
    if (!user.isAdmin && !deal.participants.some((participant) => participant.userId === user.id)) {
      throw new AppError(403, "Нет доступа к сделке", "DEAL_ACCESS_DENIED");
    }
    return deal;
  }

  private async findAdminDeal(user: User, code: string) {
    if (!user.isAdmin) throw new AppError(403, "Доступно только администратору", "ADMIN_REQUIRED");
    return this.findAccessibleDeal(user, code);
  }

  private async assertDealOpen(status: DealStatus) {
    if (status === DealStatus.CLOSED) {
      throw new AppError(409, "Сделка закрыта", "DEAL_CLOSED");
    }
  }

  private serializeDeal(deal: DealWithRelations, viewer: User) {
    return {
      id: deal.id.toString(),
      code: deal.code,
      title: deal.title,
      terms: deal.terms,
      status: deal.status,
      ownerRole: deal.ownerRole,
      amount: deal.amountCents / 100,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
      closedAt: deal.closedAt?.toISOString() ?? null,
      owner: this.serializeUser(deal.owner),
      viewer: this.serializeUser(viewer),
      participants: deal.participants.map((participant) => ({
        id: participant.id.toString(),
        role: participant.role,
        user: this.serializeUser(participant.user)
      })),
      messages: deal.messages.map((message) => ({
        id: message.id.toString(),
        kind: message.kind,
        text: message.text,
        photoUrl: message.photoUrl,
        createdAt: message.createdAt.toISOString(),
        user: message.user ? this.serializeUser(message.user) : null
      }))
    };
  }

  private serializeUser(user: User) {
    return {
      id: user.id.toString(),
      telegramId: user.telegramId.toString(),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin
    };
  }
}
