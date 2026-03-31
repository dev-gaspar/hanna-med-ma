from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from logger import logger

from .browser import CareTrackerBrowser
from .fixtures import CARETRACKER_CREDENTIALS
from .flows import (
    close_search_modal,
    run_login,
    run_registration_draft,
    run_search,
)
from .types import (
    AssignmentOfBenefitsOption,
    CareTrackerInsurancePeriod,
    CareTrackerPatientDetails,
    CareTrackerRegistrationPayload,
    CountryOption,
    GenderOption,
    InsuranceCompanyOption,
    InsuranceSubscriberTypeOption,
    PhoneTypeOption,
    PatientSearchQuery,
    RelationshipOption,
    StateOption,
)

ARTIFACTS_DIR = Path("artifacts") / "caretracker"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
REGISTRATION_REVIEW_WAIT_MS = 10000


def _execute_registration_on_open_page(
    page,
    browser: CareTrackerBrowser,
    payload,
    query: PatientSearchQuery,
    screenshot_prefix: str = "caretracker_registration_draft",
) -> Dict[str, Any]:
    screenshot = browser.artifact_path(screenshot_prefix)

    logger.info("[CARETRACKER] Starting login flow...")
    login_result = run_login(page, browser, CARETRACKER_CREDENTIALS)
    if not login_result.get("success"):
        return {
            "success": False,
            "message": "Login fallido",
            "login_result": login_result,
        }

    logger.info("[CARETRACKER] Login OK. Starting patient search...")
    search_result = run_search(page, query)
    if not search_result.get("success"):
        return {
            "success": False,
            "message": "Busqueda fallida",
            "search_result": search_result,
        }
    if search_result.get("status") != "NOT_FOUND":
        matches = search_result.get("matches", [])
        patient_emr_id = matches[0].get("entity_id") if matches else None
        return {
            "success": True,
            "message": "Paciente encontrado, se omite registro.",
            "status": search_result.get("status"),
            "search_result": search_result,
            "patient_emr_id": patient_emr_id,
            "saved": False,
        }

    logger.info("[CARETRACKER] Patient NOT_FOUND. Opening registration form...")
    close_search_modal(page, page)
    include_insurance = len(payload.insurance_periods) > 0
    draft = run_registration_draft(
        page,
        payload,
        include_insurance=include_insurance,
    )
    page.screenshot(path=str(screenshot), full_page=True)
    logger.info("[CARETRACKER] Waiting 10s after registration fill...")
    page.wait_for_timeout(REGISTRATION_REVIEW_WAIT_MS)
    return {
        "success": draft.get("success", False),
        "message": "Formulario completado en borrador (sin guardar).",
        "include_insurance": include_insurance,
        "insurance_period_count": len(payload.insurance_periods),
        "status": "NOT_FOUND",
        "filled_fields": draft.get("filled_fields", {}),
        "screenshot": str(screenshot),
        "saved": False,
    }


def _build_patient_details(data: Dict[str, Any]) -> CareTrackerPatientDetails:
    return CareTrackerPatientDetails(
        first_name=str(data.get("first_name", "")).strip(),
        last_name=str(data.get("last_name", "")).strip(),
        street=str(data.get("street", "")).strip(),
        zip_code=str(data.get("zip_code", "")).strip(),
        city=str(data.get("city", "")).strip(),
        state_text=str(data.get("state_text", "")).strip(),
        home_phone=str(data.get("home_phone", "")).strip(),
        mobile_phone=str(data.get("mobile_phone", "")).strip(),
        dob=str(data.get("dob", "")).strip(),
        gender=GenderOption(str(data.get("gender", GenderOption.MALE.value))),
        state_option=StateOption(str(data.get("state_option", StateOption.FL.value))),
        country_option=CountryOption(
            str(data.get("country_option", CountryOption.UNITED_STATES.value))
        ),
        home_phone_type_option=PhoneTypeOption(
            str(data.get("home_phone_type_option", PhoneTypeOption.HOME.value))
        ),
        mobile_phone_type_option=PhoneTypeOption(
            str(data.get("mobile_phone_type_option", PhoneTypeOption.MOBILE.value))
        ),
    )


