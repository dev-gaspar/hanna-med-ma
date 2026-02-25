/**
 * EMR Systems Configuration
 * Defines available systems and their required credential fields
 */
export const EMR_SYSTEMS = {
  JACKSON: {
    name: "Jackson Health",
    logo: "/logos/jackson.png",
    fields: [
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  STEWARD: {
    name: "Steward Health",
    logo: "/logos/steward.png",
    fields: [
      { key: "email", label: "Email", type: "email", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  BAPTIST: {
    name: "Baptist Health",
    logo: "/logos/baptist.png",
    fields: [], // Baptist uses VDI saved browser credentials — no manual fields needed
  },
} as const;

export type SystemKey = keyof typeof EMR_SYSTEMS;

export const VALID_SYSTEM_KEYS = Object.keys(EMR_SYSTEMS) as SystemKey[];
