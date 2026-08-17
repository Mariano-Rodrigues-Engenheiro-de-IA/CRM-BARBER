// /admin/whatsapp — mantido por compatibilidade (link antigo). O painel
// de verdade agora vive dentro de /admin (unificado, com abas).
import { createFileRoute } from "@tanstack/react-router";
import { AdminWhatsAppPanel } from "@/components/admin/whatsapp-panel";

export const Route = createFileRoute("/admin/whatsapp")({
  head: () => ({
    meta: [
      { title: "Admin — Conexão WhatsApp oficial — CRM Zaylo" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Configuração manual do número WhatsApp oficial de cada barbearia." },
    ],
  }),
  component: () => (
    <main className="min-h-screen bg-neutral-100 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <AdminWhatsAppPanel />
      </div>
    </main>
  ),
});
