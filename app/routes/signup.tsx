import { data, redirect } from "react-router";
import AuthForm from "~/components/AuthForm";
import { signUp } from "~/.server/accounts";
import { assertSameOrigin, createSession, getUser } from "~/.server/auth";
import { RULES, checkRateLimits, tooManyRequests } from "~/.server/rate-limit";
import { logger } from "~/.server/logger";
import { safeRedirect } from "~/lib/util";
import type { Route } from "./+types/signup";

export const meta = () => [{ title: "Resume.ly | Sign up" }];

export async function loader({ request }: Route.LoaderArgs) {
    const next = safeRedirect(new URL(request.url).searchParams.get("next"));
    if (await getUser(request)) throw redirect(next);
    return { next };
}

export async function action({ request, context }: Route.ActionArgs) {
    assertSameOrigin(request);
    const limited = await checkRateLimits([{ rule: RULES.signup, subject: context.ip }]);
    if (limited) return tooManyRequests(limited);

    const form = await request.formData();
    const next = safeRedirect(form.get("next") as string | null);

    const result = await signUp({ email: form.get("email"), password: form.get("password") });
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    logger.info({ requestId: context.requestId, userId: result.user.id }, "account created");

    return redirect(next, { headers: { "Set-Cookie": await createSession(result.user.id) } });
}

export default function Signup({ loaderData, actionData }: Route.ComponentProps) {
    return <AuthForm mode="signup" next={loaderData.next} error={actionData?.error} />;
}
