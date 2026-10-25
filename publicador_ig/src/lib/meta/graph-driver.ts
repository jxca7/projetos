import { env } from "../env";
import { graph } from "./client";
import { MetaApiError } from "./errors";
import type {
  ContainerStatus,
  ContainerStatusCode,
  CreateContainerInput,
  DiscoveredAccount,
  LongLivedToken,
  MediaMetrics,
  MetaDriver,
  PostTypeName,
  PublishingLimit,
} from "./types";

/**
 * Métricas de mídia do Instagram.
 *
 * A Meta mexe nos nomes de métrica com alguma frequência (impressions e
 * vídeo_views sairam, views entrou). Em vez de fixar uma lista e quebrar numa
 * mudanca, pedimos a lista cheia e, se a API reclamar de alguma métrica, caimos
 * para o conjunto mínimo que sempre existiu.
 */
const METRICS_BY_TYPE: Record<PostTypeName, string[]> = {
  REEL: ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"],
  IMAGE: ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"],
  CAROUSEL: ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"],
  STORY: ["reach", "views", "replies", "navigation"],
};

const FALLBACK_METRICS = ["reach"];

interface InsightsResponse {
  data?: Array<{
    name: string;
    values?: Array<{ value?: number }>;
    total_value?: { value?: number };
  }>;
}

function readMetric(res: InsightsResponse, name: string): number | null {
  const row = res.data?.find((d) => d.name === name);
  if (!row) return null;
  const v = row.total_value?.value ?? row.values?.[0]?.value;
  return typeof v === "number" ? v : null;
}

export class GraphDriver implements MetaDriver {
  readonly name = "graph" as const;

