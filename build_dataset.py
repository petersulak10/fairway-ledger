"""Merge every source into one packed course dataset for Fairway Ledger.

Record (pipe-delimited, one line per course):
  continent|country|city|club|course|holes|par|parStr|siStr|tees|flags
    parStr  18 chars, par per hole ('' if unknown)
    siStr   18 chars base-36 (1-9, a-i = 10-18), stroke index ('' if unknown)
    tees    name~cr~slope~yards~gender ; ...
    flags   c = hole card is real, r = ratings are real
"""
import csv, json, os, re, unicodedata

B36 = "0123456789abcdefghijklmnopqrstuvwxyz"
CONTINENT = {
 'AE':'Asia','QA':'Asia','OM':'Asia','BH':'Asia','SA':'Asia','KW':'Asia','TR':'Asia',
 'TH':'Asia','VN':'Asia','SG':'Asia','MY':'Asia','ID':'Asia','JP':'Asia','KR':'Asia',
 'CN':'Asia','IN':'Asia','PH':'Asia',
 'CZ':'Europe','SK':'Europe','AT':'Europe','DE':'Europe','GB':'Europe','IE':'Europe',
 'ES':'Europe','PT':'Europe','IT':'Europe','FR':'Europe','NL':'Europe','BE':'Europe',
 'CH':'Europe','PL':'Europe','SE':'Europe','DK':'Europe','NO':'Europe','FI':'Europe','GR':'Europe',
 'MA':'Africa','EG':'Africa','ZA':'Africa','MU':'Africa',
 'AU':'Oceania','NZ':'Oceania',
 'US':'North America','CA':'North America','MX':'North America','DO':'North America',
 'BR':'South America','AR':'South America',
}
COUNTRY = {
 'AE':'United Arab Emirates','QA':'Qatar','OM':'Oman','BH':'Bahrain','SA':'Saudi Arabia',
 'KW':'Kuwait','TR':'Turkey','TH':'Thailand','VN':'Vietnam','SG':'Singapore','MY':'Malaysia',
 'ID':'Indonesia','JP':'Japan','KR':'South Korea','CN':'China','IN':'India','PH':'Philippines',
 'CZ':'Czechia','SK':'Slovakia','AT':'Austria','DE':'Germany','GB':'United Kingdom','IE':'Ireland',
 'ES':'Spain','PT':'Portugal','IT':'Italy','FR':'France','NL':'Netherlands','BE':'Belgium',
 'CH':'Switzerland','PL':'Poland','SE':'Sweden','DK':'Denmark','NO':'Norway','FI':'Finland',
 'GR':'Greece','MA':'Morocco','EG':'Egypt','ZA':'South Africa','MU':'Mauritius',
 'AU':'Australia','NZ':'New Zealand','US':'United States','CA':'Canada','MX':'Mexico',
 'DO':'Dominican Republic','BR':'Brazil','AR':'Argentina',
}
US_STATE = {
 'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado',
 'CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho',
 'IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana',
 'ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota',
 'MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada',
 'NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York',
 'NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon',
 'PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota',
 'TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington',
 'WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia','PR':'Puerto Rico',
}

def clean(s):
    s = re.sub(r'[|~;`\r\n]', ' ', str(s or '')).strip()
    s = re.sub(r'(?i)\s*(?:\(tm\)|\(r\)|™|®)\s*$', '', s)
    s = re.sub(r'(?<=[a-z])tm$', '', s)
    return re.sub(r'\s+', ' ', s)

def norm_key(club, city, country):
    def n(x):
        x = unicodedata.normalize('NFKD', str(x or '').lower())
        x = ''.join(c for c in x if not unicodedata.combining(c))
        x = re.sub(r'\b(golf|club|course|resort|country|the|and|&|de|gc|cc)\b', '', x)
        return re.sub(r'[^a-z0-9]', '', x)
    return (n(club), n(city), n(country))

