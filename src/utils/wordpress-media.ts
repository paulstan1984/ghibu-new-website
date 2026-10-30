const legacySite = "https://www.liceul-onisifor-ghibu.ro";
const legacyHost = new URL(legacySite).hostname;

export function localizeWordPressMedia(source: string | null | undefined) {
	if (!source) return source;

	try {
		const url = new URL(source, legacySite);
		if (url.hostname !== legacyHost || !url.pathname.startsWith("/wp-content/uploads/")) {
			return source;
		}
		return `${url.pathname}${url.search}`;
	} catch {
		return source;
	}
}

export function normalizeWordPressMarkDefinitions<T>(content: T): T {
	if (!Array.isArray(content)) return content;

	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const markDefs = (block as { markDefs?: unknown }).markDefs;
		if (markDefs && !Array.isArray(markDefs) && typeof markDefs === "object") {
			(block as { markDefs: unknown[] }).markDefs = Object.values(markDefs);
		}
	}

	return content;
}
