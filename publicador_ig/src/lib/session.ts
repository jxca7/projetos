import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./prisma";
import type { Role } from "@/generated/prisma/enums";

export interface CurrentContext {
  userId: string;
  userName: string | null;
  userEmail: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  timezone: string;
  role: Role;
}

/**
 * Contexto da requisicao: usuário logado e workspace ativo.
 *
 * Todo acesso a dados passa por aqui e filtra por workspaceId. Nenhuma query
 * do painel busca por id sem amarrar ao workspace do usuário.
 */
export async function requireContext(): Promise<CurrentContext> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { userId },
    include: { workspace: true, user: true },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) redirect("/onboarding");

  return {
    userId,
    userName: membership.user.name,
    userEmail: membership.user.email,
    workspaceId: membership.workspaceId,
    workspaceName: membership.workspace.name,
    workspaceSlug: membership.workspace.slug,
    timezone: membership.workspace.timezone,
    role: membership.role,
  };
}

export function canEdit(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "EDITOR";
}

export function canManageAccounts(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}
