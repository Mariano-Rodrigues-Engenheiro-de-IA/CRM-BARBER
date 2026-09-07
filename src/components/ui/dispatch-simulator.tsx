import { useEffect, useState } from "react";

// Simula uma campanha de disparo em massa: uma lista de contatos vai
// ganhando o check de "enviado" um a um, com uma barra de progresso
// subindo junto. Reinicia sozinho em loop, igual o celular com a IA.
const CONTATOS_SIMULADOS = [
  "Camila Ferreira",
  "João Pedro Alves",
  "Beatriz Lima",
  "Rafael Costa",
  "Larissa Souza",
  "Thiago Martins",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function DispatchSimulator() {
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      while (!cancelled) {
        setSentCount(0);
        await sleep(900);
        for (let i = 1; i <= CONTATOS_SIMULADOS.length; i++) {
          if (cancelled) return;
          setSentCount(i);
          await sleep(550);
        }
        await sleep(2600);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = CONTATOS_SIMULADOS.length;
  const percent = Math.round((sentCount / total) * 100);
  const done = sentCount >= total;

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Campanha: Reativação de pacientes</p>
        <span
          className={
            "rounded-full px-2.5 py-1 text-[11px] font-semibold " +
            (done ? "bg-emerald-100 text-emerald-700" : "bg-[#2f6df6]/10 text-[#2f6df6]")
          }
        >
          {done ? "Concluído" : "Enviando…"}
        </span>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[#2f6df6] transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {sentCount} de {total} contatos
      </p>

      <ul className="mt-4 space-y-2">
        {CONTATOS_SIMULADOS.map((nome, i) => {
          const sent = i < sentCount;
          return (
            <li
              key={nome}
              className={
                "flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors duration-300 " +
                (sent ? "border-emerald-200 bg-emerald-50/60 text-slate-700" : "border-slate-100 bg-slate-50 text-slate-400")
              }
            >
              <span>{nome}</span>
              {sent ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <svg viewBox="0 0 16 11" className="h-3 w-3.5 fill-current">
                    <path d="M11.045.585 11.988 1.528 5.858 7.658 2.558 4.358 3.502 3.415 5.858 5.772 11.045.585Z" />
                  </svg>
                  Enviado
                </span>
              ) : (
                <span className="text-xs text-slate-400">na fila</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
