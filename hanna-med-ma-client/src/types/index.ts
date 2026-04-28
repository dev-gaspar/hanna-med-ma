export interface User {
	id: number;
	name: string;
	rol: string;
	username: string;
	email: string;
	createdAt: string;
	updatedAt: string;
}

export interface Doctor {
	id: number;
	name: string;
	username: string;
	/** Legacy mirror of specialtyRel.name — kept for back-compat. */
	specialty?: string;
	specialtyId?: number | null;
	specialtyRel?: { id: number; name: string } | null;
	emrSystems: string[];
	deleted?: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface RpaNode {
	uuid: string;
	hostname: string;
	status: "PENDING" | "ACTIVE" | "OFFLINE";
	lastSeen: string;
	doctorId?: number | null;
	doctor?: {
		id: number;
		name: string;
	} | null;
	createdAt: string;
	updatedAt: string;
}

export interface LoginCredentials {
	username: string;
	password: string;
}

export interface LoginResponse {
	access_token: string;
	user: User;
}

export interface CreateUserDto {
	name: string;
	rol: string;
	username: string;
	password: string;
	email: string;
}

export interface UpdateUserDto {
	name?: string;
	rol?: string;
	username?: string;
	password?: string;
	email?: string;
}

export interface CreateDoctorDto {
	name: string;
	username: string;
	password: string;
	/** Preferred when picking from the Specialty catalog dropdown. */
	specialtyId?: number | null;
	/** Legacy free-text — ignored by the server when specialtyId is set. */
	specialty?: string;
	emrSystems?: string[];
}

export interface UpdateDoctorDto {
	name?: string;
	username?: string;
	password?: string;
	specialtyId?: number | null;
	specialty?: string;
	emrSystems?: string[];
}

// EMR Credentials
export interface EMRSystemField {
	key: string;
	label: string;
	type: "text" | "email" | "password";
	required: boolean;
}

export interface EMRSystem {
	key: string;
	name: string;
	logo: string;
	fields: EMRSystemField[];
}

export interface DoctorCredential {
	id: number;
	doctorId: number;
	systemKey: string;
	fields: Record<string, string>;
	systemInfo?: EMRSystem;
	createdAt: string;
	updatedAt: string;
}

export interface CreateCredentialDto {
	doctorId: number;
	systemKey: string;
	fields: Record<string, string>;
}

export interface UpdateCredentialDto {
	fields: Record<string, string>;
}

// Doctor Authentication
export interface DoctorLoginResponse {
	access_token: string;
	doctor: {
		id: number;
		name: string;
		username: string;
		specialty?: string;
		emrSystems?: string[];
	};
}

export type BillingEmrStatus = 'PENDING' | 'REGISTERED' | 'ALREADY_EXISTS' | 'FAILED';
export type EncounterType = 'CONSULT' | 'PROGRESS' | 'PROCEDURE';
export type EmrSystem = 'JACKSON' | 'STEWARD' | 'BAPTIST';

export interface PatientBillingInfo {
	success?: boolean;
	patientId: number;
	encounterId: number;
	billingEmrStatus: BillingEmrStatus;
}

export interface Patient {
	id: number;
	emrSystem: EmrSystem;
	name: string;
	normalizedName: string;
	location?: string | null;
	facility?: string | null;
	reason?: string | null;
	admittedDate?: string | null;
	billingEmrStatus: BillingEmrStatus;
	billingEmrPatientId?: string | null;
	createdAt: string;
	updatedAt: string;
}

export type NoteStatus =
	| "PENDING"
	| "SEARCHING"
	| "NOT_FOUND"
	| "FOUND_UNSIGNED"
	| "FOUND_SIGNED";

export interface EncounterDetail {
	id: number;
	patientId: number;
	doctorId: number;
	type: EncounterType;
	dateOfService: string;
	deadline?: string | null;
	faceSheet?: string | null;
	providerNote?: string | null;
	noteStatus: NoteStatus;
	noteAttempts: number;
	noteLastAttemptAt?: string | null;
	noteAgentSummary?: string | null;
	faceSheetUrl?: string | null;
	providerNoteUrl?: string | null;
	createdAt: string;
	updatedAt: string;
}

export type RawDataType = "SUMMARY" | "INSURANCE" | "LAB";

export interface PatientRawDataEntry {
	id: number;
	dataType: RawDataType;
	extractedAt: string;
	file?: string | null;
	createdAt: string;
}

export interface PatientDetail extends Patient {
	encounters: EncounterDetail[];
	rawData: PatientRawDataEntry[];
}

