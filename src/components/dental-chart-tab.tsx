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

    function patch() {
      if (!container) return;
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
      if (clinicLogo && titleEl && !container.querySelector('[data-crm-logo-img="1"]')) {
        const scope = titleEl.parentElement?.parentElement ?? titleEl.parentElement;
        const logoSvg = scope?.querySelector("svg");
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
        }
      }

      // Barra de ferramentas: fileira de botõezinhos com um <svg> cada
      // (tour, idioma, modo escuro, configurações, exportar, importar,
      // nessa ordem, confirmado pelo print do Mariano). Some com o 2º
      // (idioma), 3º (modo escuro) e 6º (importar) — mantém o resto.
      if (!container.querySelector('[data-crm-toolbar-patched="1"]')) {
        const iconButtons = Array.from(container.querySelectorAll("button")).filter(
          (b) => b.querySelector("svg") && b.children.length === 1,
        );
        // Agrupa por proximidade: pega a maior sequência de botões-ícone
        // que são irmãos diretos (mesmo pai) — essa é a barra de
        // ferramentas de verdade, não um botão-ícone avulso em outro
        // canto da tela.
        const byParent = new Map<Element, HTMLButtonElement[]>();
        for (const b of iconButtons) {
          if (!b.parentElement) continue;
          const list = byParent.get(b.parentElement) ?? [];
          list.push(b);
          byParent.set(b.parentElement, list);
        }
        let toolbar: HTMLButtonElement[] | null = null;
        for (const list of byParent.values()) {
          // Restrito a 5-8 — a barra de ferramentas tem 6 botões (visto
          // no print). Sem esse teto, um grupo bem maior (os próprios
          // dentes do desenho, se também forem <button> com um <svg>
          // dentro) podia "ganhar" por ser o maior grupo, e a gente
          // acabava escondendo dente de verdade em vez do botãozinho.
          if (list.length >= 5 && list.length <= 8) toolbar = list;
        }
        if (toolbar && toolbar.length >= 6) {
          toolbar[1].style.display = "none"; // idioma
          toolbar[2].style.display = "none"; // modo escuro
          toolbar[5].style.display = "none"; // importar
          toolbar[0].setAttribute("data-crm-toolbar-patched", "1");
        }
      }
    }

    patch();
    const observer = new MutationObserver(patch);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
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
