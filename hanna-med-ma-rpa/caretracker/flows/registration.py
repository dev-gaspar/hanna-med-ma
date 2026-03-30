from __future__ import annotations

from typing import Any, Dict

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError
from logger import logger

from ..browser import CareTrackerBrowser
from ..types import INSURANCE_COMPANY_ALIASES, PatientRegistrationPayload

MODAL_APPEAR_WINDOW_MS = 1500
MODAL_SETTLE_TIMEOUT_MS = 15000
MODAL_POLL_MS = 100
MODAL_STABLE_TICKS = 4
POST_LOADING_READY_TIMEOUT_MS = 5000


def _is_loading_modal_visible(host: Page) -> bool:
    probe_js = """
        () => {
            try {
                if (
                    window.Sys &&
                    window.Sys.WebForms &&
                    window.Sys.WebForms.PageRequestManager &&
                    window.Sys.WebForms.PageRequestManager.getInstance
                ) {
                    const prm = window.Sys.WebForms.PageRequestManager.getInstance();
                    if (prm && prm.get_isInAsyncPostBack && prm.get_isInAsyncPostBack()) {
                        return true;
                    }
                }
            } catch (e) {}

            const selectors = [
                "#DemographicsUpdateProgress",
                "[id*='_updProgressForLoadInsPlans']",
                "[id*='_updProgressForAddAddress_']",
                "[id*='_updProgressForAddPhone_']",
                ".ui-dialog:visible",
                ".ui-widget-overlay:visible"
            ];
            for (const sel of selectors) {
                const nodes = Array.from(document.querySelectorAll(sel));
                for (const n of nodes) {
                    const s = window.getComputedStyle(n);
                    if (s && s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0") {
                        return true;
                    }
                }
            }
            return false;
        }
        """
    for frame in host.frames:
        try:
            if frame.evaluate(probe_js):
                return True
        except Exception:
            continue
    return False


def _observe_loading_after_step(host: Page) -> bool:
    elapsed = 0
    seen_loading = False

    # Wait briefly for async postback/modal to appear after the triggering action.
    while elapsed < MODAL_APPEAR_WINDOW_MS:
        if _is_loading_modal_visible(host):
            seen_loading = True
            break
        host.wait_for_timeout(MODAL_POLL_MS)
        elapsed += MODAL_POLL_MS

    if not seen_loading:
        return False

    # If modal appeared, wait until it is stably gone to avoid skipping the next field.
    elapsed = 0
    stable_ticks = 0
    while elapsed < MODAL_SETTLE_TIMEOUT_MS:
        if _is_loading_modal_visible(host):
            stable_ticks = 0
        else:
            stable_ticks += 1
            if stable_ticks >= MODAL_STABLE_TICKS:
                return True
        host.wait_for_timeout(MODAL_POLL_MS)
        elapsed += MODAL_POLL_MS

    return True


def _run_step(
    host: Page,
    fields: Dict[str, bool],
    key: str,
    action,
    wait_for_loading: bool = False,
    post_ready_selectors: list[str] | None = None,
    attempts: int = 1,
) -> None:
    ok = False
    for i in range(max(1, attempts)):
        ok = bool(action())
        if ok:
            break
        if i < attempts - 1:
            host.wait_for_timeout(150)
    fields[key] = ok
    loading_seen = _observe_loading_after_step(host) if wait_for_loading else False
    fields[f"{key}.loading_modal"] = loading_seen
    if loading_seen:
        logger.info("[CARETRACKER] Loading modal detected after step: %s", key)
    if post_ready_selectors and ok:
        ready = CareTrackerBrowser.wait_for_any_selector(
            host,
            post_ready_selectors,
            timeout_ms=POST_LOADING_READY_TIMEOUT_MS,
            require_enabled=True,
        )
        fields[f"{key}.post_ready"] = ready


