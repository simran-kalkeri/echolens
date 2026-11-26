"""Tiny DSL that writes native Excalidraw (.excalidraw) scenes.

Boxes get bound text and arrows get real bindings, so every diagram stays fully editable in
excalidraw.com or the VS Code Excalidraw extension (drag a box and its arrows follow).
"""
from __future__ import annotations

import json
import random
from pathlib import Path

# Excalidraw's own palette
FILL = {
    "source": "#ffec99",   # yellow
    "spark": "#ffd8a8",    # orange
    "ml": "#d0bfff",       # violet
    "llm": "#fcc2d7",      # pink
    "intel": "#b2f2bb",    # green
    "serve": "#a5d8ff",    # blue
    "store": "#e9ecef",    # gray
    "eval": "#ffc9c9",     # red
    "user": "#99e9f2",     # cyan
    "note": "#fff9db",
    "white": "#ffffff",
}
ZONE_STROKE = {"source": "#f08c00", "spark": "#e8590c", "ml": "#6741d9", "llm": "#c2255c", "intel": "#2f9e44",
               "serve": "#1971c2", "store": "#868e96", "eval": "#e03131", "user": "#0c8599", "note": "#868e96"}
INK = "#1e1e1e"
BODY_FONT = 6     # Nunito: readable at small sizes
TITLE_FONT = 5    # Excalifont: hand-drawn headings
CHAR_W = {5: 0.60, 6: 0.55}


def _seed() -> int:
    return random.randint(1, 2 ** 31 - 1)


def measure(text: str, fs: int, font: int) -> tuple[float, float]:
    lines = text.split("\n")
    return max(len(l) for l in lines) * fs * CHAR_W[font], len(lines) * fs * 1.25


