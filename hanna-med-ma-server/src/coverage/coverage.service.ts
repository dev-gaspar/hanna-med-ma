import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";

/**
 * Regulatory-engine service. First responsibility: serve localized Medicare
 * Physician Fee Schedule lookups. LCD / NCCI / MUE capabilities land here as
 * they're ingested.
 */
@Injectable()
export class CoverageService {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Resolve the localized MPFS payment for a CPT in a given locality/year.
	 * `modifier` is optional — when provided we try the exact modifier first
	 * and fall back to the unmodified row so callers can pass e.g. "26"
	 * without having to know up front whether a 26-specific row exists.
	 */
	async findFee(params: {
		cpt: string;
		locality: string;
		state?: string;
		year: number;
		modifier?: string;
	}) {
		const { cpt, locality, year } = params;
		const state = (params.state || "FL").toUpperCase();
		// Empty string stands in for "no modifier" so the compound unique works.
		const modifier = params.modifier || "";

		const loc = await this.prisma.locality.findUnique({
			where: { code_state_year: { code: locality, state, year } },
		});
		if (!loc) {
			throw new NotFoundException(
				`Locality ${state}-${locality} for ${year} not loaded`,
			);
		}

		// Exact modifier first; fall back to the no-modifier ("") row.
		const row =
			(await this.prisma.feeScheduleItem.findUnique({
				where: {
					cpt_modifier_localityId_year: {
						cpt,
						modifier,
						localityId: loc.id,
						year,
					},
				},
			})) ||
			(modifier === ""
				? null
				: await this.prisma.feeScheduleItem.findUnique({
						where: {
							cpt_modifier_localityId_year: {
								cpt,
								modifier: "",
								localityId: loc.id,
								year,
							},
						},
					}));

		if (!row) {
			throw new NotFoundException(
				`No MPFS row for CPT ${cpt}${modifier ? `-${modifier}` : ""} at ${state}-${locality} (${year})`,
			);
		}

		return {
			cpt: row.cpt,
			modifier: row.modifier,
			year: row.year,
			description: row.description,
			locality: {
				code: loc.code,
				state: loc.state,
				description: loc.description,
				macContractor: loc.macContractor,
				gpci: {
					work: loc.workGpci,
					pe: loc.peGpci,
					mp: loc.mpGpci,
				},
			},
			rvu: {
				work: row.workRvu,
				pe: row.peRvu,
				peFacility: row.peFacilityRvu,
				mp: row.mpRvu,
			},
			conversionFactor: row.conversionFactor,
			amount: {
				nonFacility: row.amountUsd,
				facility: row.amountFacilityUsd,
			},
			globalDays: row.globalDays,
			statusCode: row.statusCode,
		};
	}
}
