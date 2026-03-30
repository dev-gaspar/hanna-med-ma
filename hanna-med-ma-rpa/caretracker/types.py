from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Tuple

from .form_enums import (
    AssignmentOfBenefitsOption,
    CountryOption,
    GenderOption,
    InsuranceCompanyOption,
    InsuranceSubscriberTypeOption,
    PhoneTypeOption,
    RelationshipOption,
    StateOption,
)


INSURANCE_COMPANY_ALIASES: Dict[InsuranceCompanyOption, Tuple[str, ...]] = {
    InsuranceCompanyOption.UNITED_HEALTHCARE: (
        "united healthcare choice plus",
        "unitedhealthcare choice plus",
        "uhc choice plus",
        "united choice plus",
        "unitedchoiceplus",
        "choice plus",
        "united choice",
        "united healthcare",
        "uhc",
    ),
    InsuranceCompanyOption.MEDICAID_OF_FLORIDA: (
        "medicaid of florida",
        "medicaid florida",
        "florida medicaid",
    ),
}


@dataclass(frozen=True)
class CareTrackerCredentials:
    username: str
    password: str


@dataclass(frozen=True)
class PatientSearchQuery:
    first_name: str
    last_name: str


@dataclass(frozen=True)
class CareTrackerPatientDetails:
    first_name: str
    last_name: str
    street: str
    zip_code: str
    city: str
    state_text: str
    home_phone: str
    mobile_phone: str
    dob: str
    gender: "GenderOption"
    state_option: "StateOption" = StateOption.FL
    country_option: "CountryOption" = CountryOption.UNITED_STATES
    home_phone_type_option: "PhoneTypeOption" = PhoneTypeOption.HOME
    mobile_phone_type_option: "PhoneTypeOption" = PhoneTypeOption.MOBILE


@dataclass(frozen=True)
class CareTrackerInsurancePeriod:
    payer_code: "InsuranceCompanyOption"
    ins_company_text: str
    subscriber_id: str
    subscriber_name: str = ""
    relationship_option: "RelationshipOption" = RelationshipOption.SELF
    subscriber_type_option: "InsuranceSubscriberTypeOption" = (
        InsuranceSubscriberTypeOption.PATIENT
    )
    insurance_group_no: str = ""
    insurance_member_no: str = ""
    authorization_no: str = ""
    plan_type: str = ""
    insurance_plan_text: str = ""
    assignment_of_benefits: "AssignmentOfBenefitsOption" = (
        AssignmentOfBenefitsOption.YES
    )


@dataclass(frozen=True)
class CareTrackerRegistrationPayload:
    patient_details: CareTrackerPatientDetails
    insurance_periods: list[CareTrackerInsurancePeriod]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "patient_details": {
                "first_name": self.patient_details.first_name,
                "last_name": self.patient_details.last_name,
                "street": self.patient_details.street,
                "zip_code": self.patient_details.zip_code,
                "city": self.patient_details.city,
                "state_text": self.patient_details.state_text,
                "home_phone": self.patient_details.home_phone,
                "mobile_phone": self.patient_details.mobile_phone,
                "dob": self.patient_details.dob,
                "gender": self.patient_details.gender.value,
                "state_option": self.patient_details.state_option.value,
                "country_option": self.patient_details.country_option.value,
                "home_phone_type_option": self.patient_details.home_phone_type_option.value,
                "mobile_phone_type_option": self.patient_details.mobile_phone_type_option.value,
            },
            "insurance_periods": [
                {
                    "payer_code": i.payer_code.value,
                    "ins_company_text": i.ins_company_text,
                    "subscriber_id": i.subscriber_id,
                    "subscriber_name": i.subscriber_name,
                    "relationship_option": i.relationship_option.value,
                    "subscriber_type_option": i.subscriber_type_option.value,
                    "insurance_group_no": i.insurance_group_no,
                    "insurance_member_no": i.insurance_member_no,
                    "authorization_no": i.authorization_no,
                    "plan_type": i.plan_type,
                    "insurance_plan_text": i.insurance_plan_text,
                    "assignment_of_benefits": i.assignment_of_benefits.value,
                }
                for i in self.insurance_periods
            ],
        }


# Backward-compatible aliases
PatientPersonalInfo = CareTrackerPatientDetails
PatientInsuranceInfo = CareTrackerInsurancePeriod
PatientRegistrationPayload = CareTrackerRegistrationPayload
