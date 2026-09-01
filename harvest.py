"""Top up US course ratings from OpenGolfAPI (ODbL, no key needed).

The open API caps anonymous callers at a few hundred lookups a day, so this
is resumable: run it, it appends what it got to data/us-courses.ndjson and
picks up where it left off next time. Rebuild the app afterwards with
    python3 build_dataset.py && python3 embed_data.py data/courses.psv
"""
import csv, json, urllib.request, urllib.error, os, sys, time
import concurrent.futures as cf

BULK = 'data/opengolfapi-us.csv'
BULK_URL = ('https://github.com/opengolfapi/data/releases/download/v2.1.0/'
            'opengolfapi-us.csv')
if not os.path.exists(BULK):
    print('downloading the ODbL bulk file...', flush=True)
    os.makedirs('data', exist_ok=True)
    urllib.request.urlretrieve(BULK_URL, BULK)

ROWS = list(csv.DictReader(open(BULK)))
OUT  = 'data/us-courses.ndjson'
done = set()
if os.path.exists(OUT):
    for line in open(OUT):
        try: done.add(json.loads(line)['id'])
        except Exception: pass
todo = [r for r in ROWS if r['id'] not in done]
print(f'{len(done)} already done, {len(todo)} to fetch', flush=True)

def get(path, tries=3):
    for a in range(tries):
        try:
            req = urllib.request.Request('https://api.opengolfapi.org' + path,
                                         headers={'User-Agent': 'fairway-ledger-dataset-build'})
            with urllib.request.urlopen(req, timeout=25) as f:
                return json.load(f)
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503): time.sleep(1.5 * (a + 1)); continue
            return None
        except Exception:
            time.sleep(0.8 * (a + 1))
    return None

def work(r):
    t = get(f"/v1/courses/{r['id']}/tees")
    tees = (t or {}).get('tees') or []
    if not tees:
        return None                      # no rating/slope -> not worth carrying
    h = get(f"/v1/courses/{r['id']}/holes")
    holes = (h or {}).get('holes') or []
    return {
        'id': r['id'], 'name': r['name'], 'city': r['city'], 'state': r['state'],
        'country': r['country'], 'par': r['par'], 'holes_n': r['holes'],
        'csv_par': [r.get(f'hole_{i}_par') for i in range(1, 19)],
        'csv_hcp': [r.get(f'hole_{i}_hcp') for i in range(1, 19)],
        'tees': [{'name': x.get('tee_name'), 'color': x.get('tee_color'),
                  'gender': x.get('gender'), 'cr': x.get('course_rating'),
                  'slope': x.get('slope'), 'par': x.get('par'), 'yards': x.get('yardage')}
                 for x in tees],
        'holes': [{'n': x.get('number'), 'par': x.get('par'), 'si': x.get('handicap_index'),
                   'y': x.get('yardages')} for x in holes],
    }

n = 0
t0 = time.time()
with open(OUT, 'a') as out, cf.ThreadPoolExecutor(10) as ex:
    for rec in ex.map(work, todo):
        n += 1
        if rec:
            out.write(json.dumps(rec, ensure_ascii=False) + '\n')
        if n % 250 == 0:
            out.flush()
            el = time.time() - t0
            print(f'{n}/{len(todo)}  {n/el:.1f}/s  eta {(len(todo)-n)/(n/el)/60:.0f} min', flush=True)
print('DONE', n, flush=True)
