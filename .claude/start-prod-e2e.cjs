// Local production-server launcher for Playwright verification (not app code).
// The production env check refuses the http:// site URL in .env.local, so the
// public origin is supplied here; a process variable wins over .env.local.
process.env.NEXT_PUBLIC_SITE_URL = "https://husnalogy.com";
process.argv = [process.argv[0], "next", "start", "-p", "3100", "-H", "127.0.0.1"];
require("../node_modules/next/dist/bin/next");
