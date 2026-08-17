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

/** Área de Aulas — estilo "academy"/área de membros: aula em destaque
 * como banner grande no topo, demais aulas enfileiradas abaixo. */
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
    return <p className="text-sm text-neutral-500">Carregando...</p>;
  }

  if (lessons.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center">
        <p className="text-sm text-neutral-400">Nenhuma aula disponível ainda.</p>
      </div>
    );
  }

  const featured = lessons.find((l) => l.featured) ?? lessons[0];
  const rest = lessons.filter((l) => l.id !== featured.id);

  return (
    <div className="space-y-8">
      {/* Banner grande — aula em destaque */}
      <button
        onClick={() => setPlaying(featured)}
        className="group relative block w-full overflow-hidden rounded-2xl bg-neutral-900 text-left"
      >
        <img
          src={youtubeThumbnail(featured.youtube_url) ?? undefined}
          alt=""
          className="h-64 w-full object-cover opacity-60 transition group-hover:opacity-45 md:h-80"
        />
        <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-10">
          <span className="mb-2 inline-block w-fit rounded-full bg-brand px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
            Comece aqui
          </span>
          <h2 className="max-w-xl text-2xl font-bold text-white md:text-3xl">{featured.title}</h2>
          {featured.description && <p className="mt-2 max-w-xl text-sm text-white/80">{featured.description}</p>}
          <div className="mt-4 flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-lg">
            <PlayIcon /> Assistir agora
          </div>
        </div>
      </button>

      {/* Demais aulas, enfileiradas */}
      {rest.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-bold text-neutral-900">Mais aulas</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((l) => (
              <button
                key={l.id}
                onClick={() => setPlaying(l)}
                className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm transition hover:shadow-md"
              >
                <div className="relative">
                  <img src={youtubeThumbnail(l.youtube_url) ?? undefined} alt="" className="h-40 w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 opacity-0 shadow transition group-hover:opacity-100">
                      <PlayIcon />
                    </div>
                  </div>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-neutral-900">{l.title}</p>
                  {l.description && <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{l.description}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!playing} onOpenChange={(v) => !v && setPlaying(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
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
