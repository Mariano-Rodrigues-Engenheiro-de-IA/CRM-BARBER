// /admin/lessons — mantido por compatibilidade (link antigo). O painel
// de verdade agora vive dentro de /admin (unificado, com abas).
import { createFileRoute } from "@tanstack/react-router";
import { AdminLessonsPanel } from "@/components/admin/lessons-panel";

export const Route = createFileRoute("/admin/lessons")({
  head: () => ({
    meta: [
      { title: "Admin — Aulas — CRM Zaylo" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Gestão da área de Aulas (academy) para os clientes." },
    ],
  }),
  component: () => (
    <div className="min-h-screen bg-neutral-100 p-6">
      <div className="mx-auto max-w-4xl">
        <AdminLessonsPanel />
      </div>
    </div>
  ),
});
