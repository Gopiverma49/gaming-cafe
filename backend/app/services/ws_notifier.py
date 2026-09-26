import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Set, Any
from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session as SyncSession
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("ws_notifier")


class ConnectionManager:
    def __init__(self) -> None:
        # Map channel -> Set[WebSocket]
        # Channels: 'admin', 'customer', 'customer:{desk_id}'
        self.active_channels: Dict[str, Set[WebSocket]] = {}
        self._lock: asyncio.Lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        await websocket.accept()
        async with self._lock:
            if channel not in self.active_channels:
                self.active_channels[channel] = set()
            self.active_channels[channel].add(websocket)
        logger.info(f"WebSocket connected to channel: {channel}")

    async def disconnect(self, websocket: WebSocket, channel: str) -> None:
        async with self._lock:
            if channel in self.active_channels and websocket in self.active_channels[channel]:
                self.active_channels[channel].remove(websocket)
                if not self.active_channels[channel]:
                    del self.active_channels[channel]
        logger.info(f"WebSocket disconnected from channel: {channel}")

    async def broadcast(self, channel: str, message: Dict[str, Any]) -> None:
        async with self._lock:
            connections = list(self.active_channels.get(channel, []))

        if not connections:
            return

        serialized = json.dumps(message, default=str)
        stale: List[WebSocket] = []
        for ws in connections:
            try:
                await ws.send_text(serialized)
            except Exception as exc:
                logger.warning(f"Error sending message to ws on {channel}: {exc}")
                stale.append(ws)

        if stale:
            async with self._lock:
                for dead_ws in stale:
                    if channel in self.active_channels and dead_ws in self.active_channels[channel]:
                        self.active_channels[channel].discard(dead_ws)
                    if channel in self.active_channels and not self.active_channels[channel]:
                        del self.active_channels[channel]

    async def broadcast_events(self, events: List[Dict[str, Any]]) -> None:
        for event_item in events:
            channel = event_item.get("channel", "admin")
            await self.broadcast(channel, event_item)


# Global connection manager instance
manager: ConnectionManager = ConnectionManager()


def buffer_ws_event(session: AsyncSession, channel: str, event_type: str, payload: Dict[str, Any]) -> None:
    """
    Buffers an event into the transactional session.
    The event will strictly be broadcast ONLY after session.commit().
    If the session rolls back, the buffer is dropped immediately.
    """
    sync_session = session.sync_session
    if "event_buffer" not in sync_session.info:
        sync_session.info["event_buffer"] = []

    existing = sync_session.info["event_buffer"]
    now_iso = datetime.now(timezone.utc).isoformat()

    target_channels = [channel]
    # Operational events notify both admin and customer portals
    operational_events = {
        "SESSION_STARTED",
        "SESSION_UPDATED",
        "SESSION_COMPLETED",
        "SESSION_TRANSFERRED",
        "SESSION_CANCELLED",
        "ORDER_CREATED",
        "ORDER_STATUS_CHANGED",
        "STATION_LOCKED",
        "CUSTOMER_IN_SEAT_ORDER",
    }
    if event_type in operational_events:
        if "admin" not in target_channels:
            target_channels.append("admin")
        if "customer" not in target_channels:
            target_channels.append("customer")

    for ch in target_channels:
        if not any(e.get("channel") == ch and e.get("event_type") == event_type for e in existing):
            existing.append({
                "channel": ch,
                "event_type": event_type,
                "payload": payload,
                "timestamp": now_iso,
            })


# Hook into SQLAlchemy commit & rollback events
@event.listens_for(SyncSession, "after_commit")
def on_session_after_commit(session: SyncSession) -> None:
    buffered_events = session.info.pop("event_buffer", None)
    if buffered_events:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(manager.broadcast_events(buffered_events))
        except RuntimeError:
            # Fallback if executed outside an active event loop
            pass


@event.listens_for(SyncSession, "after_rollback")
def on_session_after_rollback(session: SyncSession) -> None:
    # Strictly discard all buffered events on rollback to prevent phantom broadcasts
    session.info.pop("event_buffer", None)
