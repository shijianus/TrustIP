// Qoder Sites edge entry point. The packager copies this directory verbatim and
// runs it on a Deno-style runtime with web-standard APIs only, so this file does
// nothing but attach the router — no dependency is installed, no path alias is
// resolved, nothing is bundled.

import handler from './handler.ts';

Deno.serve(handler);
