from __future__ import annotations

from typing import Any, Dict, List, Tuple
import re

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError

from ..browser import CareTrackerBrowser
from ..types import PatientSearchQuery
from logger import logger

SEARCH_MODAL_OPEN_ATTEMPTS = 3
SEARCH_MODAL_WAIT_MS = 5000


def _has_search_frames(page: Page) -> bool:
    return any(
        f.name in {"searchtop", "searchmiddle", "searchlistbar"} for f in page.frames
    )


def _wait_for_search_modal(page: Page, timeout_ms: int = SEARCH_MODAL_WAIT_MS) -> bool:
    elapsed = 0
    while elapsed < timeout_ms:
        if _has_search_frames(page):
            return True
        try:
            page.wait_for_timeout(100)
        except Exception:
            break
        elapsed += 100
    return _has_search_frames(page)


def _wait_dashboard_search_trigger(page: Page, timeout_ms: int = 7000) -> bool:
    return CareTrackerBrowser.wait_for_any_selector(
        page,
        ["img[alt='Advanced Search']", "img.icon-adsear"],
        timeout_ms=timeout_ms,
        require_enabled=False,
    )


def _open_search_modal(page: Page) -> Page:
    if _has_search_frames(page):
        return page

    for attempt in range(1, SEARCH_MODAL_OPEN_ATTEMPTS + 1):
        logger.info("[CARETRACKER] Attempting to find search trigger (%s/%s)...", attempt, SEARCH_MODAL_OPEN_ATTEMPTS)
        _wait_dashboard_search_trigger(page)

        owner = CareTrackerBrowser.first_frame_with_selector(
            page, "img[alt='Advanced Search'], img.icon-adsear"
        )
        if owner is None:
            try:
                page.wait_for_load_state("domcontentloaded", timeout=3000)
            except Exception:
                pass
            if attempt < SEARCH_MODAL_OPEN_ATTEMPTS:
                continue
            raise RuntimeError("No se encontro Advanced Search")

        logger.info("[CARETRACKER] Found search trigger. Clicking...")

        before = len([f for f in page.frames if f.name == "searchtop"])
        try:
            with page.expect_popup(timeout=6000) as popup:
                owner.locator(
                    "img[alt='Advanced Search'], img.icon-adsear"
                ).first.click(force=True, timeout=4000)
            p = popup.value
            logger.info("[CARETRACKER] Search popup opened.")
            return p
        except PlaywrightTimeoutError:
            after = len([f for f in page.frames if f.name == "searchtop"])
            if after > before and _wait_for_search_modal(page):
                return page
            try:
                owner.evaluate("typeof gotosearch === 'function' ? gotosearch() : null")
            except Exception as exc:
                logger.warning("[CARETRACKER] gotosearch fallback failed: %s", exc)
            if _wait_for_search_modal(page):
                return page
            if attempt < SEARCH_MODAL_OPEN_ATTEMPTS:
                logger.warning(
                    "[CARETRACKER] Search modal not ready yet, retrying open (%s/%s)",
                    attempt,
                    SEARCH_MODAL_OPEN_ATTEMPTS,
                )

    raise RuntimeError("No se pudo abrir modal de busqueda")


def _set_search_inputs(host: Page, query: PatientSearchQuery) -> bool:
    first_selectors = ["input[name='FIRST_NAME']", "input[name='SEARCH_FNAME']"]
    last_selectors = ["input[name='LAST_NAME']", "input[name='SEARCH_LNAME']"]
    CareTrackerBrowser.wait_for_any_selector(
        host,
        first_selectors + last_selectors,
        timeout_ms=SEARCH_MODAL_WAIT_MS,
        require_enabled=True,
    )
    logger.info("[CARETRACKER] Search inputs detected. Filling name...")
    top = CareTrackerBrowser.latest_named_frame(host, "searchtop")
    frames = [top] if top else []
    frames.extend(f for f in host.frames if f not in frames)

    for frame in frames:
        if frame is None:
            continue
        first_ok = False
        last_ok = False
        for sel in first_selectors:
            try:
                if frame.locator(sel).count() > 0:
                    frame.fill(sel, query.first_name)
                    first_ok = True
                    break
            except Exception:
                continue
        for sel in last_selectors:
            try:
                if frame.locator(sel).count() > 0:
                    frame.fill(sel, query.last_name)
                    last_ok = True
                    break
            except Exception:
                continue
        if first_ok and last_ok:
            return True
    return False