class Diagram:
    def __init__(self, name: str, title: str, subtitle: str = ""):
        random.seed(name)
        self.name, self.el, self.by_key = name, [], {}
        self._n = 0
        self.text(0, -110, title, fs=36, font=TITLE_FONT)
        if subtitle:
            self.text(0, -58, subtitle, fs=17, color="#495057")

    def _id(self, p: str) -> str:
        self._n += 1
        return f"{self.name[:6]}-{p}-{self._n}"

    def _base(self, typ: str, x: float, y: float, w: float, h: float, **kw) -> dict:
        d = {"id": kw.pop("id", None) or self._id(typ[:3]), "type": typ, "x": x, "y": y, "width": w, "height": h,
             "angle": 0, "strokeColor": INK, "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2,
             "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None, "roundness": None,
             "seed": _seed(), "version": 1, "versionNonce": _seed(), "isDeleted": False, "boundElements": [],
             "updated": 1, "link": None, "locked": False}
        d.update(kw)
        return d

    # ---------------------------------------------------------------- primitives
    def text(self, x, y, text, fs=16, font=BODY_FONT, color=INK, align="left", container=None, w=None, h=None, **kw):
        tw, th = measure(text, fs, font)
        t = self._base("text", x, y, w or tw, h or th, strokeColor=color, text=text, originalText=text, fontSize=fs,
                       fontFamily=font, textAlign=align, verticalAlign="middle" if container else "top",
                       containerId=container, lineHeight=1.25, autoResize=True, **kw)
        self.el.append(t)
        return t

    def box(self, key, x, y, w, h, text, kind="white", shape="rectangle", fs=16, dashed=False, bold_first=False):
        fill = FILL.get(kind, kind)
        r = self._base(shape, x, y, w, h, backgroundColor=fill, roundness={"type": 3} if shape == "rectangle" else None,
                       strokeStyle="dashed" if dashed else "solid", id=self._id(key))
        self.el.append(r)
        tw, th = measure(text, fs, BODY_FONT)
        tw = min(tw, w - 16)
        t = self.text(x + (w - tw) / 2, y + (h - th) / 2, text, fs=fs, align="center", container=r["id"], w=tw, h=th)
        r["boundElements"].append({"type": "text", "id": t["id"]})
        self.by_key[key] = r
        return r

    def zone(self, x, y, w, h, label, kind="note", fs=18):
        z = self._base("rectangle", x, y, w, h, strokeColor=ZONE_STROKE.get(kind, "#868e96"),
                       backgroundColor=FILL.get(kind, "#f8f9fa"), opacity=35, strokeStyle="dashed", strokeWidth=1,
                       roundness={"type": 3})
        self.el.insert(0, z)                      # behind everything
        lab = self.text(x + 14, y + 10, label, fs=fs, font=TITLE_FONT, color=ZONE_STROKE.get(kind, INK))
        self.el.remove(lab)
        self.el.insert(1, lab)
        return z

    def note(self, x, y, w, text, fs=14):
        _, th = measure(text, fs, BODY_FONT)
        return self.box(self._id("note"), x, y, w, th + 24, text, kind="note", fs=fs, dashed=True)

    # ---------------------------------------------------------------- arrows
    @staticmethod
    def _anchor(b, side):
        x, y, w, h = b["x"], b["y"], b["width"], b["height"]
        return {"r": (x + w, y + h / 2), "l": (x, y + h / 2), "t": (x + w / 2, y), "b": (x + w / 2, y + h)}[side]

    def arrow(self, a, b, label=None, sides=None, dashed=False, color=INK, fs=13, bend=0.5, loop=30):
        A, B = self.by_key[a], self.by_key[b]
        if sides is None:
            acx, acy = A["x"] + A["width"] / 2, A["y"] + A["height"] / 2
            bcx, bcy = B["x"] + B["width"] / 2, B["y"] + B["height"] / 2
            if B["x"] >= A["x"] + A["width"] - 4:
                sides = "rl"
            elif B["x"] + B["width"] <= A["x"] + 4:
                sides = "lr"
            else:
                sides = "bt" if bcy > acy else "tb"
        s, e = sides[0], sides[1]
        (x1, y1), (x2, y2) = self._anchor(A, s), self._anchor(B, e)
        gap = 6
        off = {"r": (gap, 0), "l": (-gap, 0), "t": (0, -gap), "b": (0, gap)}
        x1, y1 = x1 + off[s][0], y1 + off[s][1]
        x2, y2 = x2 + off[e][0], y2 + off[e][1]
        dx, dy = x2 - x1, y2 - y1
        if s == e:                                         # loop out and back on the same side
            k = loop
            if s == "t":
                yy = min(0, dy) - k; pts = [[0, 0], [0, yy], [dx, yy], [dx, dy]]
            elif s == "b":
                yy = max(0, dy) + k; pts = [[0, 0], [0, yy], [dx, yy], [dx, dy]]
            elif s == "l":
                xx = min(0, dx) - k; pts = [[0, 0], [xx, 0], [xx, dy], [dx, dy]]
            else:
                xx = max(0, dx) + k; pts = [[0, 0], [xx, 0], [xx, dy], [dx, dy]]
        elif s in "rl" and e in "rl":
            pts = [[0, 0], [dx, 0]] if abs(dy) < 2 else [[0, 0], [dx * bend, 0], [dx * bend, dy], [dx, dy]]
        elif s in "tb" and e in "tb":
            pts = [[0, 0], [0, dy]] if abs(dx) < 2 else [[0, 0], [0, dy * bend], [dx, dy * bend], [dx, dy]]
        elif s in "rl":                                    # horizontal then vertical
            pts = [[0, 0], [dx, 0], [dx, dy]]
        else:                                              # vertical then horizontal
            pts = [[0, 0], [0, dy], [dx, dy]]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        ar = self._base("arrow", x1, y1, max(xs) - min(xs), max(ys) - min(ys), points=pts, strokeColor=color,
                        strokeStyle="dashed" if dashed else "solid", roundness=None, lastCommittedPoint=None,
                        startBinding={"elementId": A["id"], "focus": 0, "gap": gap},
                        endBinding={"elementId": B["id"], "focus": 0, "gap": gap},
                        startArrowhead=None, endArrowhead="arrow", elbowed=False)
        self.el.append(ar)
        A["boundElements"].append({"type": "arrow", "id": ar["id"]})
        B["boundElements"].append({"type": "arrow", "id": ar["id"]})
        if label:
            mid = pts[len(pts) // 2 - 1] if len(pts) > 2 else [dx / 2, dy / 2]
            nxt = pts[len(pts) // 2] if len(pts) > 2 else [dx / 2, dy / 2]
            mx, my = x1 + (mid[0] + nxt[0]) / 2, y1 + (mid[1] + nxt[1]) / 2
            tw, th = measure(label, fs, BODY_FONT)
            t = self.text(mx - tw / 2, my - th / 2, label, fs=fs, align="center", container=ar["id"], w=tw, h=th,
                          color="#343a40")
            ar["boundElements"].append({"type": "text", "id": t["id"]})
        return ar

    def chain(self, keys, **kw):
        for a, b in zip(keys, keys[1:]):
            self.arrow(a, b, **kw)

    # ---------------------------------------------------------------- output
    def save(self, out_dir: Path) -> Path:
        scene = {"type": "excalidraw", "version": 2, "source": "https://excalidraw.com",
                 "elements": self.el,
                 "appState": {"viewBackgroundColor": "#ffffff", "gridSize": 20, "currentItemFontFamily": BODY_FONT},
                 "files": {}}
        p = out_dir / f"{self.name}.excalidraw"
        p.write_text(json.dumps(scene, indent=1, ensure_ascii=False), encoding="utf-8")
        return p
