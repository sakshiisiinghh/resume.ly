import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  // Pre-bundle deps that lazy routes import, or Vite re-optimizes mid-session and loads React twice.
  optimizeDeps: {
    include: ["react-dropzone", "zustand", "clsx", "tailwind-merge", "zod"],
  },
});
