import { MetaApiError } from "./errors";
import type {
  ContainerStatus,
  ContainerStatusCode,
  CreateContainerInput,
  DiscoveredAccount,
  LongLivedToken,
  MediaMetrics,
  MetaCredentials,
  MetaDriver,
  PostTypeName,
  PublishingLimit,
} from "./types";

const GRAPH_HOST = "https://graph.instagram.com";
const OAUTH_HOST = "https://api.instagram.com";
const TIMEOUT_MS = 30_000;

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

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = (body as {
      error?: { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string };
      error_message?: string;
      error_type?: string;
    }) ?? {};
    throw new MetaApiError({
      // O endpoint de OAuth do Instagram usa error_message em vez de error.message.
      message: err.error?.message || err.error_message || `Instagram API respondeu ${res.status}`,
      code: err.error?.code ?? null,
      subcode: err.error?.error_subcode ?? null,
      type: err.error?.type ?? err.error_type ?? null,
      fbTraceId: err.error?.fbtrace_id ?? null,
      httpStatus: res.status,
      raw: body,
    });
  }
  return body as T;
}

/**
 * Driver do fluxo "Instagram API with Instagram Login".
 *
 * Diferenças que importam em relação ao fluxo do Facebook:
 * - a conta NÃO precisa de Página do Facebook vinculada;
 * - o host é graph.instagram.com e as permissões são `instagram_business_*`;
 * - uma autorização devolve UMA conta, não a lista de Páginas;
 * - o token de longa duração vale 60 dias e morre se não for renovado.
 */
export class InstagramLoginDriver implements MetaDriver {
  readonly name = "instagram" as const;

  constructor(private readonly creds: MetaCredentials) {}

  private async call<T>(
    method: "GET" | "POST",
    host: string,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") clean[k] = String(v);
    }