def _settle_after_name_entry(
    host: Page, first_name: str, last_name: str
) -> Dict[str, bool]:
    result: Dict[str, bool] = {}
    _run_step(
        host,
        result,
        "patient_details.first_name",
        lambda: CareTrackerBrowser.fill_first(host, ["#txtFirstName"], first_name),
    )
    _run_step(
        host,
        result,
        "patient_details.last_name",
        lambda: CareTrackerBrowser.fill_first(host, ["#txtLastName"], last_name),
    )

    # Trigger onblur/onchange validation path used by CareTracker after typing name.
    name_frame = CareTrackerBrowser.first_frame_with_selector(host, "#txtLastName")
    if name_frame is not None:
        try:
            name_frame.locator("#txtLastName").first.press("Tab")
        except Exception:
            try:
                name_frame.evaluate(
                    """() => {
                      const ln = document.getElementById('txtLastName');
                      if (!ln) return;
                      ln.dispatchEvent(new Event('change', { bubbles: true }));
                      ln.dispatchEvent(new Event('blur', { bubbles: true }));
                    }"""
                )
            except Exception:
                pass

    result["patient_details.name_validation_preserved"] = True

    return result


def _get_selected_option(host: Page, selectors: list[str]) -> dict[str, str]:
    for frame in host.frames:
        for sel in selectors:
            try:
                loc = frame.locator(sel)
                if loc.count() == 0:
                    continue
                option = loc.first.locator("option:checked").first
                if option.count() == 0:
                    continue
                return {
                    "value": (option.get_attribute("value") or "").strip(),
                    "text": (option.inner_text() or "").strip(),
                }
            except Exception:
                continue
    return {"value": "", "text": ""}


def _set_select_value_js(host: Page, ids: list[str], value: str) -> bool:
    payload = {"ids": ids, "value": value}
    for frame in host.frames:
        try:
            ok = frame.evaluate(
                """
                ({ ids, value }) => {
                  for (const id of ids) {
                    const el = document.getElementById(id);
                    if (!el || el.tagName !== "SELECT") continue;
                    el.disabled = false;
                    el.value = value;
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                    if (el.value === value) return true;
                  }
                  return false;
                }
                """,
                payload,
            )
            if ok:
                return True
        except Exception:
            continue
    return False


def _set_select_value_by_suffix_js(host: Page, id_suffix: str, value: str) -> bool:
    payload = {"idSuffix": id_suffix, "value": value}
    for frame in host.frames:
        try:
            ok = frame.evaluate(
                """
                ({ idSuffix, value }) => {
                  const sel = document.querySelector(`select[id$='${idSuffix}']`);
                  if (!sel) return false;
                  sel.disabled = false;
                  sel.value = value;
                  sel.dispatchEvent(new Event("input", { bubbles: true }));
                  sel.dispatchEvent(new Event("change", { bubbles: true }));
                  return sel.value === value;
                }
                """,
                payload,
            )
            if ok:
                return True
        except Exception:
            continue
    return False


def _get_select_value_by_suffix(host: Page, id_suffix: str) -> str:
    for frame in host.frames:
        try:
            value = frame.evaluate(
                """
                (suffix) => {
                  const sel = document.querySelector(`select[id$='${suffix}']`);
                  return sel ? (sel.value || "") : "";
                }
                """,
                id_suffix,
            )
            if value:
                return str(value).strip()
        except Exception:
            continue
    return ""


def _set_mobile_phone_type(host: Page, expected_value: str) -> bool:
    selectors = ["select[id$='_ddlPhoneType_1']"]
    if not CareTrackerBrowser.wait_for_any_selector(
        host,
        selectors,
        timeout_ms=POST_LOADING_READY_TIMEOUT_MS,
        require_enabled=True,
    ):
        return False

    if CareTrackerBrowser.select_first(host, selectors, value=expected_value):
        return True

    if _get_select_value_by_suffix(host, "_ddlPhoneType_1") == expected_value:
        return True

    return _set_select_value_by_suffix_js(host, "_ddlPhoneType_1", expected_value)


