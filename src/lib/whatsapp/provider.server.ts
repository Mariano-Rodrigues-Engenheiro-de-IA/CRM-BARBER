// Factory de provider WhatsApp. Escolha via env `WHATSAPP_PROVIDER`.
// Padrão: uazapi. No futuro, `meta` liga a implementação oficial.

import type { ProviderName, WhatsAppProvider } from "./types";
import { uazapiProvider } from "./uazapi.server";

/** Nome do provider ativo, sem instanciar nada. */
export function getWhatsAppProviderName(): ProviderName {
  const name = (process.env.WHATSAPP_PROVIDER ?? "uazapi").toLowerCase();
  if (name === "uazapi" || name === "meta") return name;
  throw new Error(`WHATSAPP_PROVIDER desconhecido: ${name}`);
}

export function getWhatsAppProvider(): WhatsAppProvider {
  const name = getWhatsAppProviderName();
  switch (name) {
    case "uazapi":
      return uazapiProvider;
    case "meta":
      return metaProvider;
  }
}

