// /admin/tokens — tela interna (admin) para emitir tokens de integração
// (usados por integrações externas, como a IA de atendimento, para
// chamar as APIs /api/public/ai/*). Alternativa ao console/curl manual —
// lista todas as barbearias e gera um token novo com um clique.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListShopsForTokens, adminIssueToken } from "@/lib/admin-tokens.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/tokens")({
  head: () => ({
    meta: [
      { title: "Admin — Tokens de integração — CRM Zaylo" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Emissão de tokens de integração por barbearia." },
    ],
  }),
  component: AdminTokens,
});

type Row = Awaited<ReturnType<typeof adminListShopsForTokens>>[number];

function AdminTokens() {
  const listShops = useServerFn(adminListShopsForTokens);
  const issueToken = useServerFn(adminIssueToken);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ barbershopId: string; barbershopName: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function reload() {
    try {
      const data = await listShops();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onIssue(barbershopId: string, barbershopName: string) {
    setBusyId(barbershopId);
    setIssued(null);
    setCopied(false);
    try {
      const res = await issueToken({ data: { barbershop_id: barbershopId } });
      setIssued({ barbershopId, barbershopName, token: res.token });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusyId(null);
  }

  function copyToken() {
    if (!issued) return;
    navigator.clipboard.writeText(issued.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header>
          <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">ADMIN INTERNO</p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-950">Tokens de integração</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Gera um token de acesso (o mesmo tipo usado pela extensão do Chrome) para uma barbearia — usado por
            integrações externas, como a IA de atendimento, para mover leads no funil. Gerar um token novo não afeta
            os tokens já existentes (da extensão instalada, por exemplo).
          </p>
        </header>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>
        )}

        {issued && (
          <section className="rounded-2xl border border-green-200 bg-green-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
              Token gerado para {issued.barbershopName}
            </p>
            <p className="mt-1 text-xs text-green-800">
              Copia agora — esse valor não aparece de novo em lugar nenhum depois que você sair dessa tela.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-green-300 bg-white px-3 py-2 text-xs text-neutral-900">
                {issued.token}
              </code>
              <Button type="button" onClick={copyToken} className="shrink-0 bg-neutral-900 text-white hover:bg-neutral-800">
                {copied ? "Copiado!" : "Copiar"}
              </Button>
            </div>
          </section>
        )}

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Barbearias</p>
          <div className="mt-3 divide-y divide-neutral-100">
            {(rows ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{r.name}</p>
                  <p className="text-xs text-neutral-500">
                    {r.active_tokens} token{r.active_tokens === 1 ? "" : "s"} ativo{r.active_tokens === 1 ? "" : "s"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId !== null}
                  onClick={() => void onIssue(r.id, r.name)}
                  className="border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                >
                  {busyId === r.id ? "Gerando…" : "Gerar token"}
                </Button>
              </div>
            ))}
            {rows === null && !error && <p className="py-4 text-sm text-neutral-500">Carregando…</p>}
            {rows?.length === 0 && <p className="py-4 text-sm text-neutral-500">Nenhuma barbearia cadastrada.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
