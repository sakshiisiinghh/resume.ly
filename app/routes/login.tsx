import { data, redirect } from "react-router";
import AuthForm from "~/components/AuthForm";
import { authenticate } from "~/.server/accounts";
import { assertSameOrigin, createSession, getUser } from "~/.server/auth";
import { safeRedirect } from "~/lib/util";
import type { Route } from "./+types/login";

export const meta = () => [{ title: "Resume.ly | Log in" }];

export async function loader({ request }: Route.LoaderArgs) {
    const next = safeRedirect(new URL(request.url).searchParams.get("next"));
    if (await getUser(request)) throw redirect(next);
    return { next };
}

export async function action({ request }: Route.ActionArgs) {
    assertSameOrigin(request);
    const form = await request.formData();
    const next = safeRedirect(form.get("next") as string | null);

    const result = await authenticate({ email: form.get("email"), password: form.get("password") });
    if (!result.ok) return data({ error: result.error }, { status: 401 });

    return redirect(next, { headers: { "Set-Cookie": await createSession(result.user.id) } });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
    return <AuthForm mode="login" next={loaderData.next} error={actionData?.error} />;
}
