// /admin/clients — mantido por compatibilidade (link antigo). O painel
// de verdade agora vive dentro de /admin (unificado, com abas).
import { createFileRoute } from "@tanstack/react-router";
import { AdminClientsPanel } from "@/components/admin/clients-panel";

export const Route = createFileRoute("/admin/clients")({
  head: () => ({
    meta: [
      { title: "Admin | Clientes | CRM Zaylo" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Painel geral de clientes: contato, conexão e status." },
    ],
  }),
  component: () => (
    <div className="min-h-screen bg-neutral-100 p-6">
      <div className="mx-auto max-w-6xl">
        <AdminClientsPanel />
      </div>
    </div>
  ),
});
