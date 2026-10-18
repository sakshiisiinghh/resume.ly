import { checkReadiness } from "~/.server/health";

export async function loader() {
    const readiness = await checkReadiness();
    return Response.json(readiness, { status: readiness.status === "ready" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