def _add_secondary_insurance_row(host: Page, expected_index: int) -> bool:
    add_selectors = [
        "#ctl00_MainContent_ucPatientDetail_dlPatient_ctl00_lvPatientEdit_lbAddInsurancePlan",
        "a[title='Add Insurance Plan']",
    ]
    if not CareTrackerBrowser.click_first(host, add_selectors):
        return False
    return True


def _fill_insurance_period(host: Page, index: int, period) -> Dict[str, bool]:
    row_prefix = f"insurance_periods.{index}"
    row_token = f"lvPatientEdit_ctrl{index}_"
    fields: Dict[str, bool] = {}

    aliases = list(INSURANCE_COMPANY_ALIASES.get(period.payer_code, ()))
    if period.ins_company_text:
        aliases.append(period.ins_company_text)
    insurance_company_selectors = [
        f"select[id*='{row_token}ddlInsuranceCompany']",
        "select[id*='ddlInsuranceCompany']" if index == 0 else "",
    ]
    insurance_company_selectors = [s for s in insurance_company_selectors if s]
    # Prefer exact enum value from live select catalog.
    _run_step(
        host,
        fields,
        f"{row_prefix}.ins_company",
        lambda: (
            CareTrackerBrowser.select_first(
                host,
                insurance_company_selectors,
                value=period.payer_code.value,
            )
            or CareTrackerBrowser.select_option_text_variants(
                host,
                insurance_company_selectors,
                aliases,
            )
            or CareTrackerBrowser.select_option_contains(
                host,
                insurance_company_selectors,
                period.ins_company_text.lower().split()[:3],
            )
        ),
        wait_for_loading=True,
        post_ready_selectors=[
            f"input[id*='{row_token}txtSubscriber']",
            f"input[id*='{row_token}txtInsuranceGroupNo']",
            f"input[id*='{row_token}txtInsuranceMember']",
        ],
        attempts=2,
    )
    selected = _get_selected_option(host, insurance_company_selectors)
    fields[f"{row_prefix}.ins_company_selected_value"] = bool(selected["value"])
    fields[f"{row_prefix}.ins_company_selected_text"] = bool(selected["text"])
    fields[f"{row_prefix}.ins_company_matches_expected_code"] = (
        selected["value"] == period.payer_code.value
    )

    subscriber_selectors = [
        f"input[id*='{row_token}txtSubscriber']",
        "input[id$='_txtSubscriber']" if index == 0 else "",
    ]
    subscriber_selectors = [s for s in subscriber_selectors if s]
    _run_step(
        host,
        fields,
        f"{row_prefix}.subscriber_id",
        lambda: CareTrackerBrowser.fill_first(
            host,
            subscriber_selectors,
            period.subscriber_id,
        ),
    )
    group_selectors = [
        f"input[id*='{row_token}txtInsuranceGroupNo']",
        "input[id$='_txtInsuranceGroupNo']" if index == 0 else "",
    ]
    group_selectors = [s for s in group_selectors if s]
    _run_step(
        host,
        fields,
        f"{row_prefix}.insurance_group_no",
        lambda: CareTrackerBrowser.fill_first(
            host,
            group_selectors,
            period.insurance_group_no,
        ),
    )
    member_no = (
        period.insurance_member_no or period.authorization_no or period.subscriber_id
    )
    member_selectors = [
        f"input[id*='{row_token}txtInsuranceMember']",
        "input[id$='_txtInsuranceMember']" if index == 0 else "",
    ]
    member_selectors = [s for s in member_selectors if s]
    _run_step(
        host,
        fields,
        f"{row_prefix}.insurance_member_no",
        lambda: CareTrackerBrowser.fill_first(
            host,
            member_selectors,
            member_no,
        ),
    )
    assignment_selectors = [
        f"select[id*='{row_token}ddlAssignmentOfBenefits']",
        "select[id$='_ddlAssignmentOfBenefits']" if index == 0 else "",
    ]
    assignment_selectors = [s for s in assignment_selectors if s]
    _run_step(
        host,
        fields,
        f"{row_prefix}.assignment_of_benefits",
        lambda: CareTrackerBrowser.select_first(
            host,
            assignment_selectors,
            value=period.assignment_of_benefits.value,
        ),
    )

    # Some subscriber controls are outside the insurance row and can be disabled depending on UI state.
    _run_step(
        host,
        fields,
        f"{row_prefix}.subscriber_type_option",
        lambda: (
            _set_select_value_js(
                host,
                [
                    "ctl00_MainContent_ucPatientDetail_ddlAddSubscriberType_Ins",
                    "ctl00_MainContent_ucPatientDetail_ddlAddSubscriberType",
                ],
                period.subscriber_type_option.value,
            )
            or CareTrackerBrowser.select_first(
                host,
                [
                    "#ctl00_MainContent_ucPatientDetail_ddlAddSubscriberType_Ins",
                    "#ctl00_MainContent_ucPatientDetail_ddlAddSubscriberType",
                ],
                value=period.subscriber_type_option.value,
            )
        ),
    )
    _run_step(
        host,
        fields,
        f"{row_prefix}.relationship_option",
        lambda: (
            _set_select_value_js(
                host,
                [
                    "ctl00_MainContent_ucPatientDetail_ddlRelationShip_Ins",
                    "ctl00_MainContent_ucPatientDetail_ddlRelationShip",
                ],
                period.relationship_option.value,
            )
            or CareTrackerBrowser.select_first(
                host,
                [
                    "#ctl00_MainContent_ucPatientDetail_ddlRelationShip_Ins",
                    "#ctl00_MainContent_ucPatientDetail_ddlRelationShip",
                ],
                value=period.relationship_option.value,
            )
        ),
    )

    return fields


