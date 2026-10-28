import type { APIRoute } from "astro";
import nodemailer from "nodemailer";

export const prerender = false;

const MAX_BODY_BYTES = 16_384;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;
const requestsByAddress = new Map<string, { startedAt: number; count: number }>();

function jsonResponse(status: number, message: string, ok = false): Response {
	return Response.json({ ok, message }, { status });
}

async function readFormBody(request: Request): Promise<string | null> {
	const reader = request.body?.getReader();
	if (!reader) return null;

	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

function limited(address: string, now: number): boolean {
	for (const [key, value] of requestsByAddress) {
		if (now - value.startedAt >= RATE_WINDOW_MS) requestsByAddress.delete(key);
	}
	const current = requestsByAddress.get(address);
	if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
		requestsByAddress.set(address, { startedAt: now, count: 1 });
		return false;
	}
	current.count += 1;
	return current.count > RATE_LIMIT;
}

function safeHeader(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const origin = request.headers.get("origin");
	if (origin) {
		try {
			if (new URL(origin).origin !== new URL(request.url).origin) {
				return jsonResponse(403, "Cererea nu a putut fi verificată.");
			}
		} catch {
			return jsonResponse(403, "Cererea nu a putut fi verificată.");
		}
	}

	if (
		!request.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("application/x-www-form-urlencoded")
	) {
		return jsonResponse(415, "Formatul trimis nu este acceptat.");
	}

	const body = await readFormBody(request);
	if (body === null) return jsonResponse(413, "Formularul este prea mare.");

	const fields = new URLSearchParams(body);
	if (fields.get("website")) {
		return jsonResponse(400, "Formularul nu a putut fi validat.");
	}

	const formKind = fields.get("form");
	if (formKind !== "contact" && formKind !== "welcome") {
		return jsonResponse(400, "Tipul formularului nu este valid.");
	}

	const name = fields.get("name")?.trim() ?? "";
	const email = fields.get("email")?.trim() ?? "";
	const phone = fields.get("phone")?.trim() ?? "";
	const message = fields.get("message")?.trim() ?? "";
	if (
		name.length < 2 ||
		name.length > 120 ||
		email.length > 254 ||
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
		phone.length > 40 ||
		message.length < 5 ||
		message.length > 5000 ||
		fields.get("privacy") !== "yes"
	) {
		return jsonResponse(400, "Verificați câmpurile obligatorii și acordul privind datele personale.");
	}

	const now = Date.now();
	const address = clientAddress || "unknown";
	if (limited(address, now)) {
		return jsonResponse(429, "Ați trimis prea multe mesaje. Încercați din nou peste un minut.");
	}

	const host = process.env.SMTP_HOST?.trim();
	const from = process.env.SCHOOL_MAIL_FROM?.trim();
	const recipient =
		process.env.SCHOOL_CONTACT_RECIPIENT?.trim() ||
		"office@liceul-onisifor-ghibu.ro";
	const port = Number(process.env.SMTP_PORT || "587");
	const username = process.env.SMTP_USER;
	const password = process.env.SMTP_PASS;

	if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
		console.error("School contact form email is not configured.");
		return jsonResponse(
			503,
			"Formularul nu este disponibil momentan. Vă rugăm să scrieți la office@liceul-onisifor-ghibu.ro.",
		);
	}
	if ((username && !password) || (!username && password)) {
		console.error("School contact form SMTP credentials are incomplete.");
		return jsonResponse(
			503,
			"Formularul nu este disponibil momentan. Vă rugăm să scrieți la office@liceul-onisifor-ghibu.ro.",
		);
	}

	const transporter = nodemailer.createTransport({
		host,
		port,
		secure: port === 465,
		...(username && password ? { auth: { user: username, pass: password } } : {}),
	});
	const subject = safeHeader(
		`${formKind === "welcome" ? "Solicitare informații" : "Mesaj de contact"} — ${name}`,
	);
	const text = [
		`Nume: ${name}`,
		`E-mail: ${email}`,
		`Telefon: ${phone || "Nespecificat"}`,
		"",
		"Mesaj:",
		message,
	].join("\n");

	try {
		await transporter.sendMail({
			from,
			to: recipient,
			replyTo: email,
			subject,
			text,
		});
	} catch (error) {
		console.error(
			"School contact form email delivery failed:",
			error instanceof Error ? error.message : "unknown mail transport error",
		);
		return jsonResponse(
			503,
			"Mesajul nu a putut fi trimis. Vă rugăm să încercați din nou sau să scrieți la office@liceul-onisifor-ghibu.ro.",
		);
	}

	return jsonResponse(200, "Mesajul a fost trimis. Vă mulțumim!", true);
};
