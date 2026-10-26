import { defineConfig } from "vite";

// In dev, Vite serves the client on :5173 and proxies sockets/health to the game server on :3000,
// so the browser always talks to a single origin (no CORS needed).
export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: [".."] }, // client imports ../shared
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/health": "http://localhost:3000",
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
});
