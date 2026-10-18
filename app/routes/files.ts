import { getUser } from "~/.server/auth";
import { getResume } from "~/.server/resumes";
import { getStorage } from "~/.server/storage";
import type { Route } from "./+types/files";

export async function loader({ request, params }: Route.LoaderArgs) {
    const user = await getUser(request);
    if (!user) throw new Response("Unauthorized", { status: 401 });

    const found = await getResume(user.id, params.id);
    const isPdf = params.kind === "pdf";
    const key = isPdf ? found?.resume.fileKey : params.kind === "thumb" ? found?.resume.thumbKey : null;

    const bytes = key ? await getStorage().get(key) : null;
    if (!found || !bytes) throw new Response("Not found", { status: 404 });

    return new Response(new Uint8Array(bytes), {
        headers: {
            "Content-Type": isPdf ? "application/pdf" : "image/webp",
            "Content-Disposition": isPdf ? `inline; filename="${encodeURIComponent(found.resume.fileName)}"` : "inline",
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
