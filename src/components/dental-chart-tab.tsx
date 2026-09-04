// Aba "Odontograma" — só aparece pra contas com business_type =
// "odontologia" (checado por quem usa esse componente, não aqui).
// Embrulha a biblioteca react-advanced-odontogram: ela cuida do desenho
// da arcada e da interação; a gente só entra/sai com o JSON salvo por
// paciente (getStatusChart()/importStatus()).
//
// Duas coisas importantes de acerto de ordem:
// 1. O motor da biblioteca lê/escreve DOM de verdade (não é só React) —
//    precisa que <OdontogramShell/> já esteja montado na tela ANTES de
//    chamar initOdontogram()/importStatus(), senão ela procura elementos
//    que ainda não existem e quebra. Por isso o shell é sempre
//    renderizado (nunca escondido atrás de "carregando"), só com um véu
//    por cima enquanto os dados ainda não chegaram.
// 2. É um singleton por página (só uma instância por vez) — por isso o
//    cuidado de destruir ao desmontar e re-hidratar sempre que o
//    paciente muda.
//
// Tudo embrulhado num Error Boundary: essa é uma biblioteca de
// terceiros, e um erro dela sem essa proteção derruba a árvore inteira
// do React (o menu lateral inclusive) — já aconteceu.

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { OdontogramShell, initOdontogram, destroyOdontogram, getStatusChart, importStatus } from "react-advanced-odontogram";
import "react-advanced-odontogram/style.css";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

class OdontogramErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          O odontograma travou nessa tela. Fecha e abre esse paciente de novo. Se continuar acontecendo,
          me avisa.
        </div>
      );
    }
    return this.props.children;
  }
}

