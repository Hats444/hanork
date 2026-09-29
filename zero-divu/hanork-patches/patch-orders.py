import pathlib

p = pathlib.Path('/home/vendetta/hanork/src/modules/smm/handlers/smmOrderActionsHandler.js')
t = p.read_text(encoding='utf-8')
t = t.replace('formatOrderLine(o, svc?.name)', 'formatOrderLine(o, svc?.name, svc)')
p.write_text(t, encoding='utf-8')
print('smmOrderActionsHandler patched')
