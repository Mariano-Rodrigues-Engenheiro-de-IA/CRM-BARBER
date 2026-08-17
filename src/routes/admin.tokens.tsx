// /admin/tokens — mantido por compatibilidade (link antigo). O painel
// de verdade agora vive dentro de /admin (unificado, com abas).
import { createFileRoute } from "@tanstack/react-router";
import { AdminTokensPanel } from "@/components/admin/tokens-panel";

export const Route = createFileRoute("/admin/tokens")({
  head: () => ({
    meta: [
      { title: "Admin — Tokens de integração — CRM Zaylo" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Emissão de tokens de integração por barbearia." },
    ],
  }),
  component: () => (
    <main className="min-h-screen bg-neutral-100 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <AdminTokensPanel />
      </div>
    </main>
  ),
});
