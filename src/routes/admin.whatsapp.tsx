// /admin/whatsapp — tela interna (admin) de conexão manual do WhatsApp oficial.
//
// Sem QR, sem pop-up, sem callback: cole phone_number_id + access_token
// permanente (Usuário do Sistema) por barbearia e teste na hora.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListShops,
  adminRegisterMetaNumber,
  adminSaveMetaCredentials,
  adminTestMetaConnection,
} from "@/lib/admin-whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin/whatsapp")({
  head: () => ({
    meta: [
      { title: "Admin — Conexão WhatsApp oficial" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Configuração manual do número WhatsApp oficial de cada barbearia." },
      { property: "og:title", content: "Admin — Conexão WhatsApp oficial" },
      { property: "og:description", content: "Configuração manual do número WhatsApp oficial de cada barbearia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminWhatsApp,
});

type Row = Awaited<ReturnType<typeof adminListShops>>[number];

function AdminWhatsApp() {
  const listShops = useServerFn(adminListShops);
  const saveCreds = useServerFn(adminSaveMetaCredentials);
  const testConn = useServerFn(adminTestMetaConnection);
  const registerNum = useServerFn(adminRegisterMetaNumber);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "register" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    try {
      const data = await listShops();
      setRows(data);
      setSelected((prev) => prev || data[0]?.barbershop_id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
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

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Barbearia
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
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
    </main>
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
