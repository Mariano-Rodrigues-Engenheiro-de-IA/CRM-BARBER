// Funis de vendas + dados sincronizados do WhatsApp.
//
// Um funil pode ser "manual" (o usuário arrasta os cards) ou "label"
// (as colunas nascem de uma etiqueta do WhatsApp e os contatos daquela
// etiqueta entram automaticamente na primeira coluna).

import { z } from "zod";

// "tab"   → funil que também vira uma aba no topo do WhatsApp Web
// "label" → alimentado por uma etiqueta nativa do WhatsApp
// "manual"→ funil livre, o usuário monta as colunas e adiciona os leads
export const FUNNEL_MODES = ["manual", "label", "tab"] as const;
export type FunnelMode = (typeof FUNNEL_MODES)[number];

export const DEFAULT_STAGES = ["Novo lead", "Em conversa", "Negociando", "Fechado"] as const;

export const funnelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mode: z.enum(FUNNEL_MODES).default("manual"),
  source_label_id: z.string().trim().max(120).nullable().optional(),
  stages: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});

export const funnelPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  source_label_id: z.string().trim().max(120).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  stages: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(60),
        color: z.string().trim().max(20).nullable().optional(),
        sort_order: z.number().int().min(0).max(999),
      }),
    )
    .max(40)
    .optional(),
  removed_stage_ids: z.array(z.string().uuid()).max(40).optional(),
});

export const cardCreateSchema = z.object({
  funnel_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  value_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  wa_contact_id: z.string().uuid().nullable().optional(),
});

export const cardPatchSchema = z.object({
  id: z.string().uuid(),
  stage_id: z.string().uuid().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  value_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const waSyncSchema = z.object({
  labels: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        name: z.string().trim().min(1).max(120),
        color: z.string().trim().max(20).nullable().optional(),
        count: z.number().int().min(0).max(1_000_000).optional(),
      }),
    )
    .max(500)
    .default([]),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().trim().min(3).max(80),
        phone: z.string().trim().max(30).nullable().optional(),
        name: z.string().trim().max(160).nullable().optional(),
        is_group: z.boolean().optional(),
        label_ids: z.array(z.string().trim().max(120)).max(50).optional(),
        last_message_at: z.string().datetime().nullable().optional(),
        profile_picture_url: z.string().trim().nullable().optional(),
        unread_count: z.number().int().min(0).max(100_000).optional(),
      }),
    )
    .max(3000)
    .default([]),
});

export type FunnelStage = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
};

export type FunnelCard = {
  id: string;
  funnel_id: string;
  stage_id: string;
  title: string;
  phone: string | null;
  value_cents: number | null;
  notes: string | null;
  sort_order: number;
  customer_id: string | null;
  wa_contact_id: string | null;
  /** Identificador real do WhatsApp (ex: "5511...@c.us" ou "...@lid"), vindo
   * de wa_contacts.wa_id via join. Diferente de wa_contact_id, que é só o
   * UUID interno — não serve pra abrir chat na extensão. */
  wa_id?: string | null;
  /** Etiquetas do WhatsApp associadas ao contato (wa_labels.wa_label_id),
   * usado pra desenhar a cor da etiqueta no card. */
  label_ids?: string[];
  profile_picture_url?: string | null;
  /** Mensagens não lidas nessa conversa, pro selo no botão de WhatsApp. */
  unread_count?: number;
  stage_entered_at?: string;
  /** Status do follow-up dessa etapa pra ESTE card — null quando a etapa
   * não tem follow-up configurado (ou está pausado). Vem pronto do
   * backend (GET /funnels), sem precisar de chamada extra. */
  followup?: {
    total_steps: number;
    sent_count: number;
    all_sent: boolean;
    next_due_at: string | null;
    last_sent_at: string | null;
  } | null;
};

export type Funnel = {
  id: string;
  name: string;
  mode: FunnelMode;
  source_label_id: string | null;
  sort_order: number;
  stages: FunnelStage[];
  cards: FunnelCard[];
};

export type WaLabel = {
  id: string;
  wa_label_id: string;
  name: string;
  color: string | null;
  conversation_count: number;
};

export type WaContact = {
  id: string;
  wa_id: string;
  phone: string | null;
  name: string | null;
  is_group: boolean;
  label_ids: string[];
  last_message_at: string | null;
  profile_picture_url: string | null;
  unread_count: number;
};

export function formatBRL(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
