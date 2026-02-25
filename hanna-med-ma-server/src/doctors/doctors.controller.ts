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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { DoctorsService } from "./doctors.service";
import { CreateDoctorDto } from "./dto/create-doctor.dto";
import { UpdateDoctorDto } from "./dto/update-doctor.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Doctors")
@Controller("doctors")
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Create a new doctor" })
  @ApiBody({ type: CreateDoctorDto })
  @ApiResponse({ status: 201, description: "Doctor created successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  create(@Body() createDoctorDto: CreateDoctorDto) {
    return this.doctorsService.create(createDoctorDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get all doctors" })
  @ApiResponse({ status: 200, description: "List of doctors" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  findAll() {
    return this.doctorsService.findAll();
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get doctor by ID" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Doctor found" })
  @ApiResponse({ status: 404, description: "Doctor not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.doctorsService.findOne(id);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Update doctor" })
  @ApiParam({ name: "id", type: "number" })
  @ApiBody({ type: UpdateDoctorDto })
  @ApiResponse({ status: 200, description: "Doctor updated successfully" })
  @ApiResponse({ status: 404, description: "Doctor not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateDoctorDto: UpdateDoctorDto,
  ) {
    return this.doctorsService.update(id, updateDoctorDto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Delete doctor" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Doctor deleted successfully" })
  @ApiResponse({ status: 404, description: "Doctor not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.doctorsService.remove(id);
  }
}
