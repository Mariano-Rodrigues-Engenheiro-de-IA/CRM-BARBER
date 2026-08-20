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
});

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
};

export const QUICK_REPLY_BUCKET = "quick-reply-media";

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

