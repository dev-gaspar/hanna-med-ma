"""
Services module — Background services for RPA node.
"""

from services.modal_watcher_service import (
    ModalWatcherService,
    get_modal_watcher,
    start_modal_watcher,
    stop_modal_watcher,
)

__all__ = [
    "ModalWatcherService",
    "get_modal_watcher",
    "start_modal_watcher",
    "stop_modal_watcher",
]
