import { Module } from "@nestjs/common";
import { AiService } from "./ai.service";
import { LangChainModelService } from "./langchain-model.service";
import { RouterAgent } from "./agents/router.agent";
import { CoderAgent } from "./agents/coder.agent";
import { CoverageModule } from "../coverage/coverage.module";

import {
  PatientListTool,
  BatchPatientListTool,
} from "./tools/patient-list.tools";
import {
  PatientSummaryTool,
  BatchPatientSummaryTool,
} from "./tools/patient-summary.tools";
import {
  PatientInsuranceTool,
  BatchPatientInsuranceTool,
} from "./tools/patient-insurance.tools";
import { FindPatientContextTool } from "./tools/find-patient-context.tool";
import { PatientLabTool, BatchPatientLabTool } from "./tools/patient-lab.tools";
import { SubAgentsService } from "./agents/sub-agents.service";
import { PatientSeenTool } from "./tools/patient-seen.tools";

@Module({
  imports: [CoverageModule],
  providers: [
    AiService,
    LangChainModelService,
    RouterAgent,
    CoderAgent,
    PatientListTool,
    BatchPatientListTool,
    PatientSummaryTool,
    BatchPatientSummaryTool,
    PatientInsuranceTool,
    BatchPatientInsuranceTool,
    PatientLabTool,
    BatchPatientLabTool,
    FindPatientContextTool,
    SubAgentsService,
    PatientSeenTool,
  ],
  exports: [AiService, SubAgentsService, CoderAgent],
})
export class AiModule {}
