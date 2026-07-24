// Factory de provider WhatsApp. Escolha via env `WHATSAPP_PROVIDER`.
// Padrão: uazapi. No futuro, `meta` liga a implementação oficial.

import type { WhatsAppProvider } from "./types";
import { uazapiProvider } from "./uazapi.server";

export function getWhatsAppProvider(): WhatsAppProvider {
  const name = (process.env.WHATSAPP_PROVIDER ?? "uazapi").toLowerCase();
  switch (name) {
    case "uazapi":
      return uazapiProvider;
    default:
      throw new Error(`WHATSAPP_PROVIDER desconhecido: ${name}`);
  }
}
