import { createContext, useContext, type ReactNode } from "react";
import type { PublicData } from "./types";

const DataContext = createContext<PublicData | null>(null);

export function DataProvider({ data, children }: { data: PublicData; children: ReactNode }) {
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function useSiteData() {
  const data = useContext(DataContext);
  if (!data) throw new Error("Site data is unavailable");
  return data;
}