def si_pack(sis):
    if not sis or any(s in (None, '', 0) for s in sis) or len(sis) != 18: return ''
    try: vals = [int(s) for s in sis]
    except Exception: return ''
    if sorted(vals) != list(range(1, 19)): return ''
    return ''.join(B36[v] for v in vals)

def par_pack(pars):
    if not pars or len(pars) != 18: return ''
    try: vals = [int(p) for p in pars]
    except Exception: return ''
    if any(p < 3 or p > 6 for p in vals): return ''
    return ''.join(str(p) for p in vals)

def tee_pack(tees):
    out = []
    for t in tees:
        out.append('~'.join([clean(t.get('name') or ''),
                             '' if t.get('cr') in (None, '') else str(t['cr']),
                             '' if t.get('slope') in (None, '') else str(int(t['slope'])),
                             '' if t.get('yards') in (None, '') else str(int(t['yards'])),
                             'F' if str(t.get('gender', '')).lower().startswith(('f', 'l', 'w')) else 'M']))
    return ';'.join(out)

records = {}
clubs_seen = set()          # (country, normalised club) -> a better source already has it

def club_key(country, club):
    def n(x):
        x = unicodedata.normalize('NFKD', str(x or '').lower())
        x = ''.join(c for c in x if not unicodedata.combining(c))
        x = re.sub(r'\b(golf|club|course|resort|country|the|and|&|de|gc|cc|park|links)\b', '', x)
        return re.sub(r'[^a-z0-9]', '', x)
    return (n(country), n(club))

UK_NATIONS = {'Scotland', 'England', 'Wales', 'Northern Ireland'}

def add(continent, country, city, club, course, holes, par, pars, sis, tees, src):
    if country in UK_NATIONS:
        country = 'United Kingdom'
    key = norm_key(club, city, country) + (clean(course).lower(),)
    parS, siS = par_pack(pars), si_pack(sis)
    real_r = any(t.get('cr') and t.get('slope') for t in tees)
    flags = ('c' if (parS and siS) else '') + ('r' if real_r else '')
    rec = [clean(continent), clean(country), clean(city) or '—', clean(club),
           clean(course) or 'Main', str(holes or 18), str(par or ''), parS, siS,
           tee_pack(tees), flags, src]
    ck = club_key(country, club)
    if src == 'osm' and ck in clubs_seen:
        return                                        # a better source already has this club
    clubs_seen.add(ck)
    old = records.get(key)
    if old is None or len(old[10]) < len(flags):     # keep the richer record
        records[key] = rec

# ---- 1. UAE, official Emirates Golf Federation ratings -----------------------
if os.path.exists('uae.json'):
    for r in json.load(open('uae.json')):
        add(r['continent'], r['country'], r['city'], r['club'], r['course'], 18, r['par'],
            None, None, r['tees'], 'egf')

# ---- 2. US, OpenGolfAPI harvest (real tees + hole cards) ---------------------
harvested = set()
if os.path.exists('us-courses.ndjson'):
    for line in open('us-courses.ndjson'):
        r = json.loads(line)
        harvested.add(r['id'])
        pars = [h.get('par') for h in r['holes']] if r['holes'] else r['csv_par']
        sis  = [h.get('si')  for h in r['holes']] if r['holes'] else r['csv_hcp']
        yards_by_tee = {}
        for h in (r['holes'] or []):
            for k, v in (h.get('y') or {}).items():
                yards_by_tee[k] = yards_by_tee.get(k, 0) + (v or 0)
        tees = []
        for t in r['tees']:
            y = t.get('yards') or yards_by_tee.get((t.get('color') or '').lower())
            tees.append({'name': t.get('name'), 'cr': t.get('cr'), 'slope': t.get('slope'),
                         'yards': y, 'gender': t.get('gender')})
        add('North America', 'United States', r['city'], r['name'], 'Main',
            r['holes_n'] or 18, r['par'], pars, sis, tees, 'oga')

