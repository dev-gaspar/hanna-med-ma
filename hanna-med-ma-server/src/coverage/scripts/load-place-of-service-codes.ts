/**
 * CMS Place-of-Service code loader.
 *
 * Source: https://www.cms.gov/Medicare/Coding/place-of-service-codes/Place_of_Service_Code_Set
 *   Captured: 2026-04-29 (CMS POS list is updated rarely — last
 *   meaningful change was the addition of code 10 in 2022, code 17
 *   restructuring in 2017. Re-run this loader when CMS publishes a
 *   change announcement; otherwise the catalog is stable.)
 *
 * The list below excludes "Unassigned" placeholders (27-30, 35-40,
 * 43-48, 59, 63-64, 66-70, 73-80, 82-98) since they cannot appear
 * on a claim. Codes already retired by CMS are loaded with
 * `active=false` so historical encounters that referenced them
 * still resolve.
 *
 * Run:  npx ts-node -r dotenv/config src/coverage/scripts/load-place-of-service-codes.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface PosSeed {
  code: string;
  name: string;
  shortLabel: string;
  description: string;
  active?: boolean;
}

const CMS_POS_CODES: PosSeed[] = [
  {
    code: "01",
    name: "Pharmacy",
    shortLabel: "Pharmacy",
    description:
      "A facility or location where drugs and other medically related items and services are sold, dispensed, or otherwise provided directly to patients.",
  },
  {
    code: "02",
    name: "Telehealth Provided Other than in Patient's Home",
    shortLabel: "Telehealth",
    description:
      "The location where health services and health related services are provided or received, through telecommunication technology. Patient is not located in their home when receiving health services or health related services through telecommunication technology.",
  },
  {
    code: "03",
    name: "School",
    shortLabel: "School",
    description:
      "A facility whose primary purpose is education.",
  },
  {
    code: "04",
    name: "Homeless Shelter",
    shortLabel: "Shelter",
    description:
      "A facility or location whose primary purpose is to provide temporary housing to homeless individuals (e.g., emergency shelters, transitional housing).",
  },
  {
    code: "05",
    name: "Indian Health Service Free-standing Facility",
    shortLabel: "IHS Free-std",
    description:
      "A facility or location, owned and operated by the Indian Health Service, which provides diagnostic, therapeutic (surgical and non-surgical), and rehabilitation services to American Indians and Alaska Natives who do not require hospitalization.",
  },
  {
    code: "06",
    name: "Indian Health Service Provider-based Facility",
    shortLabel: "IHS Hosp",
    description:
      "A facility or location, owned and operated by the Indian Health Service, which provides diagnostic, therapeutic (surgical and non-surgical), and rehabilitation services rendered by, or under the supervision of, physicians to American Indians and Alaska Natives admitted as inpatients or outpatients.",
  },
  {
    code: "07",
    name: "Tribal 638 Free-standing Facility",
    shortLabel: "Tribal Free-std",
    description:
      "A facility or location owned and operated by a federally recognized American Indian or Alaska Native tribe or tribal organization under a 638 agreement, which provides diagnostic, therapeutic (surgical and non-surgical), and rehabilitation services to tribal members who do not require hospitalization.",
  },
  {
    code: "08",
    name: "Tribal 638 Provider-based Facility",
    shortLabel: "Tribal Hosp",
    description:
      "A facility or location owned and operated by a federally recognized American Indian or Alaska Native tribe or tribal organization under a 638 agreement, which provides diagnostic, therapeutic (surgical and non-surgical), and rehabilitation services to tribal members admitted as inpatients or outpatients.",
  },
  {
    code: "09",
    name: "Prison/Correctional Facility",
    shortLabel: "Prison",
    description:
      "A prison, jail, reformatory, work farm, detention center, or any other similar facility maintained by either federal, state or local authorities for the purpose of confinement or rehabilitation of adult or juvenile criminal offenders.",
  },
  {
    code: "10",
    name: "Telehealth Provided in Patient's Home",
    shortLabel: "Telehealth Home",
    description:
      "The location where health services and health related services are provided or received through telecommunication technology. Patient is located in their home (which is a location other than a hospital or other facility where the patient receives care in a private residence) when receiving health services or health related services through telecommunication technology.",
  },
  {
    code: "11",
    name: "Office",
    shortLabel: "Office",
    description:
      "Location, other than a hospital, skilled nursing facility (SNF), military treatment facility, community health center, State or local public health clinic, or intermediate care facility (ICF), where the health professional routinely provides health examinations, diagnosis, and treatment of illness or injury on an ambulatory basis.",
  },
  {
    code: "12",
    name: "Home",
    shortLabel: "Home",
    description:
      "Location, other than a hospital or other facility, where the patient receives care in a private residence.",
  },
  {
    code: "13",
    name: "Assisted Living Facility",
    shortLabel: "Assisted Living",
    description:
      "Congregate residential facility with self-contained living units providing assessment of each resident's needs and on-site support 24 hours a day, 7 days a week, with the capacity to deliver or arrange for services including some health care and other services.",
  },
  {
    code: "14",
    name: "Group Home",
    shortLabel: "Group Home",
    description:
      "A residence, with shared living areas, where clients receive supervision and other services such as social and/or behavioral services, custodial service, and minimal services (e.g., medication administration).",
  },
  {
    code: "15",
    name: "Mobile Unit",
    shortLabel: "Mobile Unit",
    description:
      "A facility/unit that moves from place-to-place equipped to provide preventive, screening, diagnostic, and/or treatment services.",
  },
  {
    code: "16",
    name: "Temporary Lodging",
    shortLabel: "Temp Lodging",
    description:
      "A short term accommodation such as a hotel, camp ground, hostel, cruise ship or resort where the patient receives care, and which is not identified by any other POS code.",
  },
  {
    code: "17",
    name: "Walk-in Retail Health Clinic",
    shortLabel: "Retail Clinic",
    description:
      "A walk-in health clinic, other than an office, urgent care facility, pharmacy or independent clinic and not described by any other Place of Service code, that is located within a retail operation and provides, on an ambulatory basis, preventive and primary care services.",
  },
  {
    code: "18",
    name: "Place of Employment-Worksite",
    shortLabel: "Worksite",
    description:
      "A location, not described by any other POS code, owned or operated by a public or private entity where the patient is employed, and where a health professional provides ongoing or episodic occupational medical, therapeutic or rehabilitative services to the individual.",
  },
  {
    code: "19",
    name: "Off Campus-Outpatient Hospital",
    shortLabel: "Off-Campus OP",
    description:
      "A portion of an off-campus hospital provider based department which provides diagnostic, therapeutic (both surgical and nonsurgical), and rehabilitation services to sick or injured persons who do not require hospitalization or institutionalization.",
  },
  {
    code: "20",
    name: "Urgent Care Facility",
    shortLabel: "Urgent Care",
    description:
      "Location, distinct from a hospital emergency room, an office, or a clinic, whose purpose is to diagnose and treat illness or injury for unscheduled, ambulatory patients seeking immediate medical attention.",
  },
  {
    code: "21",
    name: "Inpatient Hospital",
    shortLabel: "Inpatient",
    description:
      "A facility, other than psychiatric, which primarily provides diagnostic, therapeutic (both surgical and nonsurgical), and rehabilitation services by, or under, the supervision of physicians to patients admitted for a variety of medical conditions.",
  },
  {
    code: "22",
    name: "On Campus-Outpatient Hospital",
    shortLabel: "Outpatient",
    description:
      "A portion of a hospital's main campus which provides diagnostic, therapeutic (both surgical and nonsurgical), and rehabilitation services to sick or injured persons who do not require hospitalization or institutionalization.",
  },
  {
    code: "23",
    name: "Emergency Room - Hospital",
    shortLabel: "ER",
    description:
      "A portion of a hospital where emergency diagnosis and treatment of illness or injury is provided.",
  },
  {
    code: "24",
    name: "Ambulatory Surgical Center",
    shortLabel: "ASC",
    description:
      "A freestanding facility, other than a physician's office, where surgical and diagnostic services are provided on an ambulatory basis.",
  },
  {
    code: "25",
    name: "Birthing Center",
    shortLabel: "Birthing Ctr",
    description:
      "A facility, other than a hospital's maternity facilities or a physician's office, which provides a setting for labor, delivery, and immediate post-partum care as well as immediate care of new born infants.",
  },
  {
    code: "26",
    name: "Military Treatment Facility",
    shortLabel: "Military",
    description:
      "A medical facility operated by one or more of the Uniformed Services. Military Treatment Facility (MTF) also refers to certain former U.S. Public Health Service (USPHS) facilities now designated as Uniformed Service Treatment Facilities (USTF).",
  },
  {
    code: "31",
    name: "Skilled Nursing Facility",
    shortLabel: "SNF",
    description:
      "A facility which primarily provides inpatient skilled nursing care and related services to patients who require medical, nursing, or rehabilitative services but does not provide the level of care or treatment available in a hospital.",
  },
  {
    code: "32",
    name: "Nursing Facility",
    shortLabel: "Nursing Fac",
    description:
      "A facility which primarily provides to residents skilled nursing care and related services for the rehabilitation of injured, disabled, or sick persons, or, on a regular basis, health-related care services above the level of custodial care to other than individuals with intellectual disabilities.",
  },
  {
    code: "33",
    name: "Custodial Care Facility",
    shortLabel: "Custodial",
    description:
      "A facility which provides room, board and other personal assistance services, generally on a long-term basis, and which does not include a medical component.",
  },
  {
    code: "34",
    name: "Hospice",
    shortLabel: "Hospice",
    description:
      "A facility, other than a patient's home, in which palliative and supportive care for terminally ill patients and their families are provided.",
  },
  {
    code: "41",
    name: "Ambulance - Land",
    shortLabel: "Ambulance",
    description:
      "A land vehicle specifically designed, equipped and staffed for lifesaving and transporting the sick or injured.",
  },
  {
    code: "42",
    name: "Ambulance - Air or Water",
    shortLabel: "Air Ambul.",
    description:
      "An air or water vehicle specifically designed, equipped and staffed for lifesaving and transporting the sick or injured.",
  },
  {
    code: "49",
    name: "Independent Clinic",
    shortLabel: "Indep Clinic",
    description:
      "A location, not part of a hospital and not described by any other Place of Service code, that is organized and operated to provide preventive, diagnostic, therapeutic, rehabilitative, or palliative services to outpatients only.",
  },
  {
    code: "50",
    name: "Federally Qualified Health Center",
    shortLabel: "FQHC",
    description:
      "A facility located in a medically underserved area that provides Medicare beneficiaries preventive primary medical care under the general direction of a physician.",
  },
  {
    code: "51",
    name: "Inpatient Psychiatric Facility",
    shortLabel: "IP Psych",
    description:
      "A facility that provides inpatient psychiatric services for the diagnosis and treatment of mental illness on a 24-hour basis, by or under the supervision of a physician.",
  },
  {
    code: "52",
    name: "Psychiatric Facility-Partial Hospitalization",
    shortLabel: "Partial Hosp",
    description:
      "A facility for the diagnosis and treatment of mental illness that provides a planned therapeutic program for patients who do not require full time hospitalization, but who need broader programs than are possible from outpatient visits to a hospital-based or hospital-affiliated facility.",
  },
  {
    code: "53",
    name: "Community Mental Health Center",
    shortLabel: "CMHC",
    description:
      "A facility that provides comprehensive mental health services on an ambulatory basis primarily to individuals residing or employed in a defined area.",
  },
  {
    code: "54",
    name: "Intermediate Care Facility/Individuals with Intellectual Disabilities",
    shortLabel: "ICF/IID",
    description:
      "A facility which primarily provides health-related care and services above the level of custodial care to individuals but does not provide the level of care or treatment available in a hospital or SNF.",
  },
  {
    code: "55",
    name: "Residential Substance Abuse Treatment Facility",
    shortLabel: "Res SUD",
    description:
      "A facility which provides treatment for substance (alcohol and drug) abuse to live-in residents who do not require acute medical care. Services include individual and group therapy and counseling, family counseling, laboratory tests, drugs and supplies, psychological testing, and room and board.",
  },
  {
    code: "56",
    name: "Psychiatric Residential Treatment Center",
    shortLabel: "Psych Res",
    description:
      "A facility or distinct part of a facility for psychiatric care which provides a total 24-hour therapeutically planned and professionally staffed group living and learning environment.",
  },
  {
    code: "57",
    name: "Non-residential Substance Abuse Treatment Facility",
    shortLabel: "Non-res SUD",
    description:
      "A location which provides treatment for substance (alcohol and drug) abuse on an ambulatory basis. Services include individual and group therapy and counseling, family counseling, laboratory tests, drugs and supplies, and psychological testing.",
  },
  {
    code: "58",
    name: "Non-residential Opioid Treatment Facility",
    shortLabel: "Non-res Opioid",
    description:
      "A location that provides treatment for opioid use disorder on an ambulatory basis. Services include methadone and other forms of medication assisted treatment (MAT).",
  },
  {
    code: "60",
    name: "Mass Immunization Center",
    shortLabel: "Mass Immun.",
    description:
      "A location where providers administer pneumococcal pneumonia and influenza virus vaccinations and submit these services as electronic media claims, paper claims, or using the roster billing method.",
  },
  {
    code: "61",
    name: "Comprehensive Inpatient Rehabilitation Facility",
    shortLabel: "IRF",
    description:
      "A facility that provides comprehensive rehabilitation services under the supervision of a physician to inpatients with physical disabilities. Services include physical therapy, occupational therapy, speech pathology, social or psychological services, and orthotics and prosthetics services.",
  },
  {
    code: "62",
    name: "Comprehensive Outpatient Rehabilitation Facility",
    shortLabel: "CORF",
    description:
      "A facility that provides comprehensive rehabilitation services under the supervision of a physician to outpatients with physical disabilities. Services include physical therapy, occupational therapy, and speech pathology services.",
  },
  {
    code: "65",
    name: "End-Stage Renal Disease Treatment Facility",
    shortLabel: "ESRD",
    description:
      "A facility other than a hospital, which provides dialysis treatment, maintenance, and/or training to patients or caregivers on an ambulatory or home-care basis.",
  },
  {
    code: "71",
    name: "Public Health Clinic",
    shortLabel: "Public Health",
    description:
      "A facility maintained by either State or local health departments that provides ambulatory primary medical care under the general direction of a physician.",
  },
  {
    code: "72",
    name: "Rural Health Clinic",
    shortLabel: "Rural Clinic",
    description:
      "A certified facility which is located in a rural medically underserved area that provides ambulatory primary medical care under the general direction of a physician.",
  },
  {
    code: "81",
    name: "Independent Laboratory",
    shortLabel: "Lab",
    description:
      "A laboratory certified to perform diagnostic and/or clinical tests independent of an institution or a physician's office.",
  },
  {
    code: "99",
    name: "Other Place of Service",
    shortLabel: "Other",
    description:
      "Other place of service not identified above.",
  },
];

async function main() {
  console.log(`Loading ${CMS_POS_CODES.length} CMS POS codes...`);

  let created = 0;
  let updated = 0;
  for (const seed of CMS_POS_CODES) {
    const existing = await prisma.placeOfServiceCode.findUnique({
      where: { code: seed.code },
    });
    await prisma.placeOfServiceCode.upsert({
      where: { code: seed.code },
      update: {
        name: seed.name,
        shortLabel: seed.shortLabel,
        description: seed.description,
        active: seed.active ?? true,
      },
      create: {
        code: seed.code,
        name: seed.name,
        shortLabel: seed.shortLabel,
        description: seed.description,
        active: seed.active ?? true,
      },
    });
    if (existing) updated += 1;
    else created += 1;
  }

  const total = await prisma.placeOfServiceCode.count();
  const active = await prisma.placeOfServiceCode.count({
    where: { active: true },
  });
  console.log(
    `Done. ${created} created, ${updated} updated. Catalog size: ${total} (${active} active).`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
