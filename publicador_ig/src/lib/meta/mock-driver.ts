import crypto from "node:crypto";
import { MetaApiError } from "./errors";
import type {
  ContainerStatus,
  CreateContainerInput,
  DiscoveredAccount,
  LongLivedToken,
  MediaMetrics,
  MetaDriver,
  PostTypeName,
  PublishingLimit,
} from "./types";

/**
 * Driver de desenvolvimento. Imita o comportamento da Graph API, inclusive o
 * que mais costuma morder em producao: o container nao fica pronto na hora, a
 * cota de 24h existe, e uma fracao das chamadas falha de forma transitoria.
 *
 * Serve para rodar a plataforma inteira (fila, retry, dashboard) sem bater na
 * Meta. Nao publica nada em lugar nenhum.
 */

interface MockContainer {
  id: string;
  igUserId: string;
  readyAt: number;
  willFail: boolean;
  type: PostTypeName;
}

const containers = new Map<string, MockContainer>();
const publishedByAccount = new Map<string, number[]>(); // igUserId -> timestamps

const QUOTA_TOTAL = 50;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Chance de falha transitoria, para exercitar o caminho de retry. */
const TRANSIENT_FAILURE_RATE = Number(process.env.MOCK_FAILURE_RATE ?? "0.08");
/** Quanto tempo o "processamento" do video leva. */
const PROCESSING_MS = Number(process.env.MOCK_PROCESSING_MS ?? "4000");

function recentPublishes(igUserId: string): number[] {
  const cutoff = Date.now() - QUOTA_WINDOW_MS;
  const list = (publishedByAccount.get(igUserId) ?? []).filter((t) => t > cutoff);
  publishedByAccount.set(igUserId, list);
  return list;
}

export class MockDriver implements MetaDriver {
  readonly name = "mock" as const;

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedToken> {
    return {
      accessToken: `mock-long-lived-${crypto.randomBytes(8).toString("hex")}-${shortLivedToken.slice(0, 6)}`,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };
  }

  async listInstagramAccounts(): Promise<DiscoveredAccount[]> {
    const handles = ["marca.oficial", "loja.centro", "loja.shopping", "studio.criativo"];
    return handles.map((h, i) => ({
      igUserId: `1784${String(i).padStart(12, "0")}`,
      igUsername: h,
      igAccountType: "BUSINESS",
      pageId: `page-${i}`,
      pageName: h.replace(/\./g, " "),
      profilePicUrl: null,
      followersCount: 1200 + i * 3400,
      accessToken: `mock-page-token-${i}`,
    }));
  }

  async getPublishingLimit(igUserId: string): Promise<PublishingLimit> {
    return { quotaUsage: recentPublishes(igUserId).length, quotaTotal: QUOTA_TOTAL };
  }

  async createContainer(input: CreateContainerInput): Promise<string> {
    if (Math.random() < TRANSIENT_FAILURE_RATE) {
      throw new MetaApiError({
        message: "[mock] Falha temporaria ao buscar a midia na URL informada",
        code: 2207020,
        httpStatus: 400,
      });
    }
    if (input.type === "CAROUSEL") {
      const n = input.children?.length ?? 0;
      if (n < 2 || n > 10) {
        throw new MetaApiError({
          message: "[mock] Carrossel precisa de 2 a 10 itens",
          code: 2207035,
          httpStatus: 400,
        });
      }
    }
    if (input.type === "REEL" && !input.videoUrl) {
      throw new MetaApiError({
        message: "[mock] Reel exige video_url",
        code: 2207006,
        httpStatus: 400,
      });
    }

    const id = `mock-container-${crypto.randomBytes(10).toString("hex")}`;
    // Video demora mais que imagem para ficar pronto, como na vida real.
    const delay = input.type === "REEL" ? PROCESSING_MS : Math.round(PROCESSING_MS / 4);
    containers.set(id, {
      id,
      igUserId: input.igUserId,
      readyAt: Date.now() + delay,
      willFail: Math.random() < TRANSIENT_FAILURE_RATE / 2,
      type: input.type,
    });
    return id;
  }

  async getContainerStatus(containerId: string): Promise<ContainerStatus> {
    const c = containers.get(containerId);
    if (!c) {
      return { statusCode: "EXPIRED", status: "[mock] container nao encontrado", errorMessage: "expirado" };
    }
    if (Date.now() < c.readyAt) {
      return { statusCode: "IN_PROGRESS", status: "[mock] processando midia", errorMessage: null };
    }
    if (c.willFail) {
      return {
        statusCode: "ERROR",
        status: "[mock] falha no processamento do video",
        errorMessage: "[mock] falha no processamento do video",
      };
    }
    return { statusCode: "FINISHED", status: "[mock] pronto", errorMessage: null };
  }

  async publishContainer(igUserId: string, containerId: string): Promise<string> {
    const c = containers.get(containerId);
    if (!c) {
      throw new MetaApiError({ message: "[mock] container expirado", code: 9004, httpStatus: 400 });
    }
    if (recentPublishes(igUserId).length >= QUOTA_TOTAL) {
      throw new MetaApiError({
        message: "[mock] The user has reached the publishing limit",
        code: 9,
        httpStatus: 400,
      });
    }
    publishedByAccount.set(igUserId, [...recentPublishes(igUserId), Date.now()]);
    containers.delete(containerId);
    return `mock-media-${crypto.randomBytes(10).toString("hex")}`;
  }

  async getPermalink(igMediaId: string): Promise<string | null> {
    return `https://www.instagram.com/p/mock_${igMediaId.slice(-8)}/`;
  }

  async getInsights(_igMediaId: string, _token: string, type: PostTypeName): Promise<MediaMetrics> {
    const base = type === "REEL" ? 4000 : 900;
    const rand = (mult: number) => Math.round(base * mult * (0.6 + Math.random() * 0.8));
    const reach = rand(1);
    return {
      reach,
      views: type === "STORY" ? reach : rand(1.6),
      likes: rand(0.06),
      comments: rand(0.004),
      shares: rand(0.01),
      saved: rand(0.02),
      totalInteractions: rand(0.09),
      raw: { mock: true, type },
    };
  }
}