function DentalChartInner({
  api,
  customerId,
  clinicName,
  clinicLogo,
}: {
  api: ApiFn;
  customerId: string;
  clinicName?: string;
  clinicLogo?: string;
}) {
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const mountedRef = useRef(true);

  const chartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    setReady(false);
    setErr(null);
    (async () => {
      try {
        // Roda depois do <OdontogramShell/> já estar montado na tela
        // (efeito do componente PAI só dispara depois dos efeitos dos
        // filhos, ordem garantida pelo próprio React) — idempotente,
        // seguro chamar de novo mesmo se já tinha inicializado antes.
        await initOdontogram();
        const res = await api(`/api/public/extension/dental-chart?customer_id=${encodeURIComponent(customerId)}`);
        if (!mountedRef.current) return;
        if (res?.ok && res.chart_data) {
          importStatus(res.chart_data);
        }
      } catch (e) {
        if (mountedRef.current) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (mountedRef.current) setReady(true);
      }
    })();
    return () => {
      mountedRef.current = false;
      destroyOdontogram();
      // Rede de segurança: a biblioteca cria modais/popups direto no
      // <body> (fora da árvore que o React controla), pra sobrepor a
      // tela toda. Se destroyOdontogram() não limpar um deles a tempo
      // (troca rápida de paciente, por exemplo), sobra um overlay
      // "fantasma" cobrindo tudo — dá exatamente a impressão de menu
      // sumido, quando na real só está por baixo de algo invisível.
      // Remove qualquer resto identificável dela, sem mexer em nada
      // nosso (nenhuma classe nossa começa com "odon-").
      document.querySelectorAll('[class*="odon-"][class*="backdrop"], [class*="odon-"][class*="overlay"]').forEach((el) => el.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // Troca pontual: título "React Advanced Odontogram" vira o nome da
  // clínica, ícone da biblioteca vira a logo da clínica (se tiver uma
  // configurada), subtítulo de configuração some, e 3 dos 6 botõezinhos
  // da barra de ferramentas (idioma, modo escuro, importar) somem —
  // mantém tour, configurações e exportar. Só mexe nesses pontos
  // específicos, por texto/posição exata — nada de classe genérica.
  useEffect(() => {
    const container = chartWrapRef.current;
    if (!container) return;
    const titleText = "React Advanced Odontogram";
    const titleReplacement = clinicName?.trim() || "Odontograma";
    const subtitlePrefix = "Em português. Usando a numeração FDI";
    let observer: MutationObserver | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Título e barra de ferramentas só precisam ser achados/trocados
    // UMA vez — depois disso, não tem mais nada pra esses dois vigiar.
    // Sem essa checagem, o observer continuava disparando (e varrendo a
    // tela inteira de novo) a cada clique num dente ou qualquer
    // interação — foi isso que deixou o sistema lento depois dessas
    // trocas, é bastante trabalho repetido à toa.
    function isFullyPatched() {
      return (
        !!container?.querySelector('[data-crm-title="1"]') &&
        !!container?.querySelector('[data-crm-toolbar-patched="1"]') &&
        // Se não tem logo pra trocar, essa parte não conta — só exige
        // que a logo já tenha sido trocada quando tem uma configurada.
        (!clinicLogo || !!container?.querySelector('[data-crm-logo-img="1"]'))
      );
    }

    function patch() {
      if (!container) return;
      if (isFullyPatched()) {
        observer?.disconnect();
        return;
      }
      let titleEl: HTMLElement | null = container.querySelector('[data-crm-title="1"]');
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        const el = node as HTMLElement;
        const text = el.children.length === 0 ? el.textContent?.trim() : null;
        if (text === titleText) {
          el.textContent = titleReplacement;
          el.setAttribute("data-crm-title", "1");
          titleEl = el;
        } else if (text?.startsWith(subtitlePrefix)) {
          el.style.display = "none";
        }
        node = walker.nextNode();
      }

      // Logo: procura só dentro do PAI do título (não o container
      // inteiro) — assim não confunde com os ícones da barra de
      // ferramentas, que ficam numa parte separada da tela.
      console.info(
        "[CRM odontograma] clinicLogo recebido nessa passagem:",
        clinicLogo ? `preenchido (${clinicLogo.slice(0, 40)}...)` : "vazio/undefined",
        ". título já achado?",
        !!titleEl,
      );
      if (clinicLogo && titleEl && !container.querySelector('[data-crm-logo-img="1"]')) {
        const scope = titleEl.parentElement?.parentElement ?? titleEl.parentElement;
        const logoSvg = scope?.querySelector("svg");
        console.info("[CRM odontograma] tentando trocar logo. scope achado?", !!scope, "svg achado dentro do scope?", !!logoSvg);
        if (logoSvg) {
          logoSvg.style.display = "none";
          const img = document.createElement("img");
          img.src = clinicLogo;
          img.setAttribute("data-crm-logo-img", "1");
          img.style.width = "28px";
          img.style.height = "28px";
          img.style.objectFit = "contain";
          img.style.borderRadius = "6px";
          logoSvg.parentElement?.insertBefore(img, logoSvg);
          console.info("[CRM odontograma] logo trocada com sucesso.");
        }
      }

      // Barra de ferramentas: busca cada botão pelo texto exato do
      // rótulo dele (title ou aria-label) — confirmado funcionando.
      if (!container.querySelector('[data-crm-toolbar-patched="1"]')) {
        const iconButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.querySelector("svg"));
        const labelsToHide = ["Idioma", "Modo escuro", "Importar"];
        let hiddenCount = 0;
        for (const b of iconButtons) {
          const label = (b.getAttribute("title") || b.getAttribute("aria-label") || "").trim();
          if (labelsToHide.includes(label)) {
            b.style.display = "none";
            hiddenCount++;
          }
        }
        if (hiddenCount > 0) {
          container.querySelector("button")?.setAttribute("data-crm-toolbar-patched", "1");
        }
      }

      if (isFullyPatched()) observer?.disconnect();
    }

    // Atraso proposital: durante o carregamento, a biblioteca dispara
    // várias mutações seguidas em rajada (montando a tela toda) — sem
    // esse agrupamento, cada uma delas disparava uma varredura completa
    // na hora, multiplicando o trabalho bem na parte mais pesada (a
    // abertura do odontograma). Agrupa tudo numa só, 150ms depois da
    // última mutação da rajada.
    function scheduleDebouncedPatch() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(patch, 150);
    }

    patch();
    if (!isFullyPatched()) {
      observer = new MutationObserver(scheduleDebouncedPatch);
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    }
    // Rede de segurança final: desliga sozinho depois de 10s, não
    // importa o que aconteceu — título/barra de ferramentas devem
    // aparecer bem mais rápido que isso normalmente; se por algum
    // motivo nunca forem encontrados, é melhor desistir de vigiar do
    // que ficar rodando pra sempre e pesando o resto da navegação.
    const giveUpTimer = setTimeout(() => observer?.disconnect(), 10_000);
    return () => {
      observer?.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      clearTimeout(giveUpTimer);
    };
  }, [clinicName, clinicLogo]);

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
          {ready ? "Marque um dente pra registrar um procedimento." : "Carregando odontograma..."}
        </p>
        <div className="flex items-center gap-2">
          {savedJustNow && <span className="text-xs font-medium text-emerald-600">Salvo</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !ready}
            className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar odontograma"}
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

      <div ref={chartWrapRef} className="relative overflow-x-auto rounded-xl border border-neutral-200 bg-white p-2">
        {!ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-neutral-400">
            Carregando...
          </div>
        )}
        <OdontogramShell language="pt-br" numberingSystem="FDI" darkMode={false} />
      </div>
    </div>
  );
}

export function DentalChartTab(props: { api: ApiFn; customerId: string; clinicName?: string; clinicLogo?: string }) {
  return (
    <OdontogramErrorBoundary>
      <DentalChartInner {...props} />
    </OdontogramErrorBoundary>
  );
}
