import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // dev convenience: talk to the Fastify server without CORS fuss
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
