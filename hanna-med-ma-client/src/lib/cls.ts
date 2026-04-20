export const cls = (...parts: Array<string | false | null | undefined>) =>
	parts.filter(Boolean).join(" ");
