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
    FindPatientContextTool,
  ],
  exports: [AiService],
})
export class AiModule {}
