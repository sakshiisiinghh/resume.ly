import { getUser } from "~/.server/auth";
import { createRedis, progressChannel } from "~/.server/redis";
import { getResume } from "~/.server/resumes";
import { withTimeout } from "~/.server/timeout";
import type { Route } from "./+types/api.resume-events";

const HEARTBEAT_MS = 15_000;
const TERMINAL = new Set(["done", "failed"]);

export async function loader({ request, params }: Route.LoaderArgs) {
    const user = await getUser(request);
    if (!user) throw new Response("Unauthorized", { status: 401 });

    const found = await getResume(user.id, params.id);
    if (!found) throw new Response("Not found", { status: 404 });
    const analysisId = found.analysis.id;

    // Subscribe before reading the current state so an update in between can't be missed.
    const subscriber = createRedis();
    try {
        await withTimeout(subscriber.subscribe(progressChannel(analysisId)), 3000, "subscribe");
    } catch {
        subscriber.disconnect();
        throw new Response("Progress updates are unavailable", { status: 503 });
    }
    const current = await getResume(user.id, params.id);

    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const stream = new ReadableStream({
        start(controller) {
            const send = (payload: string) => !closed && controller.enqueue(encoder.encode(payload));
            const close = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeat);
                subscriber.disconnect();
                controller.close();
            };

            const initial = { status: current?.analysis.status ?? "failed", stage: current?.analysis.stage ?? null };
            send(`data: ${JSON.stringify(initial)}\n\n`);
            if (TERMINAL.has(initial.status)) return close();

            subscriber.on("message", (_channel, message) => {
                send(`data: ${message}\n\n`);
                if (TERMINAL.has(JSON.parse(message).status)) close();
            });
            heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
            request.signal.addEventListener("abort", close);
        },
        cancel() {
            closed = true;
            clearInterval(heartbeat);
            subscriber.disconnect();
        },
    });

    return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
}
