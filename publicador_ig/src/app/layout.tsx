import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Publicador IG",
  description:
    "Agendamento e publicação em múltiplas contas profissionais do Instagram pela API oficial da Meta.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
