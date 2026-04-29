import { OmitType, PartialType } from "@nestjs/swagger";
import { CreatePlaceOfServiceCodeDto } from "./create-pos-code.dto";

/**
 * `code` is the primary key — once a row exists, the code itself
 * isn't editable. Admins can rename/relabel/deactivate everything
 * else.
 */
export class UpdatePlaceOfServiceCodeDto extends PartialType(
  OmitType(CreatePlaceOfServiceCodeDto, ["code"] as const),
) {}
