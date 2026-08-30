// Respostas rápidas: título + lista ordenada de ações (texto/imagem/vídeo/áudio).
//
// As ações ficam em `quick_replies.actions` (jsonb). Mídia é gravada no bucket
// privado `quick-reply-media` e referenciada por `path`; a API devolve uma URL
// assinada temporária em `url` na hora de listar.

import { z } from "zod";

// Além das ações de envio, uma resposta rápida pode mover o contato no funil
// depois do envio (`funnel_add` / `funnel_remove`).
export const QUICK_REPLY_ACTION_TYPES = ["text", "image", "video", "audio"] as const;
export const QUICK_REPLY_FUNNEL_TYPES = ["funnel_add", "funnel_remove"] as const;
export type QuickReplyActionType =
  | (typeof QUICK_REPLY_ACTION_TYPES)[number]
  | (typeof QUICK_REPLY_FUNNEL_TYPES)[number];

export const quickReplyActionSchema = z
  .object({
    type: z.enum([...QUICK_REPLY_ACTION_TYPES, ...QUICK_REPLY_FUNNEL_TYPES]),
    text: z.string().max(4000).optional(),
    caption: z.string().max(1000).optional(),
    path: z.string().max(400).optional(),
    mime: z.string().max(120).optional(),
    filename: z.string().max(200).optional(),
    funnel_id: z.string().uuid().optional(),
    stage_id: z.string().uuid().optional(),
    // Segundos de espera depois de enviar esse passo, antes do próximo.
    // Opcional — passos sem isso usam o intervalo padrão (700ms).
    delay_seconds: z.number().min(0).max(120).optional(),
  })
  .refine(
    (a) =>
      a.type === "text"
        ? !!a.text?.trim()
        : a.type === "funnel_add"
          ? !!a.funnel_id && !!a.stage_id
          : a.type === "funnel_remove"
            ? !!a.funnel_id
            : !!a.path,
    { message: "Ação de texto exige texto; mídia exige arquivo; ação de funil exige funil." },
  );

export const quickReplySchema = z.object({
  title: z.string().trim().min(1).max(120),
  actions: z.array(quickReplyActionSchema).min(1).max(20),
  sort_order: z.number().int().min(0).max(9999).optional(),
  // Categoria é uma entidade própria agora (tabela quick_reply_categories,
  // criada antes pelo usuário) — aqui só guarda a referência, ou null pra
  // "sem categoria". "" também vira null (select com opção vazia).
  category_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => v || null),
  // Atalho: digitar "/palavra" na caixa do WhatsApp aciona esta resposta.
  // Sem espaços (é uma "palavra" só) — normaliza pra minúsculas aqui pra
  // a comparação na hora de digitar não depender de caixa alta/baixa.
  shortcut: z
    .string()
    .trim()
    .max(30)
    .regex(/^[\p{L}\p{N}_-]*$/u, "Atalho não pode ter espaços ou símbolos.")
    .nullable()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  is_favorite: z.boolean().optional(),
});

// Categoria como entidade própria — criada antes (nome + cor), depois
// atribuída às respostas por seleção.
export const quickReplyCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor precisa estar em formato hex (#rrggbb).")
    .optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

export type QuickReplyCategory = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

// Paleta sugerida no seletor de cor — o usuário não é obrigado a usar só
// essas (o input é um color picker de verdade), mas ajuda a bater logo de
// cara com algo que combina com o resto da interface.
export const QUICK_REPLY_CATEGORY_COLORS = [
  "#3d5fa8", // azul (cor da marca)
  "#2e9e6b", // verde
  "#c9822a", // laranja
  "#a34747", // vermelho
  "#7b5ec7", // roxo
  "#3a9fb5", // ciano
] as const;

export type QuickReplyAction = z.infer<typeof quickReplyActionSchema> & { url?: string | null };

/** Ações que a extensão realmente envia no WhatsApp (as de funil ficam no CRM). */
export function sendableActions(actions: QuickReplyAction[]) {
  return actions.filter((a) => (QUICK_REPLY_ACTION_TYPES as readonly string[]).includes(a.type));
}

/** Ações de funil aplicadas pelo CRM depois do envio. */
export function funnelActions(actions: QuickReplyAction[]) {
  return actions.filter((a) => (QUICK_REPLY_FUNNEL_TYPES as readonly string[]).includes(a.type));
}


export type QuickReply = {
  id: string;
  title: string;
  actions: QuickReplyAction[];
  sort_order: number;
  category_id: string | null;
  shortcut: string | null;
  is_favorite: boolean;
};

export const QUICK_REPLY_BUCKET = "quick-reply-media";

// Variáveis que o usuário pode usar no texto — substituídas na hora do
// envio (ver fill() em handleWaAction, na extensão). Mantém essa lista e
// a de lá em sincronia se adicionar uma nova.
export const QUICK_REPLY_VARIABLES = [
  { key: "nome", label: "Nome do contato" },
  { key: "primeiro_nome", label: "Só o primeiro nome" },
  { key: "telefone", label: "Telefone" },
] as const;

/** Aplica {nome} e afins no texto da ação. */
export function renderQuickReplyText(text: string, vars: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m);
}

export function actionLabel(type: QuickReplyActionType) {
  if (type === "text") return "Texto";
  if (type === "image") return "Imagem";
  if (type === "video") return "Vídeo";
  if (type === "audio") return "Áudio";
  if (type === "funnel_add") return "Adicionar ao funil";
  return "Remover do funil";
}

