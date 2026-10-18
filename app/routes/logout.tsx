import { redirect } from "react-router";
import { assertSameOrigin, destroySession } from "~/.server/auth";
import type { Route } from "./+types/logout";

export const loader = () => redirect("/login");

export async function action({ request }: Route.ActionArgs) {
    assertSameOrigin(request);
    return redirect("/login", { headers: { "Set-Cookie": await destroySession(request) } });
}
