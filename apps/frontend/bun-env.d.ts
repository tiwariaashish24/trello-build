interface ImportMetaEnv {
  readonly BUN_PUBLIC_API_URL?: string;
  readonly BUN_PUBLIC_WS_URL?: string;
  readonly BUN_PUBLIC_SUPABASE_URL?: string;
  readonly BUN_PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __TRELLO_ENV__?: {
    apiUrl?: string;
    wsUrl?: string;
    supabaseUrl?: string;
    supabasePublishableKey?: string;
  };
}

declare module "*.css";

declare module "*.svg" {
  /**
   * A path to the SVG file
   */
  const path: `${string}.svg`;
  export = path;
}

declare module "*.module.css" {
  /**
   * A record of class names to their corresponding CSS module classes
   */
  const classes: { readonly [key: string]: string };
  export = classes;
}
