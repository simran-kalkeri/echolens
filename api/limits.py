"""Small, process-wide limits for the public portfolio analyst."""
from __future__ import annotations

import asyncio
import math
import threading
import time
from collections import deque

from fastapi import HTTPException
from starlette.responses import JSONResponse


class AnalystLimits:
    def __init__(self, per_ip=3, window=900, daily=20, concurrency=1, clock=time.monotonic):
        if min(per_ip, window, daily, concurrency) < 1:
            raise ValueError("Analyst limits must be positive")
        self.per_ip, self.window, self.daily = per_ip, window, daily
        self.concurrency, self.clock = concurrency, clock
        self.lock = threading.Lock()
        self.requests = deque()
        self.clients = {}
        self.active = 0

    def admit(self, client):
        now = self.clock()
        with self.lock:
            while self.requests and self.requests[0] <= now - 86400:
                self.requests.popleft()
            for key in list(self.clients):
                history = self.clients[key]
                while history and history[0] <= now - self.window:
                    history.popleft()
                if not history:
                    del self.clients[key]
            if len(self.requests) >= self.daily:
                self._reject("The analyst's daily usage limit has been reached. Please try tomorrow.",
                             self.requests[0] + 86400 - now)
            history = self.clients.get(client, deque())
            if len(history) >= self.per_ip:
                self._reject("Please wait before asking another analyst question.", history[0] + self.window - now)
            if self.active >= self.concurrency:
                self._reject("The analyst is answering another question. Please try again shortly.", 15)
            history.append(now)
            self.clients[client] = history
            self.requests.append(now)
            self.active += 1
        released = False

        def release():
            nonlocal released
            with self.lock:
                if not released:
                    released = True
                    self.active -= 1
        return release

    @staticmethod
    def _reject(message, retry_after):
        raise HTTPException(429, message, headers={"Retry-After": str(max(1, math.ceil(retry_after)))})


class AnalystBodyLimit:
    """Bound JSON buffering before parsing, including requests without Content-Length."""
    def __init__(self, app, max_bytes=4096):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") != "/api/analyst/ask":
            return await self.app(scope, receive, send)
        body = bytearray()
        try:
            while True:
                message = await asyncio.wait_for(receive(), timeout=10)
                if message["type"] == "http.disconnect":
                    return
                body.extend(message.get("body", b""))
                if len(body) > self.max_bytes:
                    return await JSONResponse({"detail": "Question request is too large."}, status_code=413)(scope, receive, send)
                if not message.get("more_body", False):
                    break
        except asyncio.TimeoutError:
            return await JSONResponse({"detail": "Question upload timed out."}, status_code=408)(scope, receive, send)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()
        await self.app(scope, replay, send)
