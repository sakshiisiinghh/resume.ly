import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        // Server suites share one test database, so files must not overlap.
        fileParallelism: false,
        projects: [
            {
                extends: true,
                test: {
                    name: "web",
                    environment: "jsdom",
                    include: ["app/{components,lib}/**/*.test.{ts,tsx}"],
                    setupFiles: ["./test/setup.web.ts"],
                    css: false,
                },
            },
            {
                extends: true,
                test: {
                    name: "server",
                    environment: "node",
                    include: ["app/.server/**/*.test.ts", "evals/**/*.test.ts", "server/**/*.test.ts", "scripts/**/*.test.ts"],
                    setupFiles: ["./test/setup.server.ts"],
                    globalSetup: ["./test/global-setup.ts"],
                },
            },
        ],
    },
});
