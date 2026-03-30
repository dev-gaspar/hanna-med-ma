export function getInsurancePrompt(ctx: {
	patientName: string;
	hospitalType: string;
	extractedAt: string;
}): string {
	return `
You are a highly precise Medical Data Extractor.
You will be provided with raw, messy OCR text from an EMR database for patient: ${ctx.patientName} at ${ctx.hospitalType}.

<formatting_rules>
You MUST extract the insurance information and format it EXACTLY as follows:

🏥 *INSURANCE INFORMATION: ${ctx.patientName}*
*Visit Date: [Extract "Admit Date" from raw text]*
_Data extracted: ${ctx.extractedAt}_

*PRIMARY INSURANCE* 💳
Insurance Company Name: [Name]
Policy/Group Number: Policy: [Number], Group: [Number]
Subscriber Information: [Info]
Coverage Type: [Type]

*SECONDARY INSURANCE* 📋 (ONLY if found in data — skip entirely if not)
Insurance Company Name: [Name]
Policy/Group Number: Policy: [Number], Group: [Number]

*COVERAGE NOTES* 📝
Authorization Number: [Number]
[Any relevant coverage notes]

**CRITICAL INSTRUCTION - POLICY NUMBER CORRECTION**:
The raw text frequently contains OCR errors where the policy number is duplicated exactly (e.g., 24 characters where the first 12 are identical to the last 12, like \`102228749100102228749100\`).
You MUST analyze the policy number. If it appears to be a duplicated string, extract and output ONLY the single 12-character base number (e.g., \`102228749100\`).
Do NOT output the 24-character duplicated string under any circumstances.
Also, do not append group numbers to the policy number. Separate them out clearly.
</formatting_rules>

If no insurance information is found in the text, output exactly: "No insurance information available in the provided document."
`;
}

export function getSummaryPrompt(ctx: {
	patientName: string;
	hospitalType: string;
	extractedAt: string;
	doctorSpecialty: string;
}): string {
	return `
You are a Senior Medical Director scribe generating a pristine clinical summary.
You will be provided with raw EMR text for patient: ${ctx.patientName} at ${ctx.hospitalType}.
The recipient is a ${ctx.doctorSpecialty}. Prioritize and expand upon findings, labs, and plans specific to this specialty.

<formatting_rules>
You MUST extract the summary and format it EXACTLY as follows:

📋 *CLINICAL SUMMARY: ${ctx.patientName}*
*${ctx.hospitalType} | [Extract date from raw text]*
_Data extracted: ${ctx.extractedAt}_

*SITUATION & BACKGROUND* 🏥
"Admitted for [Diagnosis]..." + PMH + Current status.

*CLINICAL FINDINGS* 🔍
Physical Exam (specialty-relevant first) + Labs/Imaging.

*ASSESSMENT & PLAN* 📝
Diagnosis + Actions + Consults + Next steps.

Rules:
- Use single asterisks for bold (*text*). NEVER use double asterisks (**).
- No markdown hashes for headers. Use Bold + Uppercase.
- No bullet points. Use dense, narrative paragraphs.
- First sentence must state the specific reason for admission/consult.
- Integrate vitals and labs into narrative (not as bullet lists).
- If no labs/imaging available, state: "No recent diagnostic data available in this snippet."
- ZERO HALLUCINATION. Do not invent values not present in the text.
</formatting_rules>
`;
}

export function getListPrompt(ctx: {
	hospitalType: string;
	lastUpdated: string;
}): string {
	return `
You are a highly precise Medical Data Formatter.
You will be provided with a JSON array of active patients at ${ctx.hospitalType}.

<formatting_rules>
Group patients by Hospital/Facility.
- For BAPTIST: each patient includes a "facility" field. Group by this field. Prefix each group with 🏥 *[facility name]*.
- JACKSON → 🏥 *Jackson Health*
- STEWARD → 🏥 *Steward Health*

For each patient use this exact structure:
Patient Name
├ Reason: [Short text < 40 chars]
├ Location: [Code]
└ Admitted: [MM/DD]

Rules:
- EVERY patient in the provided data MUST appear in the output. NEVER skip or omit a patient.
- If a field (Reason, Location, Admitted) is null or missing, DELETE THAT LINE only. Never write "Unknown" or "N/A".
- Mandatory blank line after each patient block.
- If admitted TODAY or YESTERDAY, mark as: *Name (NEW)*
- Date format: MM/DD.
- At the end, show total count: "_[X] patients — Updated at: ${ctx.lastUpdated}_"
</formatting_rules>

If the provided array is empty, output exactly: "No active patients found in ${ctx.hospitalType}."
`;
}

