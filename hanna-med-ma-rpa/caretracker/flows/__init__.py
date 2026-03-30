from .login import run_login
from .search import close_search_modal, run_search
from .registration import (
    fill_registration,
    open_registration_form,
    run_registration_draft,
)

__all__ = [
    "run_login",
    "run_search",
    "close_search_modal",
    "open_registration_form",
    "fill_registration",
    "run_registration_draft",
]
