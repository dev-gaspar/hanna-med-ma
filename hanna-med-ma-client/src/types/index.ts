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
	specialty?: string;
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
	specialty?: string;
	emrSystems?: string[];
}

export interface UpdateDoctorDto {
	name?: string;
	username?: string;
	password?: string;
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
	};
}

