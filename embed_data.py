"""Embed the packed course catalogue into index.html between the data markers."""
import io, re, os, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'data/courses.psv'
data = io.open(SRC, encoding='utf-8').read().strip()
# a JS template literal must not contain backticks or ${
data = data.replace('`', "'").replace('${', '$ {').replace('\\', '/')

block = ('/* DATA-START — packed course catalogue; rebuild with embed_data.py */\n'
         'const COURSE_DATA = `' + data + '`;\n'
         '/* DATA-END */')

p = 'index.html'
s = io.open(p, encoding='utf-8').read()
marker = '/* Course catalogue is loaded from COURSE_DATA (see the dataset block below). */'
if marker in s:
    s = s.replace(marker, block)
else:
    s = re.sub(r'/\* DATA-START.*?/\* DATA-END \*/', block, s, flags=re.S)
io.open(p, 'w', encoding='utf-8').write(s)
print('embedded', len(data.split('\n')), 'courses;', round(os.path.getsize(p) / 1048576, 2), 'MB total')
