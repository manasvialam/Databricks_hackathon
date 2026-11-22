export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWarehouseSync } = await import("./lib/snapshot");
    startWarehouseSync();
    const { warmModels } = await import("./lib/databricks");
    void warmModels();
  }
}
