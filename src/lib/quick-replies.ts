// Respostas rápidas: título + lista ordenada de ações (texto/imagem/vídeo/áudio).
//
// As ações ficam em `quick_replies.actions` (jsonb). Mídia é gravada no bucket
// privado `quick-reply-media` e referenciada por `path`; a API devolve uma URL
// assinada temporária em `url` na hora de listar.

import { z } from "zod";

export const QUICK_REPLY_ACTION_TYPES = ["text", "image", "video", "audio"] as const;
export type QuickReplyActionType = (typeof QUICK_REPLY_ACTION_TYPES)[number];

export const quickReplyActionSchema = z
  .object({
    type: z.enum(QUICK_REPLY_ACTION_TYPES),
    text: z.string().max(4000).optional(),
    caption: z.string().max(1000).optional(),
    path: z.string().max(400).optional(),
    mime: z.string().max(120).optional(),
    filename: z.string().max(200).optional(),
  })
  .refine((a) => (a.type === "text" ? !!a.text?.trim() : !!a.path), {
    message: "Ação de texto exige texto; mídia exige arquivo.",
  });

export const quickReplySchema = z.object({
  title: z.string().trim().min(1).max(120),
  actions: z.array(quickReplyActionSchema).min(1).max(20),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

export type QuickReplyAction = z.infer<typeof quickReplyActionSchema> & { url?: string | null };

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
  return type === "text" ? "Texto" : type === "image" ? "Imagem" : type === "video" ? "Vídeo" : "Áudio";
}
