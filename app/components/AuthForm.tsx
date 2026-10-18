import { Form, Link, useNavigation } from "react-router";

interface AuthFormProps {
    mode: "login" | "signup";
    next: string;
    error?: string;
}

const copy = {
    login: {
        title: "Welcome back",
        subtitle: "Log in to continue your job journey",
        submit: "Log In",
        busy: "Logging in...",
        switchText: "New here?",
        switchLink: "Create an account",
        switchTo: "/signup",
    },
    signup: {
        title: "Create your account",
        subtitle: "Get AI feedback on your resume",
        submit: "Sign Up",
        busy: "Creating account...",
        switchText: "Already have an account?",
        switchLink: "Log in",
        switchTo: "/login",
    },
};

const AuthForm = ({ mode, next, error }: AuthFormProps) => {
    const text = copy[mode];
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";
    const switchTo = next === "/" ? text.switchTo : `${text.switchTo}?next=${encodeURIComponent(next)}`;

    return (
        <main className="bg-[url('/images/bg-auth.svg')] bg-cover min-h-screen flex items-center justify-center">
            <div className="gradient-border shadow-lg">
                <section className="flex flex-col gap-8 bg-white rounded-2xl p-10">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <h1>{text.title}</h1>
                        <h2>{text.subtitle}</h2>
                    </div>
                    <Form method="post" className="flex flex-col gap-4">
                        <input type="hidden" name="next" value={next} />
                        <div className="form-div">
                            <label htmlFor="email">Email</label>
                            <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
                        </div>
                        <div className="form-div">
                            <label htmlFor="password">Password</label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete={mode === "login" ? "current-password" : "new-password"}
                                placeholder="At least 8 characters"
                                minLength={8}
                                required
                            />
                        </div>
                        <button type="submit" className="auth-button" disabled={isSubmitting}>
                            <p>{isSubmitting ? text.busy : text.submit}</p>
                        </button>
                        {error && (
                            <p role="alert" className="text-red-500 text-sm text-center">
                                {error}
                            </p>
                        )}
                    </Form>
                    <p className="text-center text-gray-500">
                        {text.switchText}{" "}
                        <Link to={switchTo} className="font-semibold text-gray-800 underline">
                            {text.switchLink}
                        </Link>
                    </p>
                </section>
            </div>
        </main>
    );
};

export default AuthForm;