# ---- 3. US, the rest of the ODbL bulk file (names + pars) -------------------
if os.path.exists('og-us.csv'):
    for r in csv.DictReader(open('og-us.csv')):
        if r['id'] in harvested: continue
        pars = [r.get(f'hole_{i}_par') for i in range(1, 19)]
        sis  = [r.get(f'hole_{i}_hcp') for i in range(1, 19)]
        add('North America', 'United States', r['city'] or US_STATE.get(r['state'], '—'),
            r['name'], 'Main', r['holes'] or 18, r['par'], pars, sis, [], 'odbl')

# ---- 3b. Slovakia, the full Slovak Golf Association register ---------------
try:
    from slovakia import SLOVAKIA
    for club, course, city, holes, par in SLOVAKIA:
        add('Europe', 'Slovakia', city, club, course, holes, par, None, None, [], 'skga')
except ImportError:
    pass

# ---- 3c. Czechia, the full Czech Golf Federation register -----------------
try:
    from czechia import CZECHIA
    for club, course, city, region, holes, par, rated in CZECHIA:
        add('Europe', 'Czechia', city, club, course, holes, par, None, None, [], 'cgf')
except ImportError:
    pass

# ---- 4. Curated worldwide list (locations + par; no invented ratings) ------
try:
    from curated import CURATED
    for continent, country, city, club, course, par in CURATED:
        add(continent, country, city, club, course, 18, par, None, None, [], 'curated')
except ImportError:
    pass

# ---- 5. Worldwide names from OpenStreetMap (Latin-script names only) -------
#         The country a course was harvested under is NOT trusted: the query
#         boxes are rectangles and overlap neighbours, so a course near Prague
#         arrives inside the German box. Every course is placed by its own
#         coordinates instead.
NAME_FIX = {'Czech Republic': 'Czechia', 'United States of America': 'United States',
            'Republic of Serbia': 'Serbia', 'United Kingdom': 'United Kingdom'}
if os.path.exists('data/osm-courses.ndjson') or os.path.exists('osm-courses.ndjson'):
    import geocode
    src_file = 'data/osm-courses.ndjson' if os.path.exists('data/osm-courses.ndjson') else 'osm-courses.ndjson'
    placed = misplaced = unplaced = 0
    for line in open(src_file):
        blk = json.loads(line)
        cc_query = blk['cc']
        if cc_query == 'US': continue
        for c in blk['courses']:
            nm = c.get('name')
            if not nm: continue
            latin = sum(1 for ch in nm if ch.isascii() and ch.isalpha())
            if latin < max(3, len([ch for ch in nm if ch.isalpha()]) * 0.5): continue
            iso = geocode.place(c.get("lat"), c.get("lon"))
            if iso:
                placed += 1
                if iso != cc_query: misplaced += 1
            else:
                unplaced += 1
                iso = cc_query
            m = geocode.meta(iso)
            if not m: continue
            country = NAME_FIX.get(m[0], m[0])
            continent = m[1]
            holes = c.get('holes')
            try: holes = int(holes)
            except Exception: holes = 18
            if holes not in (9, 18, 27, 36): holes = 18
            add(continent, country, c.get('city') or '—', nm, 'Main',
                18 if holes >= 18 else 9, c.get('par'), None, None, [], 'osm')
    print(f'  OSM: {placed} placed by coordinates ({misplaced} were in a different country '
          f'than the query box), {unplaced} kept from the query box')

lines = ['|'.join(v[:11]) for v in records.values()]
lines.sort()
open('courses.psv', 'w', encoding='utf-8').write('\n'.join(lines))
srcs = {}
for v in records.values(): srcs[v[11]] = srcs.get(v[11], 0) + 1
print('courses:', len(lines))
print('by source:', srcs)
print('with real ratings:', sum(1 for v in records.values() if 'r' in v[10]))
print('with real hole card:', sum(1 for v in records.values() if 'c' in v[10]))
print('size:', round(os.path.getsize('courses.psv') / 1048576, 2), 'MB')
