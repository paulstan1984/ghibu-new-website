import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const legacySite = "https://www.liceul-onisifor-ghibu.ro";
const contentTypes: Record<string, string> = {
	".avif": "image/avif",
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".ogg": "audio/ogg",
	".pdf": "application/pdf",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webm": "video/webm",
	".webp": "image/webp",
};

function redirectToLegacy(pathParts: string[]) {
	const legacyUrl = new URL(
		`/wp-content/uploads/${pathParts.map(encodeURIComponent).join("/")}`,
		legacySite,
	);
	return new Response(null, {
		status: 302,
		headers: { Location: legacyUrl.toString() },
	});
}

export async function GET({ params }: { params: { path?: string } }) {
	const relativePath = params.path;
	if (
		!relativePath ||
		relativePath.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
	) {
		return new Response(null, { status: 400 });
	}

	const pathParts = relativePath.split(/[\\/]/);
	const uploadsDirectory = process.env.WORDPRESS_UPLOADS_DIR;
	if (!uploadsDirectory) return redirectToLegacy(pathParts);

	try {
		const root = await realpath(uploadsDirectory);
		const filename = await realpath(path.resolve(root, ...pathParts));
		if (!filename.startsWith(`${root}${path.sep}`)) {
			return new Response(null, { status: 404 });
		}

		const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stats = await file.stat();
		if (!stats.isFile()) {
			await file.close();
			return new Response(null, { status: 404 });
		}

		const contentType =
			contentTypes[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
		const body = Readable.toWeb(file.createReadStream()) as ReadableStream;
		return new Response(body, {
			headers: {
				"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
				"Content-Length": String(stats.size),
				"Content-Security-Policy": "sandbox; default-src 'none'",
				"Content-Type": contentType,
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch {
		return redirectToLegacy(pathParts);
	}
}
