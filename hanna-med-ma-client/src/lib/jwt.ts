/**
 * Decode a JWT payload without verifying the signature.
 *
 * This is only used for UX-level decisions — specifically to redirect an
 * expired session to /login BEFORE rendering the dashboard (which would
 * otherwise flash for the instant it takes the first API call to come
 * back 401). The server remains the source of truth for authn/authz.
 */
function decodePayload(token: string): Record<string, unknown> | null {
	try {
		const part = token.split(".")[1];
		if (!part) return null;
		// JWT uses base64url; normalise to base64 before atob.
		const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
		return JSON.parse(atob(padded));
	} catch {
		return null;
	}
}

/**
 * Returns true when the token is missing, malformed, or whose `exp` is in
 * the past (including a small `skewSeconds` safety buffer so in-flight
 * requests aren't surprised by a token that's about to die).
 */
export function isJwtExpired(
	token: string | null | undefined,
	skewSeconds = 15,
): boolean {
	if (!token) return true;
	const payload = decodePayload(token);
	if (!payload) return true;
	const exp = typeof payload.exp === "number" ? payload.exp : null;
	if (exp === null) return false; // no exp claim → treat as valid
	return Date.now() >= (exp - skewSeconds) * 1000;
}
