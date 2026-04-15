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
    url = (page.url or "").lower()
    if "caretracker.asp" in url:
        logger.info(f"[CARETRACKER] dashboard context: URL contains 'caretracker.asp' → {page.url}")
        return True
    logger.info(
        f"[CARETRACKER] dashboard context: URL does not contain 'caretracker.asp' "
        f"(url={page.url}); scanning {len(page.frames)} frame(s) for advanced-search icon"
    )
    for i, frame in enumerate(page.frames):
        try:
            icon_count = frame.locator("img[alt='Advanced Search'], img.icon-adsear").count()
            logger.info(
                f"[CARETRACKER]   frame[{i}] url={frame.url!r} icon_count={icon_count}"
            )
            if icon_count > 0:
                return True
        except Exception as exc:
            logger.info(f"[CARETRACKER]   frame[{i}] scan failed: {exc}")
            continue
    logger.info("[CARETRACKER] dashboard context: NO advanced-search icon in any frame")
    return False


def _log_login_form_state(page: Page, label: str) -> None:
    """Emit the visibility of every element we interact with, in one log line."""
    selectors = {
        "ENV_LIST": "#ENV_LIST",
        "PRODUCT_LIST": "#PRODUCT_LIST",
        "memberid": "#bottom_memberid",
        "pin": "#bottom_pin",
        "login_btn": "#BOTTOM_LOGIN",
    }
    parts = []
    for name, sel in selectors.items():
        try:
            loc = page.locator(sel)
            count = loc.count()
            if count == 0:
                parts.append(f"{name}=missing")
                continue
            visible = loc.first.is_visible()
            parts.append(f"{name}={'visible' if visible else 'hidden'}")
        except Exception as exc:
            parts.append(f"{name}=error({exc.__class__.__name__})")
    logger.info(f"[CARETRACKER] form state ({label}) url={page.url} | {' | '.join(parts)}")


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
            logger.info(f"[CARETRACKER] post-goto url={page.url}")

            if not _wait_for_login_form(page):
                logger.warning(
                    f"[CARETRACKER] login form not ready on first try — reloading (attempt {attempt})"
                )
                try:
                    page.reload(wait_until="domcontentloaded", timeout=25000)
                except Exception as exc:
                    logger.warning(f"[CARETRACKER] reload failed: {exc}")
                if not _wait_for_login_form(page, timeout_ms=6000):
                    logger.error(
                        f"[CARETRACKER] login form never appeared on attempt {attempt} — url={page.url}"
                    )
                    _log_login_form_state(page, f"form-not-ready-attempt-{attempt}")
                    last_error = "Login form not ready"
                    continue

            _log_login_form_state(page, f"pre-submit-attempt-{attempt}")

            try:
                page.select_option("#ENV_LIST", "LIVE")
                page.select_option("#PRODUCT_LIST", "CT")
                page.fill("#bottom_memberid", credentials.username)
                page.fill("#bottom_pin", credentials.password)
                logger.info(
                    f"[CARETRACKER] filled form (env=LIVE product=CT user={credentials.username!r}) "
                    f"→ clicking #BOTTOM_LOGIN"
                )
                page.click("#BOTTOM_LOGIN")
            except Exception as exc:
                logger.error(f"[CARETRACKER] fill/submit failed on attempt {attempt}: {exc}")
                last_error = str(exc)
                continue

            try:
                page.wait_for_url("**/caretracker.asp*", timeout=20000)
                logger.info(f"[CARETRACKER] post-login URL matched caretracker.asp → {page.url}")
            except PlaywrightError as exc:
                # Some headed runs can throw while main frame transitions.
                logger.warning(
                    f"[CARETRACKER] Post-login wait_for_url timed out "
                    f"(20s, attempt {attempt}): {exc}"
                )
                logger.info(f"[CARETRACKER] post-login actual url={page.url}")

            try:
                page.wait_for_selector(
                    "#bottom_memberid", state="detached", timeout=6000
                )
                logger.info("[CARETRACKER] login form detached (expected for successful login)")
            except Exception:
                logger.info("[CARETRACKER] login form still attached after submit")

            _log_login_form_state(page, f"post-submit-attempt-{attempt}")

            current_url = page.url
            form_still_visible = (
                page.locator("#bottom_memberid").is_visible()
                and page.locator("#bottom_pin").is_visible()
            )
            dashboard_ok = _has_dashboard_context(page)
            success = (
                current_url != LOGIN_URL or not form_still_visible
            ) and dashboard_ok

            logger.info(
                f"[CARETRACKER] attempt {attempt} evaluation: "
                f"current_url={current_url} | form_still_visible={form_still_visible} | "
                f"dashboard_ok={dashboard_ok} | success={success}"
            )

            if success:
                page.screenshot(path=str(screenshot), full_page=True)
                logger.info(f"[CARETRACKER] LOGIN SUCCESS on attempt {attempt}")
                return {
                    "success": True,
                    "message": "Login exitoso en CareTracker",
                    "error_type": None,
                    "url": current_url,
                    "screenshot": str(screenshot),
                }

            last_error = (
                f"dashboard context not confirmed — url={current_url}, "
                f"form_still_visible={form_still_visible}, dashboard_ok={dashboard_ok}"
            )
            logger.warning(f"[CARETRACKER] attempt {attempt} failed: {last_error}")

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
