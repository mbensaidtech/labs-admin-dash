/** Environment variables of the admin dashboard. Read lazily so tests can set them before use. */
export interface Env {
  mongodbUri: string;
  mongodbDb: string;
  workshopKey: string;
  adminPassword: string;
  sessionSecret: string;
}

export function readEnv(): Env {
  return {
    mongodbUri: process.env.MONGODB_URI ?? "",
    mongodbDb: process.env.MONGODB_DB || "labs-admin",
    workshopKey: process.env.WORKSHOP_KEY ?? "",
    adminPassword: process.env.ADMIN_PASSWORD ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
  };
}

/** Names of the admin variables that are missing: the admin area refuses to work without them. */
export function missingAdminEnv(): string[] {
  const env = readEnv();
  const missing: string[] = [];
  if (!env.adminPassword) missing.push("ADMIN_PASSWORD");
  if (!env.sessionSecret || env.sessionSecret.length < 16) missing.push("SESSION_SECRET");
  return missing;
}

export const APP_VERSION = process.env.npm_package_version ?? "0.1.0";
