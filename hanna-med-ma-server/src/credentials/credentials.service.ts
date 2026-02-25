import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../core/prisma.service";
import { CreateCredentialDto } from "./dto/create-credential.dto";
import { UpdateCredentialDto } from "./dto/update-credential.dto";
import { EMR_SYSTEMS, SystemKey } from "./systems.config";
import * as crypto from "crypto";

@Injectable()
export class CredentialsService {
  private readonly encryptionKey: Buffer;
  private readonly algorithm = "aes-256-gcm";

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    // Use environment variable or generate a consistent key
    const key =
      this.configService.get<string>("CREDENTIALS_ENCRYPTION_KEY") ||
      "default-key-change-in-production-32";
    this.encryptionKey = crypto.scryptSync(key, "salt", 32);
  }

  /**
   * Encrypt sensitive credential fields
   */
  private encrypt(data: Record<string, string>): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.encryptionKey,
      iv,
    );

    let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      iv: iv.toString("hex"),
      data: encrypted,
      tag: authTag.toString("hex"),
    });
  }

  /**
   * Decrypt credential fields
   */
  private decrypt(encryptedString: string): Record<string, string> {
    try {
      const { iv, data, tag } = JSON.parse(encryptedString);

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        this.encryptionKey,
        Buffer.from(iv, "hex"),
      );
      decipher.setAuthTag(Buffer.from(tag, "hex"));

      let decrypted = decipher.update(data, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return JSON.parse(decrypted);
    } catch {
      // If decryption fails, return the data as-is (for backward compatibility)
      return typeof encryptedString === "string"
        ? JSON.parse(encryptedString)
        : encryptedString;
    }
  }

  /**
   * Create credential for a doctor
   */
  async create(createCredentialDto: CreateCredentialDto) {
    // Check if credential already exists for this doctor+system
    const existing = await this.prisma.doctorCredential.findUnique({
      where: {
        doctorId_systemKey: {
          doctorId: createCredentialDto.doctorId,
          systemKey: createCredentialDto.systemKey,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Credential for ${createCredentialDto.systemKey} already exists for this doctor`,
      );
    }

    // Encrypt the fields (default to empty object for systems with no credentials, e.g. Baptist)
    const encryptedFields = this.encrypt(createCredentialDto.fields ?? {});

    return this.prisma.doctorCredential.create({
      data: {
        doctorId: createCredentialDto.doctorId,
        systemKey: createCredentialDto.systemKey,
        fields: encryptedFields,
      },
    });
  }

  /**
   * Get all credentials for a doctor (decrypted)
   */
  async findByDoctor(doctorId: number) {
    const credentials = await this.prisma.doctorCredential.findMany({
      where: { doctorId },
    });

    return credentials.map((cred) => ({
      ...cred,
      fields: this.decrypt(cred.fields as string),
      systemInfo: EMR_SYSTEMS[cred.systemKey as SystemKey],
    }));
  }

  /**
   * Get specific credential for doctor+system (decrypted)
   */
  async findOne(doctorId: number, systemKey: string) {
    const credential = await this.prisma.doctorCredential.findUnique({
      where: {
        doctorId_systemKey: {
          doctorId,
          systemKey: systemKey as any,
        },
      },
    });

    if (!credential) {
      throw new NotFoundException(
        `Credential for ${systemKey} not found for doctor ${doctorId}`,
      );
    }

    return {
      ...credential,
      fields: this.decrypt(credential.fields as string),
    };
  }

  /**
   * Update credential
   */
  async update(id: number, updateCredentialDto: UpdateCredentialDto) {
    const credential = await this.prisma.doctorCredential.findUnique({
      where: { id },
    });

    if (!credential) {
      throw new NotFoundException(`Credential with ID ${id} not found`);
    }

    const updateData: any = {};

    if (updateCredentialDto.fields) {
      updateData.fields = this.encrypt(updateCredentialDto.fields);
    }

    return this.prisma.doctorCredential.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Delete credential
   */
  async remove(id: number) {
    const credential = await this.prisma.doctorCredential.findUnique({
      where: { id },
    });

    if (!credential) {
      throw new NotFoundException(`Credential with ID ${id} not found`);
    }

    return this.prisma.doctorCredential.delete({
      where: { id },
    });
  }

  /**
   * Get available EMR systems configuration
   */
  getSystems() {
    return Object.entries(EMR_SYSTEMS).map(([key, value]) => ({
      key,
      ...value,
    }));
  }
}