    const url = new URL(`${host}${path.startsWith("/") ? path : `/${path}`}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      if (method === "GET") {
        for (const [k, v] of Object.entries(clean)) url.searchParams.set(k, v);
        return await parse<T>(await fetch(url, { method: "GET", signal: controller.signal }));
      }
      return await parse<T>(
        await fetch(url, {
          method: "POST",
          body: new URLSearchParams(clean),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          signal: controller.signal,
        }),
      );
    } catch (e) {
      if (e instanceof MetaApiError) throw e;
      if (e instanceof Error && e.name === "AbortError") {
        throw new MetaApiError({
          message: `Timeout de ${TIMEOUT_MS}ms chamando ${path}`,
          httpStatus: 504,
          code: 1,
        });
      }
      throw new MetaApiError({
        message: e instanceof Error ? e.message : "Falha de rede na Instagram API",
        httpStatus: 503,
        code: 1,
        raw: e,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private graph<T>(
    path: string,
    accessToken: string,
    params: Record<string, string | number | boolean | undefined> = {},
    method: "GET" | "POST" = "GET",
  ) {
    return this.call<T>(method, GRAPH_HOST, path, { ...params, access_token: accessToken });
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
    const res = await this.call<{ access_token?: string; user_id?: number; permissions?: string }>(
      "POST",
      OAUTH_HOST,
      "/oauth/access_token",
      {
        client_id: this.creds.appId,
        client_secret: this.creds.appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      },
    );
    if (!res?.access_token) {
      throw new MetaApiError({ message: "OAuth do Instagram não devolveu access_token", httpStatus: 502 });
    }
    return res.access_token;
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedToken> {
    const res = await this.call<{ access_token: string; expires_in?: number }>(
      "GET",
      GRAPH_HOST,
      "/access_token",
      {
        grant_type: "ig_exchange_token",
        client_secret: this.creds.appSecret,
        access_token: shortLivedToken,
      },
    );
    return {
      accessToken: res.access_token,
      expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null,
    };
  }

  /**
   * Renova o token antes dos 60 dias.
   *
   * A Meta só renova token com mais de 24h de vida. Sem isso a conta para de
   * publicar sem aviso, e a pessoa precisa autorizar tudo de novo.
   */
  async refreshLongLivedToken(accessToken: string): Promise<LongLivedToken | null> {
    const res = await this.call<{ access_token: string; expires_in?: number }>(
      "GET",
      GRAPH_HOST,
      "/refresh_access_token",
      { grant_type: "ig_refresh_token", access_token: accessToken },
    );
    return {
      accessToken: res.access_token,
      expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null,
    };
  }

  /** Uma autorização corresponde a uma conta: não há lista de Páginas aqui. */
  async listInstagramAccounts(userAccessToken: string): Promise<DiscoveredAccount[]> {
    const me = await this.graph<{
      user_id?: string;
      id?: string;
      username?: string;
      account_type?: string;
      profile_picture_url?: string;
      followers_count?: number;
    }>("/me", userAccessToken, {
      fields: "user_id,username,account_type,profile_picture_url,followers_count",
    });

    const igUserId = me.user_id ?? me.id;
    if (!igUserId) {
      throw new MetaApiError({
        message: "Instagram não devolveu o id da conta autorizada",
        httpStatus: 502,
      });
    }

    return [
      {
        igUserId: String(igUserId),
        igUsername: me.username ?? String(igUserId),
        igAccountType: me.account_type ?? null,
        // Não existe Página neste fluxo.
        pageId: null,
        pageName: null,
        profilePicUrl: me.profile_picture_url ?? null,
        followersCount: me.followers_count ?? null,
        accessToken: userAccessToken,
      },
    ];
  }

  async getPublishingLimit(igUserId: string, accessToken: string): Promise<PublishingLimit> {
    const res = await this.graph<{
      data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>;
    }>(`/${igUserId}/content_publishing_limit`, accessToken, { fields: "config,quota_usage" });
    const row = res.data?.[0];
    return { quotaUsage: row?.quota_usage ?? 0, quotaTotal: row?.config?.quota_total ?? 50 };
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

    const res = await this.graph<{ id: string }>(
      `/${input.igUserId}/media`,
      input.accessToken,
      params,
      "POST",
    );
    if (!res?.id) {
      throw new MetaApiError({ message: "Instagram não retornou id do container", httpStatus: 502 });
    }
    return res.id;
  }

  async getContainerStatus(containerId: string, accessToken: string): Promise<ContainerStatus> {
    const res = await this.graph<{ status_code?: string; status?: string }>(
      `/${containerId}`,
      accessToken,
      { fields: "status_code,status" },
    );
    const code = (res.status_code ?? "IN_PROGRESS") as ContainerStatusCode;
    return {
      statusCode: code,
      status: res.status ?? null,
      errorMessage: code === "ERROR" || code === "EXPIRED" ? (res.status ?? null) : null,
    };
  }

  async publishContainer(
    igUserId: string,
    containerId: string,
    accessToken: string,
  ): Promise<string> {
    const res = await this.graph<{ id: string }>(
      `/${igUserId}/media_publish`,
      accessToken,
      { creation_id: containerId },
      "POST",
    );
    if (!res?.id) {
      throw new MetaApiError({ message: "Instagram não retornou id da mídia publicada", httpStatus: 502 });
    }
    return res.id;
  }

  async getPermalink(igMediaId: string, accessToken: string): Promise<string | null> {
    try {
      const res = await this.graph<{ permalink?: string }>(`/${igMediaId}`, accessToken, {
        fields: "permalink",
      });
      return res.permalink ?? null;
    } catch {
      return null;
    }
  }

  async getInsights(
    igMediaId: string,
    accessToken: string,
    type: PostTypeName,
  ): Promise<MediaMetrics> {
    const wanted = METRICS_BY_TYPE[type] ?? FALLBACK_METRICS;
    const fetchMetrics = (metrics: string[]) =>
      this.graph<InsightsResponse>(`/${igMediaId}/insights`, accessToken, {
        metric: metrics.join(","),
      });

    let res: InsightsResponse;
    try {
      res = await fetchMetrics(wanted);
    } catch (e) {
      if (e instanceof MetaApiError && e.classification === "permanent") {
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
