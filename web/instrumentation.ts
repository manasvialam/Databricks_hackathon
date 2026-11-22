export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWarehouseSync } = await import("./lib/snapshot");
    startWarehouseSync();
  }
}
