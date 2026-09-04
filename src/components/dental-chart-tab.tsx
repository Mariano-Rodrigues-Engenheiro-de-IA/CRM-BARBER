// Aba "Odontograma" — só aparece pra contas com business_type =
// "odontologia" (checado por quem usa esse componente, não aqui).
// Embrulha a biblioteca react-advanced-odontogram: ela cuida do desenho
// da arcada e da interação; a gente só entra/sai com o JSON salvo por
// paciente (getStatusChart()/importStatus()).
//
// Atenção: o motor da biblioteca é um singleton por página (só uma
// instância por vez) — por isso o cuidado de destruir ao desmontar e
// re-hidratar sempre que o paciente muda.

import { useEffect, useRef, useState } from "react";
import { OdontogramShell, initOdontogram, destroyOdontogram, getStatusChart, importStatus } from "react-advanced-odontogram";
import "react-advanced-odontogram/style.css";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

export function DentalChartTab({ api, customerId }: { api: ApiFn; customerId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        // Idempotente — seguro chamar de novo mesmo se o componente já
        // inicializou o motor numa montagem anterior.
        await initOdontogram();
        const res = await api(`/api/public/extension/dental-chart?customer_id=${encodeURIComponent(customerId)}`);
        if (!mountedRef.current) return;
        if (res?.ok && res.chart_data) {
          importStatus(res.chart_data);
        }
      } catch (e) {
        if (mountedRef.current) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
    return () => {
      mountedRef.current = false;
      destroyOdontogram();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    setSavedJustNow(false);
    try {
      const chart_data = getStatusChart();
      const res = await api("/api/public/extension/dental-chart", {
        method: "PUT",
        body: JSON.stringify({ customer_id: customerId, chart_data }),
      });
      if (res?.ok) {
        setSavedJustNow(true);
        setTimeout(() => setSavedJustNow(false), 2500);
      } else {
        setErr(res?.error || "Não consegui salvar agora.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {loading ? "Carregando odontograma..." : "Marque um dente pra registrar um procedimento."}
        </p>
        <div className="flex items-center gap-2">
          {savedJustNow && <span className="text-xs font-medium text-emerald-600">Salvo</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar odontograma"}
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-neutral-400">Carregando...</div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-2">
          <OdontogramShell language="pt-br" numberingSystem="FDI" darkMode={false} />
        </div>
      )}
    </div>
  );
}