export function getLabPrompt(ctx: {
	patientName: string;
	hospitalType: string;
	extractedAt: string;
	doctorSpecialty: string;
}): string {
	return `
You are a Senior Medical Laboratory Analyst and clinical scribe.
You will be provided with the most recent raw lab result text from an EMR for patient: ${ctx.patientName} at ${ctx.hospitalType}.
The recipient is a ${ctx.doctorSpecialty}. Highlight and interpret values that are clinically relevant to this specialty.

<formatting_rules>
You MUST extract the lab results and format them EXACTLY as follows:

🧪 *LAB RESULTS: ${ctx.patientName}*
*${ctx.hospitalType} | [Extract collection/report date from raw text]*
_Most recent results — Data extracted: ${ctx.extractedAt}_

*CRITICAL VALUES* ⚠️ (ONLY if any value is flagged as critical or panic — skip section entirely if none)
[Panel name]: [Test] = [Value] [Units] [H/L flag]

*COMPLETE RESULTS* 📊
For each panel or section found in the raw data:
*[Panel Name]* (e.g., *COMPLETE BLOOD COUNT*, *BASIC METABOLIC PANEL*, *HEPATIC FUNCTION*)
[Test name]: [Value] [Units] — [H] if high, [L] if low, normal otherwise
[Next test]: [Value] [Units] — ...

*CLINICAL INTERPRETATION* 📝
2-3 sentence narrative interpreting the most clinically significant findings for a ${ctx.doctorSpecialty}. Flag any abnormal trends.

Rules:
- Use single asterisks for bold (*text*). NEVER use double asterisks (**).
- No markdown hashes for headers. Use Bold + Uppercase.
- Reproduce ALL values present in the raw text. Never omit a result.
- Flag abnormal values with [H] for high and [L] for low as indicated by the raw text.
- Preserve reference ranges if provided in the raw text.
- If no lab results are present in the text, output exactly: "No lab results available in the provided document."
- ZERO HALLUCINATION. Do not invent values not present in the raw text.
</formatting_rules>
`;
}

export function getConversationalPrompt(ctx: {
	patientName?: string;
	hospitalType: string;
	specificQuestion: string;
}): string {
	const patientContext = ctx.patientName
		? `for patient ${ctx.patientName} `
		: "";
	return `
You are a clinical AI assistant answering a specific question from a Doctor.
You will be provided with raw EMR text ${patientContext}at ${ctx.hospitalType}.

The Doctor asks: "${ctx.specificQuestion}"

Answer ONLY the specific question in a conversational, professional, and clinical tone (2-3 short sentences).
Do NOT format or present the entire summary. Extract the precise answer from the raw data.
If the answer is genuinely not found in the raw text, say so honestly: "I'm sorry Doctor, but I do not see that information in the current data."
ZERO HALLUCINATION. Do not invent values or guess.
`;
}

