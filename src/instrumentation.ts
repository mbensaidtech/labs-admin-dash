/** Startup check (Node runtime only): logs missing indexes instead of failing, the app ensures them lazily. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.MONGODB_URI) return;
  try {
    const { getDb } = await import("@/lib/db/client");
    const { missingIndexes } = await import("@/lib/db/indexes");
    const missing = await missingIndexes(await getDb());
    if (missing.length > 0) {
      console.warn(`MongoDB indexes missing after startup: ${missing.join(", ")}`);
    }
  } catch (error) {
    console.warn("MongoDB is not reachable at startup; the health endpoint will report it.", error);
  }
}
