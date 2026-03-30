from __future__ import annotations

import socket
import urllib.error
import urllib.request
from typing import Any, Dict

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page

from ..browser import CareTrackerBrowser
from ..types import CareTrackerCredentials
from logger import logger

LOGIN_URL = "https://caretracker.com/default.asp"
LOGIN_FORM_WAIT_MS = 12000
LOGIN_RETRY_ATTEMPTS = 3


def _wait_for_login_form(page: Page, timeout_ms: int = LOGIN_FORM_WAIT_MS) -> bool:
    try:
        page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    except Exception:
        pass

    if CareTrackerBrowser.wait_for_any_selector(
        page,
        ["#bottom_memberid", "#bottom_pin", "#ENV_LIST", "#PRODUCT_LIST"],
        timeout_ms=timeout_ms,
        require_enabled=False,
    ):
        return True
    return False


def _has_dashboard_context(page: Page) -> bool:
    if "caretracker.asp" in (page.url or "").lower():
        return True
    for frame in page.frames:
        try:
            if frame.locator("img[alt='Advanced Search'], img.icon-adsear").count() > 0:
                return True
        except Exception:
            continue
    return False


def _has_connectivity(url: str, timeout: float = 8.0) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout):
            return True
    except urllib.error.HTTPError:
        # Server responded; connectivity exists even with 4xx/5xx.
        return True
    except (urllib.error.URLError, socket.timeout, TimeoutError):
        return False
    except Exception:
        return False


def _is_network_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in [
            "net::err_",
            "internet_disconnected",
            "name_not_resolved",
            "connection reset",
            "connection refused",
            "connection timed out",
            "navigation timeout",
        ]
    )


def run_login(
    page: Page,
    browser: CareTrackerBrowser,
    credentials: CareTrackerCredentials,
) -> Dict[str, Any]:
    screenshot = browser.artifact_path("caretracker_login")
    try:
        if not _has_connectivity(LOGIN_URL):
            return {
                "success": False,
                "message": "Sin conectividad hacia CareTracker antes del login",
                "error_type": "network",
                "url": LOGIN_URL,
                "screenshot": str(screenshot),
            }

        last_error: str | None = None
        for attempt in range(1, LOGIN_RETRY_ATTEMPTS + 1):
            logger.info(
                "[CARETRACKER] Opening login page... (attempt %s/%s)",
                attempt,
                LOGIN_RETRY_ATTEMPTS,
            )
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=45000)

            if not _wait_for_login_form(page):
                # Some runs do an extra refresh; retry quickly before failing.
                try:
                    page.reload(wait_until="domcontentloaded", timeout=25000)
                except Exception:
                    pass
                if not _wait_for_login_form(page, timeout_ms=6000):
                    last_error = "Login form not ready"
                    continue

            try:
                page.select_option("#ENV_LIST", "LIVE")
                page.select_option("#PRODUCT_LIST", "CT")
                page.fill("#bottom_memberid", credentials.username)
                page.fill("#bottom_pin", credentials.password)
                page.click("#BOTTOM_LOGIN")
            except Exception as exc:
                last_error = str(exc)
                continue

            try:
                page.wait_for_url("**/caretracker.asp*", timeout=20000)
            except PlaywrightError as exc:
                # Some headed runs can throw while main frame transitions.
                logger.warning(f"[CARETRACKER] Post-login wait warning: {exc}")

            try:
                page.wait_for_selector(
                    "#bottom_memberid", state="detached", timeout=6000
                )
            except Exception:
                pass

            current_url = page.url
            form_still_visible = (
                page.locator("#bottom_memberid").is_visible()
                and page.locator("#bottom_pin").is_visible()
            )
            success = (
                current_url != LOGIN_URL or not form_still_visible
            ) and _has_dashboard_context(page)
            if success:
                page.screenshot(path=str(screenshot), full_page=True)
                return {
                    "success": True,
                    "message": "Login exitoso en CareTracker",
                    "error_type": None,
                    "url": current_url,
                    "screenshot": str(screenshot),
                }

            last_error = "No se pudo confirmar contexto de dashboard tras login"

        page.screenshot(path=str(screenshot), full_page=True)
        return {
            "success": False,
            "message": f"No se pudo confirmar el login ({last_error or 'sin detalle'})",
            "error_type": "unknown",
            "url": page.url,
            "screenshot": str(screenshot),
        }
    except Exception as exc:
        error_type = "network" if _is_network_error(exc) else "browser"
        try:
            page.screenshot(path=str(screenshot), full_page=True)
        except Exception:
            pass
        return {
            "success": False,
            "message": f"Login fallo: {exc}",
            "error_type": error_type,
            "url": page.url if hasattr(page, "url") else LOGIN_URL,
            "screenshot": str(screenshot),
        }
