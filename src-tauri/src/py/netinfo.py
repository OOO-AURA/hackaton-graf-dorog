"""Reads a SUMO network and prints JSON with traffic light positions and, when zones are given,
the edges that serve each zone. Usage: netinfo.py net.xml zones.json out.json"""
import json
import os
import sys

sys.path.append(os.path.join(os.environ["SUMO_HOME"], "tools"))
import sumolib  # noqa: E402

net = sumolib.net.readNet(sys.argv[1], withInternal=False)
zones = json.load(open(sys.argv[2])) if len(sys.argv) > 3 else []

# pyproj is often missing, so the UTM projection netconvert uses is done here (WGS84, Krueger series).
import math  # noqa: E402

_loc = net._location
_off = [float(v) for v in str(_loc["netOffset"]).split(",")]
_proj = str(_loc["projParameter"])
_zone = int(_proj.split("+zone=")[1].split()[0]) if "+zone=" in _proj else 0
_south = "+south" in _proj
_a, _f, _k0 = 6378137.0, 1 / 298.257223563, 0.9996
_n = _f / (2 - _f)
_A = _a / (1 + _n) * (1 + _n ** 2 / 4 + _n ** 4 / 64)
_al = [_n / 2 - 2 * _n ** 2 / 3 + 5 * _n ** 3 / 16, 13 * _n ** 2 / 48 - 3 * _n ** 3 / 5, 61 * _n ** 3 / 240]
_be = [_n / 2 - 2 * _n ** 2 / 3 + 37 * _n ** 3 / 96, _n ** 2 / 48 + _n ** 3 / 15, 17 * _n ** 3 / 480]
_de = [2 * _n - 2 * _n ** 2 / 3 - 2 * _n ** 3, 7 * _n ** 2 / 3 - 8 * _n ** 3 / 5, 56 * _n ** 3 / 15]
_lon0 = math.radians(_zone * 6 - 183)
_N0 = 10000000.0 if _south else 0.0


def to_xy(lon, lat):
    if not _zone:
        return lon + _off[0], lat + _off[1]
    phi, lam = math.radians(lat), math.radians(lon) - _lon0
    e = 2 * math.sqrt(_n) / (1 + _n)
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi, eta = math.atan2(t, math.cos(lam)), math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
    x = eta + sum(_al[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    y = xi + sum(_al[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    return 500000 + _k0 * _A * x + _off[0], _N0 + _k0 * _A * y + _off[1]


def to_lonlat(x, y):
    if not _zone:
        return x - _off[0], y - _off[1]
    xi = (y - _off[1] - _N0) / (_k0 * _A)
    eta = (x - _off[0] - 500000) / (_k0 * _A)
    xp = xi - sum(_be[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    ep = eta - sum(_be[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    chi = math.asin(math.sin(xp) / math.cosh(ep))
    phi = chi + sum(_de[j] * math.sin(2 * (j + 1) * chi) for j in range(3))
    return math.degrees(_lon0 + math.atan2(math.sinh(ep), math.cos(xp))), math.degrees(phi)


def drivable(e):
    return e.allows("passenger") and e.getFunction() == ""


def nearest(lon, lat, need_out):
    x, y = to_xy(lon, lat)
    for r in (100, 300, 1000, 5000):
        found = [(d, e) for e, d in net.getNeighboringEdges(x, y, r) if drivable(e)
                 and (e.getOutgoing() if need_out else e.getIncoming())]
        if found:
            return min(found, key=lambda p: p[0])[1].getID()
    return None


tls = []
for t in net.getTrafficLights():
    nodes = {c[0].getEdge().getToNode() for c in t.getConnections()}
    if not nodes:
        continue
    cx = sum(n.getCoord()[0] for n in nodes) / len(nodes)
    cy = sum(n.getCoord()[1] for n in nodes) / len(nodes)
    lon, lat = to_lonlat(cx, cy)
    # One signal head per incoming lane, 4 m before the stop line, showing its first link.
    heads = {}
    for in_lane, _out, index in t.getConnections():
        if in_lane.getID() in heads:
            continue
        (x0, y0), (x1, y1) = in_lane.getShape()[-2:]
        d = max(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5, 1e-6)
        k = min(4.0, d) / d
        heads[in_lane.getID()] = (index, to_lonlat(x1 - (x1 - x0) * k, y1 - (y1 - y0) * k))
    tls.append({"id": t.getID(), "lon": lon, "lat": lat,
                "heads": [[i, p[0], p[1]] for i, p in heads.values()]})

out = {
    "tls": tls,
    "zones": [{"from": nearest(z[0], z[1], True), "to": nearest(z[0], z[1], False)} for z in zones],
}
json.dump(out, open(sys.argv[-1], "w"))
