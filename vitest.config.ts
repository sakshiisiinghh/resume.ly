import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        environment: "jsdom",
        setupFiles: ["./test/setup.ts"],
        include: ["app/**/*.test.{ts,tsx}"],
        css: false,
    },
});
