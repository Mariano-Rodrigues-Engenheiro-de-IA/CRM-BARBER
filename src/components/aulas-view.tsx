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
  module_id: string | null;
};

type Module = {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  sort_order: number;
  locked: boolean;
};

/** Área de Treinamento — estilo "academy"/área de membros, organizada por
 * MÓDULOS (Tráfego Pago, Vendas, Agente de IA...), cada um com capa:
 * 1) Banner grande no topo — só decorativo.
 * 2) Grade de módulos (capa + título) — clicar entra no módulo.
 * 3) Dentro de um módulo: lista das aulas daquele módulo só, com a
 *    primeira em destaque, e um jeito de voltar pra grade de módulos. */
export function AulasView({ api }: { api: Api }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [modules, setModules] = useState<Module[] | null>(null);
  const [playing, setPlaying] = useState<Lesson | null>(null);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useEffect(() => {
    api("/api/public/extension/lessons").then((r) => {
      if (r?.ok) setLessons(r.lessons);
    });
    api("/api/public/extension/training-modules").then((r) => {
      if (r?.ok) setModules(r.modules);
    });
    const img = new Image();
    img.src = "/academy/banner.jpg";
    img.onload = () => setBannerLoaded(true);
    img.onerror = () => setBannerLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openModule = modules?.find((m) => m.id === openModuleId) ?? null;
  const moduleLessons = (lessons ?? [])
    .filter((l) => l.module_id === openModuleId)
    .slice()
    .sort((a, b) => {
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

      {!openModule ? (
        <ModulesGrid modules={modules} onOpen={setOpenModuleId} />
      ) : (
        <ModuleLessons
          module={openModule}
          lessons={moduleLessons}
          onBack={() => setOpenModuleId(null)}
          onPlay={setPlaying}
        />
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

function ModulesGrid({ modules, onOpen }: { modules: Module[] | null; onOpen: (id: string) => void }) {
  if (!modules) {
    return <p className="text-sm text-neutral-500">Carregando...</p>;
  }
  if (modules.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center">
        <p className="text-sm text-neutral-400">Nenhum módulo disponível ainda.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-4 text-lg font-bold text-neutral-900">Módulos</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {modules.map((m) => (
          <button
            key={m.id}
            onClick={() => !m.locked && onOpen(m.id)}
            disabled={m.locked}
            className={
              "group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm transition " +
              (m.locked ? "cursor-not-allowed" : "hover:shadow-lg")
            }
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden bg-neutral-100">
              {m.cover_image_url ? (
                <img
                  src={m.cover_image_url}
                  alt={m.title}
                  className={
                    "h-full w-full object-cover transition " +
                    (m.locked ? "opacity-40 grayscale" : "group-hover:scale-105")
                  }
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">{m.title}</div>
              )}
              {m.locked && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
            <div className="p-2.5">
              <p className={"line-clamp-2 text-sm font-semibold " + (m.locked ? "text-neutral-400" : "text-neutral-900")}>
                {m.title}
              </p>
              {m.locked && <p className="text-[11px] text-neutral-400">Em breve</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModuleLessons({
  module,
  lessons,
  onBack,
  onPlay,
}: {
  module: Module;
  lessons: Lesson[];
  onBack: () => void;
  onPlay: (l: Lesson) => void;
}) {
  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800">
        ← Voltar aos módulos
      </button>
      <h3 className="mb-1 text-lg font-bold text-neutral-900">{module.title}</h3>
      {module.description && <p className="mb-4 text-sm text-neutral-500">{module.description}</p>}

      {lessons.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-400">
          Nenhuma aula nesse módulo ainda.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((l, idx) => {
            const isFirst = idx === 0;
            return (
              <button
                key={l.id}
                onClick={() => onPlay(l)}
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
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M8 5v14l11-7-11-7Z" />
    </svg>
  );
}
