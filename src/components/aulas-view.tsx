import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { youtubeThumbnail, youtubeEmbedUrl } from "@/lib/youtube";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type Lesson = {
  id: string;
  title: string;
  youtube_url: string;
  description: string | null;
  featured: boolean;
  sort_order: number;
};

/** Área de Treinamento — estilo "academy"/área de membros:
 * 1) Banner grande no topo — SÓ decorativo (não é clicável, não abre
 *    nenhum vídeo), com a arte enviada pelo Mariano (robô de IA +
 *    celular com WhatsApp) e o texto de boas-vindas por cima.
 * 2) Logo abaixo, a lista de aulas de verdade — é ali que a pessoa
 *    clica pra assistir. A primeira aula ganha um destaque visual
 *    sutil (selo "Comece aqui"), mas faz parte da mesma grade, sem
 *    virar um bloco gigante separado. */
export function AulasView({ api }: { api: Api }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [playing, setPlaying] = useState<Lesson | null>(null);
  const [bannerLoaded, setBannerLoaded] = useState(false);

  useEffect(() => {
    api("/api/public/extension/lessons").then((r) => {
      if (r?.ok) setLessons(r.lessons);
    });
    // Pré-carrega a imagem do banner ANTES de mostrar o texto por cima —
    // sem isso, o nome/frase apareciam de imediato enquanto a imagem
    // ainda estava baixando, dando impressão de bug.
    const img = new Image();
    img.src = "/academy/banner.jpg";
    img.onload = () => setBannerLoaded(true);
    img.onerror = () => setBannerLoaded(true); // não trava a tela pra sempre se a imagem falhar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = (lessons ?? []).slice().sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.sort_order - b.sort_order;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Banner decorativo — não clicável. Imagem e texto aparecem juntos,
          só depois que a imagem termina de carregar (evita o "pisca"). */}
      <div
        className="relative min-h-[220px] overflow-hidden rounded-2xl bg-neutral-900 transition-opacity duration-300 md:min-h-[280px]"
        style={{
          opacity: bannerLoaded ? 1 : 0,
          backgroundImage: bannerLoaded ? "url(/academy/banner.jpg)" : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="flex min-h-[220px] flex-col justify-center px-6 py-10 md:min-h-[280px] md:px-12">
          <h1 className="max-w-md text-3xl font-bold text-white md:text-5xl">Bem-vindo(a)!</h1>
          <p className="mt-2 max-w-sm text-sm text-neutral-200 md:text-base">
            Aulas práticas pra você tirar o máximo proveito do sistema. Comece pela primeira e siga no seu ritmo.
          </p>
        </div>
      </div>

      {/* Lista de aulas — aqui sim é clicável */}
      <div>
        {!lessons ? (
          <p className="text-sm text-neutral-500">Carregando...</p>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center">
            <p className="text-sm text-neutral-400">Nenhuma aula disponível ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((l, idx) => {
              const isFirst = idx === 0;
              return (
                <button
                  key={l.id}
                  onClick={() => setPlaying(l)}
                  className={
                    "group overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:shadow-md " +
                    (isFirst ? "border-brand ring-1 ring-brand/30" : "border-neutral-200")
                  }
                >
                  <div className="relative">
                    <img src={youtubeThumbnail(l.youtube_url) ?? undefined} alt="" className="h-40 w-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 opacity-0 shadow transition group-hover:opacity-100">
                        <PlayIcon />
                      </div>
                    </div>
                    {isFirst && (
                      <span className="absolute left-2 top-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Comece aqui
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 text-sm font-semibold text-neutral-900">{l.title}</p>
                    {l.description && <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{l.description}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!playing} onOpenChange={(v) => !v && setPlaying(null)}>
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          {playing && (
            <div className="aspect-video w-full">
              <iframe
                src={youtubeEmbedUrl(playing.youtube_url) ?? undefined}
                title={playing.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M8 5v14l11-7-11-7Z" />
    </svg>
  );
}
