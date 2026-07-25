// Fábrica de adaptador de BSP. Escolha via env `WHATSAPP_BSP`.
// Hoje: 360dialog. A interface BspAdapter isola a Partner API de cada BSP.

import type { BspAdapter, BspName } from "./types";
import { dialog360Adapter } from "./dialog360.server";
import { cloudAdapter } from "./cloud.server";

export function getBspName(): BspName {
  const name = (process.env.WHATSAPP_BSP ?? "cloud").toLowerCase();
  if (name === "360dialog" || name === "cloud") return name;
  throw new Error(`WHATSAPP_BSP desconhecido: ${name}`);
}

export function getBspAdapter(): BspAdapter {
  switch (getBspName()) {
    case "360dialog":
      return dialog360Adapter;
    case "cloud":
      return cloudAdapter;
  }
}
