import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // This allows external connections
    allowedHosts: [
      "dz5t36-5173.csb.app",
      ".csb.app", // This allows all CodeSandbox domains
    ],
  },
});
