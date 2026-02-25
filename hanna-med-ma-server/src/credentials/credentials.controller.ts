import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  UseGuards,
} from "@nestjs/common";
import { CredentialsService } from "./credentials.service";
import { CreateCredentialDto } from "./dto/create-credential.dto";
import { UpdateCredentialDto } from "./dto/update-credential.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("credentials")
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  /**
   * Get available EMR systems and their required fields
   */
  @Get("systems")
  getSystems() {
    return this.credentialsService.getSystems();
  }

  /**
   * Create a new credential for a doctor
   */
  @Post()
  create(@Body() createCredentialDto: CreateCredentialDto) {
    return this.credentialsService.create(createCredentialDto);
  }

  /**
   * Get all credentials for a doctor
   */
  @Get("doctor/:doctorId")
  findByDoctor(@Param("doctorId", ParseIntPipe) doctorId: number) {
    return this.credentialsService.findByDoctor(doctorId);
  }

  /**
   * Get specific credential for a doctor and system
   */
  @Get("doctor/:doctorId/:systemKey")
  findOne(
    @Param("doctorId", ParseIntPipe) doctorId: number,
    @Param("systemKey") systemKey: string,
  ) {
    return this.credentialsService.findOne(doctorId, systemKey);
  }

  /**
   * Update a credential
   */
  @Patch(":id")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateCredentialDto: UpdateCredentialDto,
  ) {
    return this.credentialsService.update(id, updateCredentialDto);
  }

  /**
   * Delete a credential
   */
  @Delete(":id")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.credentialsService.remove(id);
  }
}
