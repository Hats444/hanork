import pathlib
p = pathlib.Path('/home/vendetta/hanork/src/modules/smm/services/purchaseGuideService.js')
t = p.read_text(encoding='utf-8')
old = "Outros: 'Leia <b>como comprar</b> em cada produto antes de pagar.',"
new = "Outros: 'Catálogo variado — abra o produto e leia <b>como comprar</b> antes de pagar.',"
if old not in t:
    raise SystemExit('pattern not found')
p.write_text(t.replace(old, new), encoding='utf-8')
print('purchaseGuideService patched')
