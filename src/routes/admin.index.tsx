// /admin — painel admin unificado, com todas as áreas de gestão numa
// página só (navegação por abas), em vez de espalhadas em URLs
// diferentes. Sem login/senha próprio ainda (fica atrás da autenticação
// padrão do site, como as outras rotas /admin/*).

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AdminClientsPanel } from "@/components/admin/clients-panel";
import { AdminLessonsPanel } from "@/components/admin/lessons-panel";
import { AdminModulesPanel } from "@/components/admin/modules-panel";
import { AdminAgenteIaPanel } from "@/components/admin/agente-ia-panel";
import { AdminLeadsPanel } from "@/components/admin/leads-panel";
import { AdminTokensPanel } from "@/components/admin/tokens-panel";
import { AdminWhatsAppPanel } from "@/components/admin/whatsapp-panel";
import { adminListLeads, adminUpdateLeadStatus } from "@/lib/admin-leads.functions";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin — CRM Zaylo" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Painel administrativo unificado." },
    ],
  }),
  component: AdminHome,
});

type Tab = "clientes" | "modulos" | "aulas" | "agente-ia" | "interessados" | "tokens" | "whatsapp";

const TABS: { key: Tab; label: string }[] = [
  { key: "clientes", label: "Clientes" },
  { key: "interessados", label: "Clientes interessados" },
  { key: "modulos", label: "Módulos" },
  { key: "aulas", label: "Aulas" },
  { key: "agente-ia", label: "Vídeo Agente de IA" },
  { key: "tokens", label: "Tokens de integração" },
  { key: "whatsapp", label: "WhatsApp / Meta" },
];

function AdminHome() {
  const [tab, setTab] = useState<Tab>("clientes");
  const listLeads = useServerFn(adminListLeads);
  const updateLeadStatus = useServerFn(adminUpdateLeadStatus);

  return (
    <div className="flex min-h-screen bg-neutral-100">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white p-4">
        <p className="mb-4 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Admin</p>
        <nav className="space-y-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition " +
                (tab === t.key ? "bg-brand text-white" : "text-neutral-600 hover:bg-neutral-100")
              }
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-x-auto p-6">
        <div className="mx-auto max-w-6xl">
          {tab === "clientes" && <AdminClientsPanel />}
          {tab === "interessados" && (
            <AdminLeadsPanel
              listLeads={() => listLeads()}
              updateLeadStatus={async (id, status) => {
                await updateLeadStatus({ data: { id, status: status as any } });
              }}
            />
          )}
          {tab === "modulos" && <AdminModulesPanel />}
          {tab === "aulas" && <AdminLessonsPanel />}
          {tab === "agente-ia" && <AdminAgenteIaPanel />}
          {tab === "tokens" && <AdminTokensPanel />}
          {tab === "whatsapp" && <AdminWhatsAppPanel />}
        </div>
      </main>
    </div>
  );
}
