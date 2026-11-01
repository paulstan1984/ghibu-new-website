import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "dist-static");
const clientDirectory = path.join(root, "dist", "client");
const serverEntry = path.join(root, "dist", "server", "entry.mjs");
const port = Number(process.env.STATIC_EXPORT_PORT ?? 4399);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error("STATIC_EXPORT_PORT must be a valid TCP port.");
}

const runtimePrefix = (process.env.STATIC_RUNTIME_PREFIX ?? "/runtime").replace(/\/+$/, "");
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
	process.execPath,
	["--env-file-if-exists=.env", serverEntry],
	{
		cwd: root,
		env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
		stdio: "inherit",
	},
);

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer() {
	const deadline = Date.now() + 30_000;
	let lastError;
	let spawnError;
	server.on("error", (error) => {
		spawnError = error;
	});

	while (Date.now() < deadline) {
		if (spawnError) throw spawnError;
		if (server.exitCode !== null) {
			throw new Error(`Preview server exited with code ${server.exitCode}.`);
		}
		try {
			const response = await fetch(`${origin}/`);
			if (response.status < 500) return;
			lastError = new Error(`Preview server returned HTTP ${response.status}.`);
		} catch (error) {
			if (!(error instanceof TypeError)) throw error;
			lastError = error;
		}
		await delay(500);
	}

	throw new Error(`Preview server did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function stopServer() {
	if (server.exitCode !== null || server.signalCode !== null) return;
	const exited = new Promise((resolve) => server.once("exit", resolve));
	server.kill("SIGTERM");
	const stopped = await Promise.race([exited.then(() => true), delay(3000).then(() => false)]);
	if (!stopped) {
		server.kill("SIGKILL");
		await exited;
	}
}

function decodeEntities(value) {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

function outputPathFor(pathname, contentType) {
	const decoded = decodeURIComponent(pathname);
	const segments = decoded.split("/");
	if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\\"))) {
		throw new Error(`Unsafe path in export URL: ${pathname}`);
	}
	const relative = segments.filter(Boolean);
	const isHtml = contentType.includes("text/html");
	if (isHtml && !pathname.endsWith(".html")) relative.push("index.html");
	if (relative.length === 0) relative.push("index.html");
	const destination = path.resolve(outputDirectory, ...relative);
	if (!destination.startsWith(`${outputDirectory}${path.sep}`)) {
		throw new Error(`Export path escaped output directory: ${pathname}`);
	}
	return destination;
}

function queuePath(value, paths, sourcePath, allowDifferentOrigin = false) {
	let url;
	try {
		url = new URL(value, new URL(sourcePath, origin));
	} catch {
		return;
	}
	if (!["http:", "https:"].includes(url.protocol)) return;
	if (!allowDifferentOrigin && url.origin !== origin) return;
	url.search = "";
	url.hash = "";
	if (
		!isMediaPath(url.pathname) &&
		(url.pathname.startsWith("/_emdash/") ||
			url.pathname === "/_emdash" ||
			url.pathname.startsWith("/runtime/") ||
			url.pathname.startsWith("/api/"))
	) {
		return;
	}
	paths.add(url.pathname);
}

const mediaPrefixes = ["/_emdash/api/media/file/", "/wp-content/uploads/"];

function isMediaPath(pathname) {
	return mediaPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function linksFromHtml(html, pathname, paths) {
	const references = [];
	for (const match of html.matchAll(
		/\b(?:href|src|poster|data-src|srcset|data-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
	)) {
		references.push(decodeEntities(match[1] ?? match[2] ?? ""));
	}
	for (const match of html.matchAll(/url\(\s*(?:&quot;|["'])?([^)"'&\s]+)/gi)) {
		references.push(decodeEntities(match[1]));
	}

	for (const reference of references) {
		// srcset lists several "url descriptor" candidates separated by commas.
		for (const candidate of reference.split(/,\s+/)) {
			const target = candidate.trim().split(/\s+/)[0];
			if (target) queuePath(target, paths, pathname);
		}
	}
}

function locationsFromXml(xml) {
	return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((match) =>
		decodeEntities(match[1].trim()),
	);
}

// Search and form submissions need the Node runtime, which the proxy exposes under this prefix.
function rewriteRuntimeUrls(html) {
	return html
		.replaceAll('action="/api/forms/contact"', `action="${runtimePrefix}/api/forms/contact"`)
		.replaceAll('action="/cautare"', `action="${runtimePrefix}/cautare"`);
}

function redirectHtml(target) {
	const escaped = target
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"><title>Redirecționare</title></head><body><a href="${escaped}">Continuă</a></body></html>`;
}

async function writeBody(pathname, contentType, body) {
	const destination = outputPathFor(pathname, contentType);
	await mkdir(path.dirname(destination), { recursive: true });
	await writeFile(destination, body);
}

async function exportPages() {
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	await cp(clientDirectory, outputDirectory, { recursive: true });

	const requiredPaths = new Set([
		"/",
		"/admitere",
		"/cautare",
		"/confidentialitate",
		"/contact",
		"/despre-noi",
		"/documente",
		"/elevi",
		"/noutati",
		"/profesori",
		"/proiecte",
		"/rss.xml",
		"/robots.txt",
		"/sitemap.xml",
		"/404",
	]);
	const visited = new Set();
	const pending = ["/sitemap.xml", ...requiredPaths];
	let exported = 0;

	while (pending.length) {
		const batch = pending.splice(0, 8).filter((pathname) => !visited.has(pathname));
		if (!batch.length) continue;

		for (const pathname of batch) visited.add(pathname);
		await Promise.all(
			batch.map(async (pathname) => {
				const media = isMediaPath(pathname);
				// Media may redirect to the legacy host when it is not stored locally; download it from there.
				const response = await fetch(new URL(pathname, origin), {
					redirect: media ? "follow" : "manual",
				});
				if (media) {
					if (!response.ok) {
						console.warn(`Skipping missing media ${pathname} (HTTP ${response.status}).`);
						return;
					}
					const mediaType = response.headers.get("content-type") ?? "";
					if (mediaType.includes("text/html")) {
						console.warn(`Skipping media ${pathname}: received HTML instead of a file.`);
						return;
					}
					const destination = outputPathFor(pathname, mediaType);
					await mkdir(path.dirname(destination), { recursive: true });
					await writeFile(destination, Buffer.from(await response.arrayBuffer()));
					exported += 1;
					return;
				}
				if (response.status >= 300 && response.status < 400) {
					const location = response.headers.get("location");
					if (!location) throw new Error(`${pathname} redirected without a Location header.`);
					const target = new URL(location, new URL(pathname, origin));
					const staticTarget =
						target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : target.href;
					const targetPaths = new Set();
					queuePath(target.href, targetPaths, pathname);
					pending.push(...targetPaths);
					await writeBody(pathname, "text/html", redirectHtml(staticTarget));
					exported += 1;
					return;
				}
				if (response.status === 404 && pathname === "/404") {
					await writeBody("/404.html", "text/html", await response.text());
					exported += 1;
					return;
				}
				if (response.status === 404 && !requiredPaths.has(pathname)) {
					console.warn(`Skipping broken link ${pathname} (HTTP 404).`);
					return;
				}
				if (!response.ok) {
					throw new Error(`Could not export ${pathname}: HTTP ${response.status}.`);
				}

				const contentType = response.headers.get("content-type") ?? "application/octet-stream";
				let body = await response.text();
				if (contentType.includes("text/html")) body = rewriteRuntimeUrls(body);
				await writeBody(pathname, contentType, body);
				exported += 1;

				if (contentType.includes("xml")) {
					for (const location of locationsFromXml(body)) {
						const discovered = new Set();
						queuePath(location, discovered, pathname, true);
						for (const route of discovered) {
							if (!visited.has(route)) pending.push(route);
						}
					}
				} else if (contentType.includes("text/html")) {
					const discovered = new Set();
					linksFromHtml(body, pathname, discovered);
					for (const route of discovered) {
						if (!visited.has(route)) pending.push(route);
					}
				}
			}),
		);
	}

	console.log(`Exported ${exported} static pages and documents to ${outputDirectory}`);
}

try {
	await waitForServer();
	await exportPages();
} finally {
	await stopServer();
}
