/** Query keys of the admin domain (never inline raw arrays in components). */
export const adminKeys = {
  all: ["admin"] as const,
  overview: (scope: string | null) => [...adminKeys.all, "overview", scope ?? "all"] as const,
  matrix: (scope: string | null) => [...adminKeys.all, "matrix", scope ?? "all"] as const,
  help: (statuses: string, scope: string | null) => [...adminKeys.all, "help", statuses, scope ?? "all"] as const,
  workshops: () => [...adminKeys.all, "workshops"] as const,
  devs: () => [...adminKeys.all, "devs"] as const,
  dev: (id: string) => [...adminKeys.devs(), id] as const,
  events: (devId: string) => [...adminKeys.all, "events", devId] as const,
};
