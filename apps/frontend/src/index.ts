import { serve } from "bun";
import index from "./index.html";

const server = serve({
  port: Number(process.env.PORT) || 3000,
  routes: {
    "/env.json": () =>
      Response.json(
        {
          apiUrl: process.env.BUN_PUBLIC_API_URL,
          wsUrl: process.env.BUN_PUBLIC_WS_URL,
          supabaseUrl: process.env.BUN_PUBLIC_SUPABASE_URL,
          supabasePublishableKey:
            process.env.BUN_PUBLIC_SUPABASE_ANON_KEY ||
            process.env.SUPABASE_PUBLISHABLE_KEY,
        },
        {
          headers: { "Cache-Control": "no-store" },
        },
      ),

    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async (req) => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
