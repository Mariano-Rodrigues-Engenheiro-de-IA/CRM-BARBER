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

// Imagem de banner customizada (fundo do card de destaque) — troca esse
// caminho quando a arte definitiva for adicionada em /public/academy/.
// Até lá, usa o gradiente escuro como fundo (fallback abaixo).
const BANNER_IMAGE_URL: string | null = null;

/** Área de Treinamento — estilo "academy"/área de membros escura: aula em
 * destaque como banner grande no topo (com overlay pra contraste do
 * texto, nunca a thumbnail do vídeo esticada como fundo), demais aulas
 * enfileiradas abaixo. */
export function AulasView({ api }: { api: Api }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [playing, setPlaying] = useState<Lesson | null>(null);

  useEffect(() => {
    api("/api/public/extension/lessons").then((r) => {
      if (r?.ok) setLessons(r.lessons);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!lessons) {
    return <p className="text-sm text-neutral-400">Carregando...</p>;
  }

  if (lessons.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-900 p-10 text-center">
        <p className="text-sm text-neutral-500">Nenhuma aula disponível ainda.</p>
      </div>
    );
  }

  const featured = lessons.find((l) => l.featured) ?? lessons[0];
  const rest = lessons.filter((l) => l.id !== featured.id);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* Banner grande — aula em destaque. Fundo é uma arte dedicada (ou
          gradiente escuro de fallback), NUNCA a thumbnail do vídeo — evita
          o efeito "travado"/poluído de esticar um print de tela. */}
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          backgroundImage: BANNER_IMAGE_URL
            ? `linear-gradient(90deg, rgba(5,8,20,0.92) 0%, rgba(5,8,20,0.55) 55%, rgba(5,8,20,0.25) 100%), url(${BANNER_IMAGE_URL})`
            : "radial-gradient(circle at 15% 30%, #1c2440 0%, #0a0e1e 55%, #05070f 100%)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="flex min-h-[260px] flex-col justify-center px-6 py-10 md:min-h-[340px] md:px-12">
          <span className="mb-3 inline-block w-fit rounded-full bg-brand px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
            Bem-vindo(a)
          </span>
          <h1 className="max-w-lg text-2xl font-bold text-white md:text-4xl">Zaylo Treinamentos</h1>
          <p className="mt-2 max-w-md text-sm text-neutral-300 md:text-base">
            Aulas práticas pra você tirar o máximo proveito do sistema. Comece pela primeira e siga no seu ritmo.
          </p>
          <button
            onClick={() => setPlaying(featured)}
            className="mt-6 flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 shadow-lg transition hover:scale-[1.02]"
          >
            <PlayIcon /> Assistir "{featured.title}"
          </button>
        </div>
      </div>

      {/* Demais aulas, enfileiradas — sem repetir a que já está em destaque acima */}
      {rest.length > 0 && (
        <div>
          <h3 className="mb-4 text-lg font-bold text-neutral-100">Mais aulas</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((l) => (
              <button
                key={l.id}
                onClick={() => setPlaying(l)}
                className="group overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 text-left shadow-sm transition hover:border-neutral-700 hover:shadow-lg"
              >
                <div className="relative">
                  <img src={youtubeThumbnail(l.youtube_url) ?? undefined} alt="" className="h-40 w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 opacity-0 shadow transition group-hover:opacity-100">
                      <PlayIcon />
                    </div>
                  </div>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-neutral-100">{l.title}</p>
                  {l.description && <p className="mt-1 line-clamp-2 text-xs text-neutral-400">{l.description}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

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
