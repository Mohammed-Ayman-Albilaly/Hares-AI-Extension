"""Aggregate docs/gp2-evidence/coverage/coverage-summary.json per module.

Run from the repository root after the coverage run:
    python docs/gp2-evidence/coverage/by-module.py
"""
import json

SUMMARY = 'docs/gp2-evidence/coverage/coverage-summary.json'
OUT = 'docs/gp2-evidence/coverage/coverage-by-module.json'

GROUPS = [
    ('Rules and validators', ['src/detectors/', 'src/rules/']),
    ('Model detector (NER)', ['src/ner/', 'worker/ner.ts']),
    ('Topic rules (decision model)', ['src/topics/', 'worker/topics.ts']),
    ('Pipeline and merge', ['src/pipeline/']),
    ('Decision policy', ['src/policy/']),
    ('Placeholder vault', ['src/masking/']),
    ('Interceptor', ['src/interceptor/']),
    ('Platform adapters', ['src/adapters/']),
    ('Policy sync', ['src/backend/policy-sync.ts', 'src/backend/schedule.ts']),
    ('Uploader, outbox and log events', ['src/backend/uploader.ts', 'src/backend/outbox.ts', 'src/backend/clock.ts', 'src/logging/']),
    ('Session and API', ['src/backend/session.ts', 'src/backend/api.ts', 'src/backend/api-url.ts', 'src/backend/config.ts', 'src/backend/messages.ts']),
    ('Background wiring', ['src/backend/runtime.ts', 'entrypoints/background.ts']),
    ('Popup', ['entrypoints/popup/']),
    ('Dialog and toast', ['src/ui/']),
    ('Offscreen document and worker', ['entrypoints/offscreen/', 'worker/inference.worker.ts']),
    ('Content script entry points', ['entrypoints/chatgpt.content.ts', 'entrypoints/claude.content.ts', 'entrypoints/gemini.content.ts']),
    ('Contract, messaging and helpers', ['src/contract/', 'src/messaging/', 'src/runtime/', 'src/model/']),
]
METRICS = ('statements', 'branches', 'functions', 'lines')

data = json.load(open(SUMMARY, encoding='utf-8'))
marker = '/Hares-AI-Extension/'
files = {}
for path, value in data.items():
    if path == 'total':
        continue
    p = path.replace(chr(92), '/')
    files[p[p.index(marker) + len(marker):]] = value

rows, seen = [], set()
for name, prefixes in GROUPS:
    total = {m: [0, 0] for m in METRICS}
    count = 0
    for rel, value in files.items():
        if any(rel.startswith(prefix) for prefix in prefixes):
            count += 1
            seen.add(rel)
            for m in METRICS:
                total[m][0] += value[m]['covered']
                total[m][1] += value[m]['total']
    row = {'module': name, 'files': count}
    for m in METRICS:
        row[m] = round(100 * total[m][0] / total[m][1], 1) if total[m][1] else None
    rows.append(row)

lowest = sorted(
    ({'file': rel, 'statements': v['statements']['pct'], 'of': v['statements']['total']} for rel, v in files.items() if v['statements']['total'] >= 10),
    key=lambda r: r['statements'],
)[:12]
result = {
    'total': {m: data['total'][m]['pct'] for m in METRICS},
    'modules': rows,
    'leastCoveredFiles': lowest,
    'unassigned': sorted(set(files) - seen),
}
json.dump(result, open(OUT, 'w', encoding='utf-8'), indent=2)
for row in rows:
    print(row)
print('total', result['total'])
print('unassigned', result['unassigned'])
for row in lowest:
    print(row)
