import { Module } from "@nestjs/common";
import { AiService } from "./ai.service";
import { LangChainModelService } from "./langchain-model.service";
import { RouterAgent } from "./agents/router.agent";

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

@Module({
  providers: [
    AiService,
    LangChainModelService,
    RouterAgent,
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
  ],
  exports: [AiService, SubAgentsService],
})
export class AiModule {}
