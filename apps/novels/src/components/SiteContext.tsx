"use client";

import { createContext, useContext } from "react";

export interface SiteInfo {
  slug: string;
  name: string;
  type: "normal" | "secret";
  icon: string;
  iconColor: string;
  description: string;
}

export const SiteContext = createContext<SiteInfo>({ slug: "", name: "", type: "normal", icon: "", iconColor: "", description: "" });

export function useSite() {
  return useContext(SiteContext);
}
