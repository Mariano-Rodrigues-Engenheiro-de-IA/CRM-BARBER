// Painel de Conexão WhatsApp oficial (manual) — extraído de
// admin.whatsapp.tsx para ser reaproveitado dentro do painel admin
// unificado (com abas). Cole phone_number_id + access_token permanente
// (Usuário do Sistema) por barbearia e teste na hora.

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListShops,
  adminRegisterMetaNumber,
  adminSaveMetaCredentials,
  adminSetWhatsAppProvider,
  adminTestMetaConnection,
  adminListPendingMetaConnections,
  adminClaimPendingMetaConnection,
} from "@/lib/admin-whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCachedFetch } from "@/lib/api-cache";

type Row = Awaited<ReturnType<typeof adminListShops>>[number];
type PendingRow = Awaited<ReturnType<typeof adminListPendingMetaConnections>>[number];

export function AdminWhatsAppPanel() {
  const listShops = useServerFn(adminListShops);
  const saveCreds = useServerFn(adminSaveMetaCredentials);
  const testConn = useServerFn(adminTestMetaConnection);
  const registerNum = useServerFn(adminRegisterMetaNumber);
  const setProvider = useServerFn(adminSetWhatsAppProvider);
  const listPending = useServerFn(adminListPendingMetaConnections);
  const claimPending = useServerFn(adminClaimPendingMetaConnection);

  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "register" | "provider" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [claimTarget, setClaimTarget] = useState<Record<string, string>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const { data: rows, refetch: reload } = useCachedFetch<Row[]>("admin-whatsapp-shops", async () => {
    try {
      return await listShops();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  });

  const { data: pending, refetch: reloadPending } = useCachedFetch<PendingRow[]>("admin-pending-meta-connections", async () => {
    try {
      return await listPending();
    } catch {
      return [];
    }
  });

  async function handleClaim(pendingId: string) {
    const barbershopId = claimTarget[pendingId];
    if (!barbershopId) return;
    setClaimingId(pendingId);
    try {
      await claimPending({ data: { pending_id: pendingId, barbershop_id: barbershopId } });
      await reloadPending();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClaimingId(null);
    }
  }

  // Seleciona a primeira loja automaticamente assim que a lista chega —
  // só na ausência de seleção, pra não sobrescrever escolha do usuário.
  useEffect(() => {
    if (rows && rows.length > 0) setSelected((prev) => prev || rows[0].barbershop_id);
  }, [rows]);

  const current = rows?.find((r) => r.barbershop_id === selected) ?? null;

  useEffect(() => {
    setPhoneNumberId(current?.phone_number_id ?? "");
    setWabaId(current?.waba_id ?? "");
    setAccessToken("");
    setResult(null);
  }, [selected, current?.phone_number_id, current?.waba_id]);

  async function onSave() {
    if (!selected) return;
    setBusy("save");
    setResult(null);
    try {
      await saveCreds({
        data: {
          barbershop_id: selected,
          phone_number_id: phoneNumberId.trim(),
          access_token: accessToken.trim(),
          waba_id: wabaId.trim(),
        },
      });
      setResult({ ok: true, text: "Credenciais salvas. Agora clique em “Testar conexão”." });
      await reload();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(null);
  }

  async function onTest() {
    if (!selected) return;
    setBusy("test");
    setResult(null);
    try {
      const res = await testConn({ data: { barbershop_id: selected, test_phone: testPhone.trim() } });
      setResult({
        ok: res.ok,
        text: res.phone ? `${res.message} (número: +${res.phone})` : res.message,
      });
      await reload();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(null);
  }

  async function onRegister() {
    if (!selected) return;
    setBusy("register");
    setResult(null);
    try {
      const res = await registerNum({ data: { barbershop_id: selected, pin: pin.trim() } });
      setResult({ ok: res.ok, text: res.message });
      await reload();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(null);
  }

  async function onSetProvider(provider: "uazapi" | "meta") {
    if (!selected) return;
    setBusy("provider");
    setResult(null);
    try {
      await setProvider({ data: { barbershop_id: selected, provider } });
      setResult({
        ok: true,
        text: provider === "meta"
          ? "Modo API oficial ativado para esta barbearia. Salve/teste as credenciais abaixo."
          : "Modo QR/não oficial ativado para esta barbearia. A aba Conexão vai gerar QR code novamente.",
      });
      await reload();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(null);
  }



  return (
    <div className="space-y-6">
        <header>
          <p className="text-[10px] font-semibold tracking-[0.22em] text-neutral-500">ADMIN INTERNO</p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-950">Conexão WhatsApp oficial (manual)</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Cole o <code>phone_number_id</code> e o token permanente do Usuário do Sistema criado no
            Meta for Developers. Sem QR code e sem pop-up de login.
          </p>
        </header>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>
        )}

        {!!pending?.length && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-amber-900">
              Conexões pendentes de atribuir ({pending.length})
            </h2>
            <p className="mt-1 text-sm text-amber-800">
              Vieram do link de Integração Zero, a Meta não diz qual barbearia iniciou o vínculo, então
              confira pelo telefone/nome abaixo e escolhe a barbearia certa antes de reivindicar.
            </p>
            <div className="mt-4 space-y-3">
              {pending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-900">
                      {p.phone || "(sem telefone ainda)"}
                      {p.is_coexistence ? (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                          Coexistência
                        </span>
                      ) : (
                        <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
                          Migração completa
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-500">
                      waba {p.waba_id} · recebido {new Date(p.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <select
                    className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                    value={claimTarget[p.id] || ""}
                    onChange={(e) => setClaimTarget((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  >
                    <option value="">Escolha a barbearia…</option>
                    {(rows ?? []).map((r) => (
                      <option key={r.barbershop_id} value={r.barbershop_id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!claimTarget[p.id] || claimingId === p.id}
                    onClick={() => void handleClaim(p.id)}
                  >
                    {claimingId === p.id ? "Reivindicando…" : "Reivindicar"}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Barbearia
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          >
            {(rows ?? []).map((r) => (
              <option key={r.barbershop_id} value={r.barbershop_id}>
                {r.name}
              </option>
            ))}
          </select>

          {current && (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-neutral-600 sm:grid-cols-4">
              <Info label="Provider" value={current.provider ?? "—"} />
              <Info label="Status" value={current.status ?? "—"} />
              <Info label="Número" value={current.phone ? `+${current.phone}` : "—"} />
              <Info label="Token salvo" value={current.token_hint ?? "—"} />
            </dl>
          )}

          <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Modo desta barbearia</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant={current?.provider === "meta" ? "outline" : "default"}
                onClick={() => void onSetProvider("uazapi")}
                disabled={busy !== null || !selected}
                className={current?.provider === "meta" ? "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100" : "bg-neutral-900 text-white hover:bg-neutral-800"}
              >
                QR / não oficial
              </Button>
              <Button
                type="button"
                variant={current?.provider === "meta" ? "default" : "outline"}
                onClick={() => void onSetProvider("meta")}
                disabled={busy !== null || !selected}
                className={current?.provider === "meta" ? "bg-neutral-900 text-white hover:bg-neutral-800" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"}
              >
                API oficial / manual
              </Button>
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              Essa escolha é individual por barbearia. O sistema não usa mais um provider global para decidir o fluxo.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            <Field label="phone_number_id">
              <Input
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="1234567890123456"
                inputMode="numeric"
              />
            </Field>
            <Field label="access_token permanente (Usuário do Sistema)">
              <Input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={current?.token_hint ? "deixe vazio para manter o atual… (colar substitui)" : "EAAG..."}
                type="password"
                autoComplete="off"
              />
            </Field>
            <Field label="waba_id (opcional)">
              <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="opcional" />
            </Field>

            <Button
              type="button"
              onClick={() => void onSave()}
              disabled={busy !== null || !selected || !phoneNumberId.trim() || accessToken.trim().length < 20}
              className="bg-neutral-900 text-white hover:bg-neutral-800"
            >
              {busy === "save" ? "Salvando…" : "Salvar credenciais"}
            </Button>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-950">Registrar número na Cloud API</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Se o teste retornar <strong>(#133010) Account not registered</strong>, o número existe na conta,
            mas ainda não foi ativado para envio. Tente o registro por PIN abaixo; se a Meta responder
            <strong> “Register endpoint is not available for SMB businesses”</strong>, conclua o registro
            manualmente no Meta for Developers/WhatsApp Manager e volte apenas para testar.
          </p>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Para contas SMB, a Meta pode bloquear este endpoint. Nesse caso não adianta trocar o PIN:
            confirme o número, configure/verifique o PIN de duas etapas no WhatsApp Manager e garanta que
            o número apareça como pronto/ativo antes de testar o envio aqui.
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="PIN de 6 dígitos">
                <Input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                />
              </Field>
            </div>
            <Button
              type="button"
              onClick={() => void onRegister()}
              disabled={busy !== null || !selected || pin.trim().length !== 6}
              className="bg-neutral-900 text-white hover:bg-neutral-800"
            >
              {busy === "register" ? "Registrando…" : "Registrar número"}
            </Button>
          </div>
        </section>



        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-950">Testar conexão</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Confere o número na Cloud API. Se você informar um telefone, também envia uma mensagem de teste
            (esse número precisa ter iniciado conversa nas últimas 24h ou estar na lista de destinatários de teste).
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Telefone de teste com DDI (opcional)">
                <Input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="5511999999999"
                  inputMode="tel"
                />
              </Field>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void onTest()}
              disabled={busy !== null || !selected}
              className="border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            >
              {busy === "test" ? "Testando…" : "Testar conexão"}
            </Button>
          </div>

          {result && (
            <div
              className={`mt-4 rounded-lg border p-3 text-sm ${
                result.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              {result.text}
            </div>
          )}
        </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="text-sm text-neutral-800">{value}</dd>
    </div>
  );
}