def _build_insurance_period(data: Dict[str, Any]) -> CareTrackerInsurancePeriod:
    ins_company_text = str(data.get("ins_company_text", "")).strip()
    plan_type = str(data.get("plan_type", "")).strip()
    insurance_plan_text = str(data.get("insurance_plan_text", "")).strip()

    return CareTrackerInsurancePeriod(
        payer_code=InsuranceCompanyOption(str(data.get("payer_code", ""))),
        ins_company_text=ins_company_text,
        subscriber_id=str(data.get("subscriber_id", "")).strip(),
        subscriber_name=str(data.get("subscriber_name", "")).strip(),
        relationship_option=RelationshipOption(
            str(data.get("relationship_option", RelationshipOption.SELF.value))
        ),
        subscriber_type_option=InsuranceSubscriberTypeOption(
            str(
                data.get(
                    "subscriber_type_option",
                    InsuranceSubscriberTypeOption.PATIENT.value,
                )
            )
        ),
        insurance_group_no=str(data.get("insurance_group_no", "")).strip(),
        insurance_member_no=str(data.get("insurance_member_no", "")).strip(),
        authorization_no=str(data.get("authorization_no", "")).strip(),
        plan_type=plan_type,
        insurance_plan_text=insurance_plan_text,
        assignment_of_benefits=AssignmentOfBenefitsOption(
            str(
                data.get("assignment_of_benefits", AssignmentOfBenefitsOption.YES.value)
            )
        ),
    )


def parse_registration_payload(
    patient_data: Dict[str, Any],
) -> CareTrackerRegistrationPayload:
    data = patient_data
    patient_details_data = data.get("patient_details") or {}
    insurance_periods_data = data.get("insurance_periods") or []

    patient_details = _build_patient_details(patient_details_data)
    if not isinstance(insurance_periods_data, list):
        raise ValueError("insurance_periods debe ser un arreglo")

    insurance_periods = [
        _build_insurance_period(item or {}) for item in insurance_periods_data
    ]

    payload = CareTrackerRegistrationPayload(
        patient_details=patient_details,
        insurance_periods=insurance_periods,
    )
    return payload


def run_registration(
    payload: CareTrackerRegistrationPayload,
    search_query_data: Dict[str, Any] | None = None,
    headless: bool = False,
) -> Dict[str, Any]:
    """
    Ejecuta el flujo completo usando entrada tipada.
    search_query_data contains simplified first/last name (lowercase, first token only)
    for searching, while patient_details has the full names for registration.
    """
    if search_query_data and search_query_data.get("first_name") and search_query_data.get("last_name"):
        query = PatientSearchQuery(
            first_name=str(search_query_data["first_name"]).strip(),
            last_name=str(search_query_data["last_name"]).strip(),
        )
        logger.info(f"[CARETRACKER] Using search_query for search: '{query.first_name} {query.last_name}' "
                     f"(full name: '{payload.patient_details.first_name} {payload.patient_details.last_name}')")
    else:
        query = PatientSearchQuery(
            first_name=payload.patient_details.first_name,
            last_name=payload.patient_details.last_name,
        )
        logger.info(f"[CARETRACKER] No search_query provided, using patient_details for search: "
                     f"'{query.first_name} {query.last_name}'")

    return _run_registration_with_payload(
        query=query,
        payload=payload,
        headless=headless,
    )


def _run_registration_with_payload(
    query: PatientSearchQuery,
    payload: CareTrackerRegistrationPayload,
    headless: bool = False,
) -> Dict[str, Any]:
    browser = CareTrackerBrowser(headless=headless, artifacts_dir=ARTIFACTS_DIR)
    page = browser.open()
    try:
        return _execute_registration_on_open_page(
            page=page,
            browser=browser,
            payload=payload,
            query=query,
        )
    except Exception as exc:
        return {
            "success": False,
            "message": f"Error en flujo de registro: {exc}",
            "saved": False,
        }
    finally:
        browser.close()
