import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import "./globals.css";

// Corpo: Plus Jakarta Sans (legível, com personalidade). Títulos: Sora
// (geométrica, moderna) — self-hosted pelo next/font, sem flash nem shift.
const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
const display = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Publicador IG",
  description:
    "Agendamento e publicação em múltiplas contas profissionais do Instagram pela API oficial da Meta.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${body.variable} ${display.variable}`}>
      <body className="min-h-screen antialiased">
        <script
          // Aplica o tema salvo antes da primeira pintura, evitando o flash.
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tema');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
