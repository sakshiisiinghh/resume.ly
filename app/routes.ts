import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("signup", "routes/signup.tsx"),
    route("logout", "routes/logout.tsx"),
    route("upload", "routes/upload.tsx"),
    route("resume/:id", "routes/resume.tsx"),
    route("files/:id/:kind", "routes/files.ts"),
    route("api/resumes/:id/events", "routes/api.resume-events.ts"),
    route("healthz", "routes/healthz.ts"),
    route("readyz", "routes/readyz.ts"),
] satisfies RouteConfig;
