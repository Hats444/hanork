import pathlib

p = pathlib.Path('/home/vendetta/hanork/src/modules/smm/helpers/smmUserNotify.js')
t = p.read_text(encoding='utf-8')

if 'formatQuantityDisplay' not in t:
    t = t.replace(
        "const { formatMoney } = require('../utils/smmTextFormat');",
        "const { formatMoney } = require('../utils/smmTextFormat');\nconst { formatQuantityDisplay } = require('../constants/serviceTypes');",
    )

t = t.replace(
    "`Quantidade: <b>${Number(quantity).toLocaleString('pt-BR')}</b>\\n`",
    "`Quantidade: <b>${formatQuantityDisplay(svc, quantity)}</b>\\n`",
)

p.write_text(t, encoding='utf-8')
print('smmUserNotify patched')
