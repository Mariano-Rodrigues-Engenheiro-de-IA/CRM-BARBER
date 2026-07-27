// Factory de provider WhatsApp. Escolha via env `WHATSAPP_PROVIDER`.
// Padrão: uazapi (QR). `meta` liga a API oficial via BSP (Embedded Signup).

import type { ProviderName, WhatsAppProvider } from "./types";
import { uazapiProvider } from "./uazapi.server";
import { metaProvider } from "./meta.server";

/** Nome do provider ativo, sem instanciar nada. */
export function getWhatsAppProviderName(): ProviderName {
  const name = (process.env.WHATSAPP_PROVIDER ?? "uazapi").toLowerCase();
  if (name === "uazapi" || name === "meta") return name;
  throw new Error(`WHATSAPP_PROVIDER desconhecido: ${name}`);
}

export function getWhatsAppProviderByName(name: ProviderName): WhatsAppProvider {
  switch (name) {
    case "uazapi":
      return uazapiProvider;
    case "meta":
      return metaProvider;
  }
}

export function getWhatsAppProvider(): WhatsAppProvider {
  return getWhatsAppProviderByName(getWhatsAppProviderName());
}

