import { data, redirect } from "react-router";
import AuthForm from "~/components/AuthForm";
import { signUp } from "~/.server/accounts";
import { assertSameOrigin, createSession, getUser } from "~/.server/auth";
import { safeRedirect } from "~/lib/util";
import type { Route } from "./+types/signup";

export const meta = () => [{ title: "Resume.ly | Sign up" }];

export async function loader({ request }: Route.LoaderArgs) {
    const next = safeRedirect(new URL(request.url).searchParams.get("next"));
    if (await getUser(request)) throw redirect(next);
    return { next };
}

export async function action({ request }: Route.ActionArgs) {
    assertSameOrigin(request);
    const form = await request.formData();
    const next = safeRedirect(form.get("next") as string | null);

    const result = await signUp({ email: form.get("email"), password: form.get("password") });
    if (!result.ok) return data({ error: result.error }, { status: 400 });

    return redirect(next, { headers: { "Set-Cookie": await createSession(result.user.id) } });
}

export default function Signup({ loaderData, actionData }: Route.ComponentProps) {
    return <AuthForm mode="signup" next={loaderData.next} error={actionData?.error} />;
}
