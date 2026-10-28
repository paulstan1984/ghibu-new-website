import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

const databasePath = process.env.DATABASE_PATH || "./data.db";
const mediaDirectory = process.env.MEDIA_DIRECTORY || "./uploads";

export default defineConfig({
	site: "https://www.liceul-onisifor-ghibu.ro",
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	i18n: {
		defaultLocale: "ro",
		locales: ["ro"],
		routing: { prefixDefaultLocale: false },
	},
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: `file:${databasePath}` }),
			storage: local({
				directory: mediaDirectory,
				baseUrl: "/_emdash/api/media/file",
			}),
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
