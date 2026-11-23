import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/** Runtime config served by the API (GET /api/v1/config). */
export type AppConfig = { uploads: { maxMb: number } };
export const fetchConfig = () => api<AppConfig>("/config");
export const configQuery = { queryKey: ["config"], queryFn: fetchConfig, staleTime: Infinity } as const;
export const useAppConfig = () => useQuery(configQuery);
