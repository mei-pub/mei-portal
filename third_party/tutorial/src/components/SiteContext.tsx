"use client";

import { createContext, useContext } from "react";

export interface SiteInfo {
  slug: string;
  name: string;
  type: "normal" | "secret";
}

export const SiteContext = createContext<SiteInfo>({ slug: "", name: "", type: "normal" });

export function useSite() {
  return useContext(SiteContext);
}
