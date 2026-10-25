export type PostTypeName = "REEL" | "IMAGE" | "CAROUSEL" | "STORY";

export interface DiscoveredAccount {
  igUserId: string;
  igUsername: string;
  igAccountType: string | null;
  pageId: string | null;
  pageName: string | null;
  profilePicUrl: string | null;
  followersCount: number | null;
  /** Token de página de longa duração, usado nas publicações desta conta. */
  accessToken: string;
}

export interface LongLivedToken {
  accessToken: string;
  expiresAt: Date | null;
}

export interface PublishingLimit {
  quotaUsage: number;
  quotaTotal: number;
}

export type ContainerStatusCode =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

export interface ContainerStatus {
  statusCode: ContainerStatusCode;
  status: string | null;
  errorMessage: string | null;
}

export interface CreateContainerInput {
  igUserId: string;
  accessToken: string;
  type: PostTypeName;
  caption?: string;
  /** URL publica da mídia. A Meta baixa o arquivo deste endereço. */
  imageUrl?: string;
  videoUrl?: string;
  /** Reels */
  shareToFeed?: boolean;
  coverUrl?: string;
  thumbOffsetMs?: number;
  audioName?: string;
  /** Carrossel */
  isCarouselItem?: boolean;
  children?: string[];
}

export interface MediaMetrics {
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  totalInteractions: number | null;
  raw: unknown;
}

/**
 * Tudo que a plataforma precisa da Meta. O driver mock implementa a mesma
 * interface, para dar pra rodar e testar o produto inteiro sem bater na API.
 */
export interface MetaDriver {
  readonly name: "graph" | "mock";
  /** Troca o `code` do OAuth pelo token de usuário de curta duração. */
  exchangeCodeForToken(code: string, redirectUri: string): Promise<string>;
  exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedToken>;
  listInstagramAccounts(userAccessToken: string): Promise<DiscoveredAccount[]>;
  getPublishingLimit(igUserId: string, accessToken: string): Promise<PublishingLimit>;
  createContainer(input: CreateContainerInput): Promise<string>;
  getContainerStatus(containerId: string, accessToken: string): Promise<ContainerStatus>;
  publishContainer(igUserId: string, containerId: string, accessToken: string): Promise<string>;
  getPermalink(igMediaId: string, accessToken: string): Promise<string | null>;
  getInsights(igMediaId: string, accessToken: string, type: PostTypeName): Promise<MediaMetrics>;
}