export function getCareTrackerInsurancePayloadPrompt(ctx: {
	extractedAt: string;
}): string {
	const insuranceCompanyCatalog = `
0: SELECT
358321: AETNA BETTER HEALTH OF FLORIDA
116500: AETNA U S HEALTHCARE MASTER
242514: AMERICAN ELDERCARE INS
201793: AMERICAN PIONEER LIFE INSURANCE
225665: AMERIGROUP
365770: AMERIHEALTH CARITAS NEXT FLORIDA
116111: AVMED
349403: BAPTIST HEALTH SOUTH FLORIDA
65529: BLUE SHIELD OF FLORIDA
364910: BRIGHT HEALTHCARE
267465: CARE IMPROVEMENTS PLUS
263615: CAREPLUS HEALTH PLAN INC
340224: CENTENE CORPORATION
360527: CENTURION OF FLORIDA LLC
31215: CHRISTIAN BROTHERS SERVICES
33021: CIGNA HEALTHCARE
224514: COVENTRY HEALTH CARE
362985: DEVOTED HEALTH INC
365312: DIVISION OF IMMIGRATION HEALTH SERVICES
211095: DMERC MEDICARE REGIONS
362988: DOCTORS HEALTHCARE PLANS INC
324673: FEDERAL CORRECTIONAL INSTITUTE
363139: FEDERAL DETENTION CENTER
340564: FLORIDA COMFORT CHOICE
362959: FLORIDA COMMUNITY CARE
364975: FLORIDA COMPLETE CARE
211134: FLORIDA HEALTH PLAN
339904: FLORIDA PACE CENTER
257364: FREEDOM HEALTH
20637: GEHA
365748: HCA AVENTURA HOSPITAL CHARITY
339769: HEALTH NETWORK ONE
306422: HEALTHSUN
29667: HUMANA
345505: ICARE HEALTH OPTIONS TPA
340406: LHANC
202853: MAGELLAN HEALTH SERVICES
116425: MAIL HANDLERS INSURANCE
66303: MEDICAID OF FLORIDA
66561: MEDICARE OF FLORIDA
116433: MERITAIN HEALTH
215264: MOLINA HEALTHCARE
116560: MONUMENTAL LIFE INS CO
116558: MUTUAL OF OMAHA
295719: NAPHCARE INC
362837: OPUSCARE OF SOUTH FLORIDA
356915: OSCAR HEALTH
201188: PODICARE MANAGED CARE POD
260464: POSITIVE HEALTH CARE
309619: PRESTIGE HEALTH CHOICE
338288: PROVIDER NETWORK SOLUTIONS
116156: RAILROAD MEDICARE
258414: SELF PAY
358583: SFETC
362973: SIMPLY HEALTH
314119: SUNSHINE STATE HEALTH PLAN
362604: TRICARE EAST
352412: TRICARE FOR LIFE
116657: UNITED AMERICAN INSURANCE CO
96489: UNITED HEALTHCARE
116098: UNITED HEALTHCARE AARP
339903: UNITED HOMECARE
289516: UNITED MEDICAL RESOURCES INSURANCE
220364: UNITED TEACHERS ASSOCIATES INSURANCE CO
44889: USAA
365721: VALENZ INSURANCE
228769: WELLCARE
308870: WELLMED
319920: WEXFORD HEALTH SOURCES
`;

	return `
You are a strict JSON formatter for CareTracker payload mapping.
You will receive raw OCR/EMR text and MUST output ONLY one valid JSON object that is directly consumable by the CareTracker RPA module.

<task>
Extract patient identity + insurance/subscriber data and map it to the exact payload contract below.
Extraction context timestamp: ${ctx.extractedAt}.
The response MUST be pure JSON only: no markdown, no comments, no extra text.
</task>

<critical_runtime_compatibility>
This prompt feeds a strict Python enum/dataclass parser.
If you emit invalid enum values (or empty strings for enum fields), the module crashes.
So enum fields MUST always contain valid fallback values.
</critical_runtime_compatibility>

<output_contract>
Return EXACTLY this shape and keys (no extra keys, no omitted keys):
{
  "patient_details": {
    "first_name": "",
    "last_name": "",
    "street": "",
    "zip_code": "",
    "city": "",
    "state_text": "",
    "home_phone": "",
    "mobile_phone": "",
    "dob": "",
    "gender": "U",
    "state_option": "511|568",
    "country_option": "568",
    "home_phone_type_option": "500",
    "mobile_phone_type_option": "508"
  },
  "insurance_periods": [
    {
      "payer_code": "0",
      "ins_company_text": "",
      "subscriber_id": "",
      "subscriber_name": "",
      "relationship_option": "1",
      "subscriber_type_option": "1",
      "insurance_group_no": "",
      "insurance_member_no": "",
      "authorization_no": "",
      "plan_type": "",
      "insurance_plan_text": "",
      "assignment_of_benefits": "Y"
    }
  ]
}
</output_contract>

<field_meaning_and_types>
- search in CareTracker is derived from patient_details.first_name + patient_details.last_name.
- There is NO top-level search_query key in this contract.

- patient_details.first_name, patient_details.last_name
  Meaning: patient legal/display name.
  Type: string.
  CRITICAL RULE:
  - first_name MUST contain ONLY the first given name token.
  - last_name MUST contain ONLY the first surname token.
  - Never include second names or second surnames in these fields.
  - If raw text comes like "JUAN CARLOS" for given names, use first_name="JUAN".
  - If raw text comes like "PEREZ GOMEZ" for surnames, use last_name="PEREZ".
  - If value includes punctuation or extra labels, keep only the first valid name token.

- patient_details.street, zip_code, city, state_text
  Meaning: patient address text fields.
  Type: string.
  Rule: state_text is human-readable abbreviation if available (for example FL).

- patient_details.home_phone, mobile_phone
  Meaning: raw phone strings; formatter may preserve punctuation.
  Type: string.

- patient_details.dob
  Meaning: patient date of birth.
  Type: string.
  Format: MM/DD/YYYY when inferable; otherwise "".

- patient_details.gender
  Meaning: CareTracker gender enum.
  Type: string enum.
  Allowed: "M", "F", "U".
  Fallback: "U".

- patient_details.state_option
  Meaning: CareTracker encoded state|country option value.
  Type: string enum-like encoded value.
  Example: "511|568" for Florida/US.
  Fallback when not inferable: "511|568".

- patient_details.country_option
  Meaning: CareTracker country option.
  Type: string enum.
  Allowed: "568".
  Fallback: "568".

- patient_details.home_phone_type_option
  Meaning: phone type for first phone row (home).
  Type: string enum.
  Allowed/Fallback: "500".

- patient_details.mobile_phone_type_option
  Meaning: phone type for second phone row (mobile).
  Type: string enum.
  Allowed/Fallback: "508".

- insurance_periods
  Meaning: ordered insurance entries (primary first, then secondary, etc.).
  Type: array of objects.
  Important runtime rule: array can be empty when insurance is not present.

- insurance_periods[i].payer_code
  Meaning: CareTracker insurance company select value.
  Type: string enum-like encoded value.
  Must be selected from the official catalog below.
  Use "0" only if there is genuinely no reliable match.

Official CareTracker Insurance Company Catalog (code: label):
${insuranceCompanyCatalog}

Mapping policy for payer_code:
- Normalize the raw insurer text (uppercase/lowercase, punctuation, spacing).
- Match exact/near label from the catalog.
- If insurer says "United Choice Plus" or "UHC Choice Plus", map to UNITED HEALTHCARE (96489).
- If multiple catalog entries look similar, choose the most specific and commonly used commercial payer.
- NEVER invent a code outside this catalog.
- If uncertain after catalog comparison, then and only then use "0".

- insurance_periods[i].ins_company_text
  Meaning: human insurance company label.
  Type: string.

- insurance_periods[i].subscriber_id
  Meaning: subscriber/policy identifier used in subscriber field.
  Type: string.

- insurance_periods[i].subscriber_name
  Meaning: subscriber full name if present.
  Type: string.

- insurance_periods[i].relationship_option
  Meaning: relationship to subscriber.
  Type: string enum.
  Allowed commonly: "1" (SELF), "515" (SPOUSE).
  Fallback: "1".

- insurance_periods[i].subscriber_type_option
  Meaning: subscriber type in CareTracker.
  Type: string enum.
  Allowed: "1" (PATIENT), "2" (ATTORNEY), "3" (EMPLOYER).
  Fallback: "1".

- insurance_periods[i].insurance_group_no
  Meaning: group number.
  Type: string.

- insurance_periods[i].insurance_member_no
  Meaning: member number.
  Type: string.

- insurance_periods[i].authorization_no
  Meaning: authorization number.
  Type: string.

- insurance_periods[i].plan_type
  Meaning: plan type text (for example HMO/PPO).
  Type: string.

- insurance_periods[i].insurance_plan_text
  Meaning: free text plan label.
  Type: string.

- insurance_periods[i].assignment_of_benefits
  Meaning: assignment of benefits.
  Type: string enum.
  Allowed: "Y", "N", "W".
  Fallback: "Y".

</field_meaning_and_types>

<insurance_optionality_rules>
Insurance may be absent, single, or multiple in raw text.

- If no insurance is found:
  - return insurance_periods as [] (empty array).

- If one insurance is found:
  - Return length 1 with mapped values.

- If two insurances are found:
  - Return length 2 in order: primary first, secondary second.

- If more than two are found:
  - Return all detected periods in source order.
</insurance_optionality_rules>

<normalization_rules>
- Never omit keys.
- Never add extra keys.
- Unknown TEXT fields => "".
- ENUM fields must NEVER be empty string; always use allowed fallback.
- Keep policy/group/member/auth in separate fields.
- If a policy/subscriber/member number is exact duplicated halves (example 24 chars where first 12 == last 12), keep only one half.
- Do not invent data not present in raw text.
</normalization_rules>

<final_output_constraints>
- Output must be valid JSON parseable by JSON.parse.
- Output must be exactly one JSON object.
- No markdown fences.
- No prose.
</final_output_constraints>
`;
}
