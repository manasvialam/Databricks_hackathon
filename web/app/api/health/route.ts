import { snapshot, sourceInfo } from "@/lib/snapshot";
import { llmConfigured, warehouseConfigured } from "@/lib/databricks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which capability tier the server is running at. Nothing secret is returned.
export async function GET() {
  const snap = snapshot();
  const llm = llmConfigured(), warehouse = warehouseConfigured();
  const traffic = (process.env.TRAFFIC_PROVIDER ?? "none").toLowerCase() !== "none" && !!process.env.TRAFFIC_API_KEY;
  return Response.json({
    ok: true,
    tier: warehouse && llm && traffic ? 1 : llm ? 2 : 3,
    llm, warehouse, liveTraffic: traffic,
    data: { ...sourceInfo(), built: snap.meta.built, facilities: snap.meta.facilities, registryListAsOf: snap.meta.registry_list_as_of },
  });
}
