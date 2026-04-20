import type { EmrSystem } from "../types";

export interface HospitalMeta {
	key: EmrSystem;
	label: string;
	short: string;
	hue: string;
}

export const HOSPITALS: Record<EmrSystem, HospitalMeta> = {
	BAPTIST: { key: "BAPTIST", label: "Baptist Health", short: "BAP", hue: "#2a6f84" },
	JACKSON: { key: "JACKSON", label: "Jackson Health", short: "JAX", hue: "#c06a1f" },
	STEWARD: { key: "STEWARD", label: "Stewart Health", short: "STW", hue: "#6d4f8f" },
};

export function getHospital(key: string | undefined): HospitalMeta | undefined {
	if (!key) return undefined;
	const upper = key.toUpperCase();
	return HOSPITALS[upper as EmrSystem];
}
