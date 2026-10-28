import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "emdash";

import { getSiteLocale } from "../utils/locale";
import { resolveBlogSiteIdentity } from "../utils/site-identity";

export const GET: APIRoute = async ({ site, url }) => {
	const siteUrl = site ?? new URL(url.origin);
	const { siteTitle, siteTagline } = resolveBlogSiteIdentity(await getSiteSettings());

	const { entries, error } = await getEmDashCollection("announcements", {
		orderBy: { source_date: "desc" },
		limit: 20,
	});
	if (error) {
		console.error("Could not load announcements for the RSS feed.", error);
		return new Response("Nu am putut genera fluxul de anunțuri.", { status: 500 });
	}

	const items = entries
		.map((entry) => {
			if (!entry.data.source_date) return null;
			const publishedAt = new Date(entry.data.source_date);
			if (!Number.isFinite(publishedAt.getTime())) return null;
			const pubDate = publishedAt.toUTCString();

			const entryUrl = new URL(`/noutati/${entry.id}`, siteUrl).href;
			const title = escapeXml(entry.data.title || "Fără titlu");
			const description = escapeXml(entry.data.excerpt || "");
			return `    <item>
      <title>${title}</title>
      <link>${entryUrl}</link>
      <guid isPermaLink="true">${entryUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
    </item>`;
		})
		.filter(Boolean)
		.join("\n");

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteTitle)}</title>
    <description>${escapeXml(siteTagline)}</description>
	<link>${siteUrl.href}</link>
	<atom:link href="${new URL("/rss.xml", siteUrl).href}" rel="self" type="application/rss+xml"/>
    <language>${getSiteLocale() ?? "ro"}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

	return new Response(rss, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};

const XML_ESCAPE_PATTERNS = [
	[/&/g, "&amp;"],
	[/</g, "&lt;"],
	[/>/g, "&gt;"],
	[/"/g, "&quot;"],
	[/'/g, "&apos;"],
] as const;

function escapeXml(str: string): string {
	let result = str;
	for (const [pattern, replacement] of XML_ESCAPE_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}