def open_registration_form(page: Page) -> Page:
    selector = "a[title='New Patient'], a:has-text('New')"
    owner = CareTrackerBrowser.first_frame_with_selector(page, selector)
    if owner is None:
        raise RuntimeError("No se encontro boton New Patient")
    try:
        with page.expect_popup(timeout=8000) as popup:
            owner.locator(selector).first.click(force=True)
        p = popup.value
        p.wait_for_load_state("domcontentloaded", timeout=20000)
        p.wait_for_selector("#txtFirstName", timeout=12000)
        return p
    except PlaywrightTimeoutError:
        owner.locator(selector).first.click(force=True)
        try:
            page.wait_for_selector("#txtFirstName", timeout=12000)
        except Exception:
            pass
        return page


def fill_registration(
    host: Page,
    payload: PatientRegistrationPayload,
    include_insurance: bool,
) -> Dict[str, bool]:
    patient_details = payload.patient_details
    filled: Dict[str, bool] = {}
    logger.info("[CARETRACKER] Filling patient details...")

    filled.update(
        _settle_after_name_entry(
            host,
            patient_details.first_name,
            patient_details.last_name,
        )
    )
    _run_step(
        host,
        filled,
        "patient_details.dob",
        lambda: CareTrackerBrowser.fill_first(
            host,
            ["#ctl00_MainContent_ucPatientDetail_dlPatient_ctl00_txtDOB"],
            patient_details.dob,
        ),
    )
    _run_step(
        host,
        filled,
        "patient_details.gender",
        lambda: CareTrackerBrowser.select_first(
            host,
            ["#ctl00_MainContent_ucPatientDetail_dlPatient_ctl00_ddlGender"],
            value=patient_details.gender.value,
        ),
    )

    _run_step(
        host,
        filled,
        "patient_details.street",
        lambda: CareTrackerBrowser.fill_first(
            host, ["input[id$='_txtStreet_0']"], patient_details.street
        ),
    )
    _run_step(
        host,
        filled,
        "patient_details.zip_code",
        lambda: CareTrackerBrowser.fill_first(
            host, ["input[id$='_txtZip_0']"], patient_details.zip_code
        ),
    )
    _run_step(
        host,
        filled,
        "patient_details.city",
        lambda: CareTrackerBrowser.fill_first(
            host, ["input[id$='_txtCity_0']"], patient_details.city.title()
        ),
    )
    _run_step(
        host,
        filled,
        "patient_details.state_option",
        lambda: CareTrackerBrowser.select_first(
            host,
            ["select[id$='_ddlState_0']"],
            value=patient_details.state_option.value,
        ),
    )
    _run_step(
        host,
        filled,
        "patient_details.country_option",
        lambda: CareTrackerBrowser.select_first(
            host,
            ["select[id$='_ddlCountry_0']"],
            value=patient_details.country_option.value,
        ),
    )

    h_area, h_number = CareTrackerBrowser.parse_phone(patient_details.home_phone)
    m_area, m_number = CareTrackerBrowser.parse_phone(patient_details.mobile_phone)

    _run_step(
        host,
        filled,
        "patient_details.home_phone_type_option",
        lambda: CareTrackerBrowser.select_first(
            host,
            ["select[id$='_ddlPhoneType_0']"],
            value=patient_details.home_phone_type_option.value,
        ),
    )
    _run_step(
        host,
        filled,
        "patient_details.home_phone_area",
        lambda: CareTrackerBrowser.fill_first(
            host, ["input[id$='_txtAreaCode_0']"], h_area
        ),
    )
    _run_step(
        host,
        filled,
        "patient_details.home_phone_number",
        lambda: CareTrackerBrowser.fill_first(
            host, ["input[id$='_txtPhNum_0']"], h_number
        ),
    )

    _run_step(
        host,
        filled,
        "patient_details.mobile_row_added",
        lambda: CareTrackerBrowser.click_first(
            host, ["a[id$='_lnkAddEmailPhone_0']", "a[title='Add Phone']"]
        ),
        wait_for_loading=True,
        post_ready_selectors=[
            "select[id$='_ddlPhoneType_1']",
            "input[id$='_txtAreaCode_1']",
            "input[id$='_txtPhNum_1']",
        ],
        attempts=3,
    )
    _run_step(
        host,
        filled,
        "patient_details.mobile_phone_type_option",
        lambda: _set_mobile_phone_type(
            host, patient_details.mobile_phone_type_option.value
        ),
        attempts=3,
    )
    _run_step(
        host,
        filled,
        "patient_details.mobile_phone_area",
        lambda: CareTrackerBrowser.fill_first(
            host, ["input[id$='_txtAreaCode_1']"], m_area
        ),
        attempts=3,
    )
    _run_step(
        host,
        filled,
        "patient_details.mobile_phone_number",
        lambda: CareTrackerBrowser.fill_first(
            host, ["input[id$='_txtPhNum_1']"], m_number
        ),
        attempts=3,
    )
    if include_insurance:
        insurance_periods = payload.insurance_periods
        logger.info(
            "[CARETRACKER] Filling insurance section (%s period(s))...",
            len(insurance_periods),
        )
        # Add all required insurance rows first; some pages reset row values when a new row is added.
        for idx in range(1, len(insurance_periods)):
            logger.info("[CARETRACKER] Adding insurance row index %s...", idx)
            _run_step(
                host,
                filled,
                f"insurance_periods.{idx}.row_added",
                lambda idx=idx: _add_secondary_insurance_row(host, idx),
                wait_for_loading=True,
                post_ready_selectors=[
                    f"select[id*='lvPatientEdit_ctrl{idx}_ddlInsuranceCompany']",
                    f"input[id*='lvPatientEdit_ctrl{idx}_txtSubscriber']",
                ],
                attempts=3,
            )
        for idx, period in enumerate(insurance_periods):
            logger.info("[CARETRACKER] Filling insurance row index %s...", idx)
            filled.update(_fill_insurance_period(host, idx, period))

    return filled


def run_registration_draft(
    page: Page,
    payload: PatientRegistrationPayload,
    include_insurance: bool,
) -> Dict[str, Any]:
    host = open_registration_form(page)
    filled = fill_registration(host, payload, include_insurance=include_insurance)
    return {
        "success": True,
        "filled_fields": filled,
        "registration_host_is_popup": host != page,
    }
