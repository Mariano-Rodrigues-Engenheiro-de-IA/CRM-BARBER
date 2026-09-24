// Abas de "Assinaturas" (visão geral com meta/planos) e "Configurações
// gerais" (nome/logo da barbearia) do painel. Extraído de painel.tsx pra
// reduzir o tamanho desse arquivo (era um dos 3 arquivos gigantes
// apontados na varredura de código morto/arquitetura).

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatBRL,
  mergeDetectedPlans,
  priceOf,
  readGoal,
  readPlans,
  writeGoal,
  writePlans,
  normalizePlanName,
  type Plan,
} from "@/lib/shop-settings";
import {
  SUBSCRIPTION_SYSTEMS,
  planFromTags,
  type SubscriptionSystemId,
} from "@/lib/subscription-systems";
import { inputCls } from "@/components/painel-kanban";
import { type Customer, type Brand, readSystem, writeSystem } from "@/routes/painel";

/** Configurações da assinatura (sistema, planos e meta) — abre pela engrenagem. */
/**
 * Visão geral das assinaturas: gamificação da meta + configurações
 * (sistema, planos e meta). Antes era um modal; virou sub-aba.
 */
export function OverviewView({ customers, shopId }: { customers: Customer[]; shopId: string }) {
  const [system, setSystem] = useState<SubscriptionSystemId | "">(() => readSystem(shopId) ?? "");
  const [plans, setPlans] = useState<Plan[]>(() => readPlans(shopId));
  const [newPlan, setNewPlan] = useState("");
  const [goal, setGoal] = useState<number>(() => readGoal(shopId));

  const actives = customers.filter((c) => c.status === "active" || c.status === "due_soon");
  const totalSubs = actives.length;
  const missing = Math.max(0, goal - totalSubs);
  const pct = goal > 0 ? Math.min(100, Math.round((totalSubs / goal) * 100)) : 0;
  const mrr = actives.reduce((sum, c) => sum + priceOf(plans, planFromTags(c.tags)), 0);

  function saveSystem(id: SubscriptionSystemId) {
    setSystem(id);
    writeSystem(shopId, id);
  }

  function persistPlans(next: Plan[]) {
    setPlans(next);
    writePlans(shopId, next);
  }

  function addPlan() {
    const name = newPlan.trim();
    if (!name) return;
    if (plans.some((p) => normalizePlanName(p.name) === normalizePlanName(name))) {
      setNewPlan("");
      return;
    }
    persistPlans([...plans, { name, priceCents: 0 }]);
    setNewPlan("");
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {/* Meta do mês — o número de assinantes é o herói do card */}
      <div className="rounded-xl border border-neutral-300 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Assinantes ativos
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold leading-none tracking-tight text-neutral-950">
                {totalSubs}
              </span>
              {goal > 0 && (
                <span className="text-4xl font-semibold leading-none tracking-tight text-neutral-400">
                  / {goal}
                </span>
              )}
            </div>

            <p className="mt-2 text-sm font-medium text-neutral-600">
              {goal > 0
                ? missing > 0
                  ? `Faltam ${missing} para bater a meta`
                  : "Meta do mês batida 🎉"
                : "Defina uma meta do mês abaixo"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-400">
              Receita recorrente
            </p>
            <p className="text-base font-semibold text-neutral-600">{formatBRL(mrr)}</p>
          </div>
        </div>
        <div className="mt-5">
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-yellow-400 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-right text-xs font-semibold text-neutral-500">{pct}%</p>
        </div>
      </div>

      <div className="space-y-5 rounded-xl border border-neutral-300 bg-white p-5 shadow-sm">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Sistema
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUBSCRIPTION_SYSTEMS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => saveSystem(s.id)}
                className={
                  "rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition " +
                  (system === s.id
                    ? "border-brand bg-brand text-white"
                    : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Planos e valores
          </h3>
          {plans.length === 0 && <p className="text-xs text-neutral-400">Nenhum plano ainda.</p>}
          {plans.map((p, i) => (
            <div key={p.name + i} className="flex items-center gap-2">
              <input
                value={p.name}
                onChange={(e) => {
                  const next = [...plans];
                  next[i] = { ...next[i], name: e.target.value };
                  setPlans(next);
                }}
                onBlur={() => persistPlans(plans)}
                className={inputCls}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={p.priceCents ? (p.priceCents / 100).toString() : ""}
                placeholder="0,00"
                onChange={(e) => {
                  const next = [...plans];
                  next[i] = {
                    ...next[i],
                    priceCents: Math.round(Number(e.target.value || 0) * 100),
                  };
                  setPlans(next);
                }}
                onBlur={() => persistPlans(plans)}
                className={inputCls + " w-28"}
              />
              <button
                type="button"
                onClick={() => persistPlans(plans.filter((_, j) => j !== i))}
                className="rounded p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                title="Remover plano"
              >
                🗑
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={newPlan}
              onChange={(e) => setNewPlan(e.target.value)}
              placeholder="Novo plano"
              className={inputCls}
            />
            <button
              type="button"
              onClick={addPlan}
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
            >
              Adicionar
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Meta do mês
          </h3>
          <input
            type="number"
            min={0}
            value={goal || ""}
            placeholder="Ex.: 200"
            onChange={(e) => setGoal(Number(e.target.value || 0))}
            onBlur={() => writeGoal(shopId, goal)}
            className={inputCls + " max-w-40"}
          />
        </div>

        <button
          onClick={() => {
            writeGoal(shopId, goal);
            persistPlans(plans);
          }}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

export function SettingsView({
  brand,
  fallbackName,
  onSave,
}: {
  brand: Brand;
  fallbackName: string;
  onSave: (b: Brand) => void;
  shopId: string;
}) {
  const [name, setName] = useState(brand.name || fallbackName || "");
  const [logo, setLogo] = useState(brand.logo || "");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function pickLogo(file: File) {
    if (file.size > 400_000) {
      toast.error("Logo muito grande. Use uma imagem até 400KB.");
      return;
    }
    const dataUrl: string = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(file);
    });
    setLogo(dataUrl);
  }

  function save() {
    onSave({ name: name.trim() || undefined, logo: logo || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const initial = (name || "B").trim().charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold text-neutral-900">Configurações</h1>

      <div className="rounded-xl border border-neutral-300 bg-white p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-neutral-800 text-2xl font-semibold text-white shadow-sm">
            {logo ? <img src={logo} alt="logo" className="h-full w-full object-cover" /> : initial}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              {logo ? "Trocar logo" : "Enviar logo"}
            </button>
            {logo && (
              <button
                type="button"
                onClick={() => setLogo("")}
                className="text-xs text-neutral-500 hover:text-red-600"
              >
                remover logo
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickLogo(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Nome da barbearia
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Barbearia do João"
            className={inputCls}
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Salvar
          </button>
          {saved && <span className="text-xs font-medium text-emerald-600">Salvo ✔</span>}
        </div>
      </div>
    </div>
  );
}

