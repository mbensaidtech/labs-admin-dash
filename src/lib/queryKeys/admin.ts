/** Query keys of the admin domain (never inline raw arrays in components). */
export const adminKeys = {
  all: ["admin"] as const,
  overview: () => [...adminKeys.all, "overview"] as const,
  matrix: () => [...adminKeys.all, "matrix"] as const,
  help: (statuses: string) => [...adminKeys.all, "help", statuses] as const,
  devs: () => [...adminKeys.all, "devs"] as const,
  dev: (id: string) => [...adminKeys.devs(), id] as const,
  events: (devId: string) => [...adminKeys.all, "events", devId] as const,
};