  /** Troca o `code` devolvido pelo dialogo de OAuth por um access token. */
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
    const { META_APP_ID, META_APP_SECRET } = env();
    const res = await graph.get<{ access_token: string }>("/oauth/access_token", "", {
      client_id: META_APP_ID,
      client_secret: META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    });
    if (!res?.access_token) {
      throw new MetaApiError({ message: "OAuth não devolveu access_token", httpStatus: 502 });
    }
    return res.access_token;
  }

  /**
   * Troca o token curto do Facebook Login por um de longa duração (~60 dias).
   * Tokens de página derivados deste não expiram enquanto o usuário mantiver a
   * permissão, mas guardamos a validade para avisar antes de quebrar.
   */
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedToken> {
    const { META_APP_ID, META_APP_SECRET } = env();
    const res = await graph.get<{ access_token: string; expires_in?: number }>(
      "/oauth/access_token",
      shortLivedToken,
      {
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    );
    return {
      accessToken: res.access_token,
      expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null,
    };
  }

  /**
   * Descobre as contas profissionais do Instagram que o usuário autorizou,
   * passando pelas Páginas do Facebook as quais elas estão vinculadas.
   */
  async listInstagramAccounts(userAccessToken: string): Promise<DiscoveredAccount[]> {
    interface PagesResponse {
      data?: Array<{
        id: string;
        name?: string;
        access_token?: string;
        instagram_business_account?: {
          id: string;
          username?: string;
          profile_picture_url?: string;
          followers_count?: number;
          account_type?: string;
        };
      }>;
      paging?: { next?: string };
    }

    const accounts: DiscoveredAccount[] = [];
    let after: string | undefined;

    do {
      const res = await graph.get<PagesResponse>("/me/accounts", userAccessToken, {
        fields:
          "id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count,account_type}",
        limit: 100,
        after,
      });

      for (const page of res.data ?? []) {
        const ig = page.instagram_business_account;
        if (!ig?.id) continue; // Página sem Instagram profissional vinculado
        accounts.push({
          igUserId: ig.id,
          igUsername: ig.username ?? ig.id,
          igAccountType: ig.account_type ?? null,
          pageId: page.id,
          pageName: page.name ?? null,
          profilePicUrl: ig.profile_picture_url ?? null,
          followersCount: ig.followers_count ?? null,
          // O token de página é o que autoriza publicar naquela conta.
          accessToken: page.access_token ?? userAccessToken,
        });
      }

      after = res.paging?.next ? new URL(res.paging.next).searchParams.get("after") ?? undefined : undefined;
    } while (after);

    return accounts;
  }

  /**
   * Cota de publicação da conta na janela deslizante de 24h.
   * Não fixamos o teto no código: a própria API informa o quota_total, que
   * varia por conta e ja mudou de valor algumas vezes (25 -> 50 -> 100).
   */
  async getPublishingLimit(igUserId: string, accessToken: string): Promise<PublishingLimit> {
    interface LimitResponse {
      data?: Array<{ quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }>;
    }
    const res = await graph.get<LimitResponse>(
      `/${igUserId}/content_publishing_limit`,
      accessToken,
      { fields: "config,quota_usage" },
    );
    const row = res.data?.[0];
    return {
      quotaUsage: row?.quota_usage ?? 0,
      quotaTotal: row?.config?.quota_total ?? 50,
    };
  }

  async createContainer(input: CreateContainerInput): Promise<string> {
    const params: Record<string, string | number | boolean | undefined> = {};

    switch (input.type) {
      case "IMAGE":
        params.image_url = input.imageUrl;
        params.caption = input.caption;
        break;

      case "REEL":
        params.media_type = "REELS";
        params.video_url = input.videoUrl;
        params.caption = input.caption;
        params.share_to_feed = input.shareToFeed ?? true;
        params.cover_url = input.coverUrl;
        if (input.thumbOffsetMs !== undefined) params.thumb_offset = input.thumbOffsetMs;
        params.audio_name = input.audioName;
        break;

      case "STORY":
        params.media_type = "STORIES";
        if (input.videoUrl) params.video_url = input.videoUrl;
        else params.image_url = input.imageUrl;
        // Nota: a API oficial ignora stickers (link, enquete, menção).
        // O link vira um Reminder para a pessoa colar no app.
        break;

      case "CAROUSEL":
        params.media_type = "CAROUSEL";
        params.caption = input.caption;
        params.children = (input.children ?? []).join(",");
        break;
    }

    if (input.isCarouselItem) {
      params.is_carousel_item = true;
      delete params.caption;
      delete params.media_type;
      if (input.videoUrl) {
        params.media_type = "VIDEO";
        params.video_url = input.videoUrl;
      } else {
        params.image_url = input.imageUrl;
      }
    }

    const res = await graph.post<{ id: string }>(`/${input.igUserId}/media`, input.accessToken, params);
    if (!res?.id) {
      throw new MetaApiError({ message: "Graph API não retornou id do container", httpStatus: 502 });
    }
    return res.id;
  }

  async getContainerStatus(containerId: string, accessToken: string): Promise<ContainerStatus> {
    const res = await graph.get<{ status_code?: string; status?: string }>(
      `/${containerId}`,
      accessToken,
      { fields: "status_code,status" },
    );
    const code = (res.status_code ?? "IN_PROGRESS") as ContainerStatusCode;
    return {
      statusCode: code,
      status: res.status ?? null,
      // Em erro, o campo `status` traz a descrição do que deu errado.
      errorMessage: code === "ERROR" || code === "EXPIRED" ? res.status ?? null : null,
    };
  }

  async publishContainer(igUserId: string, containerId: string, accessToken: string): Promise<string> {
    const res = await graph.post<{ id: string }>(`/${igUserId}/media_publish`, accessToken, {
      creation_id: containerId,
    });
    if (!res?.id) {
      throw new MetaApiError({ message: "Graph API não retornou id da mídia publicada", httpStatus: 502 });
    }
    return res.id;
  }

  async getPermalink(igMediaId: string, accessToken: string): Promise<string | null> {
    try {
      const res = await graph.get<{ permalink?: string }>(`/${igMediaId}`, accessToken, {
        fields: "permalink",
      });
      return res.permalink ?? null;
    } catch {
      // Permalink é cosmético: não vale derrubar uma publicação bem-sucedida.
      return null;
    }
  }

  async getInsights(
    igMediaId: string,
    accessToken: string,
    type: PostTypeName,
  ): Promise<MediaMetrics> {
    const wanted = METRICS_BY_TYPE[type] ?? FALLBACK_METRICS;

    const fetchMetrics = async (metrics: string[]) =>
      graph.get<InsightsResponse>(`/${igMediaId}/insights`, accessToken, {
        metric: metrics.join(","),
      });

    let res: InsightsResponse;
    try {
      res = await fetchMetrics(wanted);
    } catch (e) {
      if (e instanceof MetaApiError && e.classification === "permanent") {
        // Métrica renomeada/removida pela Meta: tenta o conjunto mínimo.
        try {
          res = await fetchMetrics(FALLBACK_METRICS);
        } catch {
          res = {};
        }
      } else {
        throw e;
      }
    }

    return {
      reach: readMetric(res, "reach"),
      views: readMetric(res, "views"),
      likes: readMetric(res, "likes"),
      comments: readMetric(res, "comments"),
      shares: readMetric(res, "shares"),
      saved: readMetric(res, "saved"),
      totalInteractions: readMetric(res, "total_interactions"),
      raw: res,
    };
  }
}
