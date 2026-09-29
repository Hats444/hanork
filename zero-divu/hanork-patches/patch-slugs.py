import pathlib

p = pathlib.Path('/home/vendetta/hanork/src/modules/smm/utils/platformSlugRegistry.js')
t = p.read_text(encoding='utf-8')

needle = "    Outros: 'out',\n};"
insert = """    Outros: 'out',
    Assinatura: 'ass',
    Pacote: 'pac',
    Diamantes: 'dia',
    Recarga: 'rec',
};"""

if needle not in t:
    raise SystemExit('sub slug block not found')
if 'Assinatura:' in t:
    print('platformSlugRegistry already patched')
else:
    t = t.replace(needle, insert)
    p.write_text(t, encoding='utf-8')
    print('platformSlugRegistry patched')
