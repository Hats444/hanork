import pathlib

p = pathlib.Path('/home/vendetta/hanork/src/modules/smm/commands/registerSmmCommands.js')
t = p.read_text(encoding='utf-8')

if 'STALE_CATALOG_MESSAGE' not in t:
    t = t.replace(
        "const { actionErrorMessage, checkoutErrorMessage } = require('../validators/smmActionValidator');",
        "const { actionErrorMessage, checkoutErrorMessage, STALE_CATALOG_MESSAGE } = require('../validators/smmActionValidator');",
    )

t = t.replace(
    "'Menu desatualizado. Abra o catálogo SMM novamente.'",
    'STALE_CATALOG_MESSAGE',
)

p.write_text(t, encoding='utf-8')
print('registerSmmCommands patched')