def _submit_search(host: Page) -> bool:
    top = CareTrackerBrowser.latest_named_frame(host, "searchtop")
    frames = [top] if top else []
    frames.extend(f for f in host.frames if f not in frames)
    for frame in frames:
        if frame is None:
            continue
        for sel in ["input[name='CTSearch']", "input[value='Search']"]:
            try:
                if frame.locator(sel).count() > 0:
                    logger.info("[CARETRACKER] Clicking search button...")
                    frame.locator(sel).first.click(no_wait_after=True, force=True)
                    logger.info("[CARETRACKER] Search button clicked.")
                    return True
            except Exception:
                continue
    return False


def _extract_results(host: Page) -> Tuple[str, int, List[Dict[str, str]], str]:
    def _collect_once() -> Tuple[Dict[str, Dict[str, str]], int, str, bool]:
        middle = CareTrackerBrowser.latest_named_frame(host, "searchmiddle")
        frames = [middle] if middle else host.frames
        matches: Dict[str, Dict[str, str]] = {}
        records = -1
        url = host.url
        has_marker = False

        for frame in frames:
            if frame is None:
                continue
            try:
                html = frame.content()
                url = frame.url or url

                for eid, name in re.findall(
                    r"ChangeEntity_Click\((\d+),\s*'([^']+)'\)", html
                ):
                    matches[eid] = {"entity_id": eid, "patient_name": name}
                if matches:
                    has_marker = True

                m = re.search(r"(\d+)\s+records found", html, re.IGNORECASE)
                if m:
                    records = int(m.group(1))
                    has_marker = True

                if re.search(
                    r"no\s+records\s+found|0\s+records\s+found", html, re.IGNORECASE
                ):
                    records = 0
                    has_marker = True
            except Exception:
                continue

        return matches, records, url, has_marker

    matches: Dict[str, Dict[str, str]] = {}
    records = -1
    url = host.url
    logger.info("[CARETRACKER] Extracting search results from frames...")

    # Wait for searchmiddle frame to appear before polling for content.
    # This avoids up to 5s of wasted polling when the frame hasn't loaded yet.
    for _ in range(20):
        if CareTrackerBrowser.latest_named_frame(host, "searchmiddle") is not None:
            break
        try:
            host.wait_for_timeout(150)
        except Exception:
            break

    for i in range(15):
        matches, records, url, has_marker = _collect_once()
        logger.debug(f"[CARETRACKER] Result check {i+1}/15: records={records}, marker={has_marker}")
        if has_marker:
            break
        try:
            host.wait_for_timeout(200)
        except Exception:
            break

    if records < 0:
        records = len(matches)
    if records == 0 and not matches:
        status = "NOT_FOUND"
    elif records == 1 or len(matches) == 1:
        status = "FOUND_SINGLE"
    else:
        status = "FOUND_MULTIPLE"
    return status, max(records, len(matches)), list(matches.values()), url


def close_search_modal(page: Page, host: Page) -> bool:
    if host != page:
        try:
            host.close()
            return True
        except Exception:
            pass
    try:
        btn = page.locator(
            "div.ui-dialog-titlebar:has-text('Patient Search') button.ui-dialog-titlebar-close"
        )
        if btn.count() > 0:
            btn.last.click(force=True)
            try:
                btn.last.wait_for(state="detached", timeout=4000)
            except Exception:
                pass
            return True
    except Exception:
        pass
    return False


def run_search(page: Page, query: PatientSearchQuery) -> Dict[str, Any]:
    logger.info(f"[CARETRACKER] Searching: {query.first_name} {query.last_name}")
    last_error = "No se pudo abrir modal de busqueda"
    for attempt in range(1, 3):
        try:
            host = _open_search_modal(page)
        except Exception as exc:
            last_error = str(exc)
            page.wait_for_timeout(250)
            continue

        if not _set_search_inputs(host, query):
            last_error = "No se pudieron llenar campos de busqueda"
            page.wait_for_timeout(250)
            continue
        if not _submit_search(host):
            last_error = "No se pudo enviar la busqueda"
            page.wait_for_timeout(250)
            continue

        status, count, matches, url = _extract_results(host)
        return {
            "success": True,
            "status": status,
            "appears": status in {"FOUND_SINGLE", "FOUND_MULTIPLE"},
            "result_count": count,
            "matches": matches,
            "result_url": url,
            "search_host_is_popup": host != page,
        }

    return {"success": False, "message": last_error}
