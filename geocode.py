"""Resolve each harvested course to the country its coordinates actually fall in.

Bounding-box harvesting picks up neighbours (a course near Prague landed inside
the German box), so the country from the query is not trustworthy. Natural Earth
1:50m boundaries, point-in-polygon, pure Python.
"""
import json, math

_FEATS = None
META = {}                      # ISO2 -> (english name, continent)
CONTINENT_FIX = {'Oceania': 'Oceania', 'Seven seas (open ocean)': 'Other'}

def meta(iso):
    _load()
    return META.get(iso)

def _load():
    global _FEATS
    if _FEATS is not None: return _FEATS
    d = json.load(open('ne50.geojson'))
    _FEATS = []
    for f in d['features']:
        pr = f['properties']
        iso = (pr.get('ISO_A2_EH') or pr.get('ISO_A2') or '').upper()
        if not iso or iso == '-99': continue
        META[iso] = (pr.get('NAME_EN') or pr.get('ADMIN') or iso,
                     CONTINENT_FIX.get(pr.get('CONTINENT'), pr.get('CONTINENT') or 'Other'))
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = []
        for poly in polys:
            outer = poly[0]
            xs = [p[0] for p in outer]; ys = [p[1] for p in outer]
            rings.append((min(xs), min(ys), max(xs), max(ys), outer, poly[1:]))
        _FEATS.append((iso, rings))
    return _FEATS

def _in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside

def country_of(lat, lon):
    if lat is None or lon is None: return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180): return None
    for iso, rings in _load():
        for x0, y0, x1, y1, outer, holes in rings:
            if not (x0 <= lon <= x1 and y0 <= lat <= y1): continue
            if _in_ring(lon, lat, outer) and not any(_in_ring(lon, lat, h) for h in holes):
                return iso
    return None

def nearest_country(lat, lon, max_km=75.0):
    """For points the simplified coastline misses — a links course on the shore —
    take the nearest country instead of trusting the query box."""
    if lat is None or lon is None: return None
    best, best_d = None, float('inf')
    coslat = math.cos(math.radians(lat))
    pad = max_km / 111.0
    for iso, rings in _load():
        for x0, y0, x1, y1, outer, holes in rings:
            if lon < x0 - pad or lon > x1 + pad or lat < y0 - pad or lat > y1 + pad:
                continue
            for px, py in outer:
                dx = (px - lon) * coslat
                dy = py - lat
                d = dx * dx + dy * dy
                if d < best_d:
                    best_d, best = d, iso
    if best is None: return None
    return best if math.sqrt(best_d) * 111.0 <= max_km else None

def place(lat, lon):
    return country_of(lat, lon) or nearest_country(lat, lon)

if __name__ == '__main__':
    tests = [(50.0, 14.2, 'CZ (Vysoký Újezd)'), (48.2, 17.28, 'SK (Bernolákovo)'),
             (52.5, 13.4, 'DE (Berlin)'), (24.41, 54.52, 'AE (Abu Dhabi)'),
             (36.56, -121.94, 'US (Pebble Beach)'), (52.23, 21.0, 'PL (Warsaw)')]
    tests += [(43.46, -3.83, 'ES (Santander, coastal)'), (36.56, -121.94, 'US coastal')]
    for lat, lon, label in tests:
        print(f'{label:26s} exact={country_of(lat, lon)}  placed={place(lat, lon)}')
