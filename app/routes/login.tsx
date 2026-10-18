import { data, redirect } from "react-router";
import AuthForm from "~/components/AuthForm";
import { authenticate } from "~/.server/accounts";
import { assertSameOrigin, createSession, getUser } from "~/.server/auth";
import { RULES, checkRateLimits, peekRateLimit, recordHit, tooManyRequests } from "~/.server/rate-limit";
import { logger } from "~/.server/logger";
import { safeRedirect } from "~/lib/util";
import type { Route } from "./+types/login";

export const meta = () => [{ title: "Resume.ly | Log in" }];

export async function loader({ request }: Route.LoaderArgs) {
    const next = safeRedirect(new URL(request.url).searchParams.get("next"));
    if (await getUser(request)) throw redirect(next);
    return { next };
}

export async function action({ request, context }: Route.ActionArgs) {
    assertSameOrigin(request);
    const form = await request.formData();
    const next = safeRedirect(form.get("next") as string | null);

    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const failures = { rule: RULES.loginFailures, subject: email || undefined };
    const limited = (await peekRateLimit(failures)) ?? (await checkRateLimits([{ rule: RULES.login, subject: context.ip }]));
    if (limited) return tooManyRequests(limited);

    const result = await authenticate({ email, password: form.get("password") });
    if (!result.ok) {
        await recordHit(failures);
        logger.warn({ requestId: context.requestId }, "failed sign-in");
        return data({ error: result.error }, { status: 401 });
    }
    logger.info({ requestId: context.requestId, userId: result.user.id }, "signed in");

    return redirect(next, { headers: { "Set-Cookie": await createSession(result.user.id) } });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
    return <AuthForm mode="login" next={loaderData.next} error={actionData?.error} />;
}
