import pathlib
import re

p = pathlib.Path('/home/vendetta/hanork/src/modules/smm/services/checkoutService.js')
t = p.read_text(encoding='utf-8')

if 'paymentBelowMinimumMessage' not in t:
    t = t.replace(
        "const { checkoutErrorMessage } = require('../validators/smmActionValidator');",
        "const { checkoutErrorMessage, paymentBelowMinimumMessage } = require('../validators/smmActionValidator');\nconst { quantityUnitLabel } = require('../constants/serviceTypes');",
    )

block = """        if (Number(quantity) < payMinQty) {
            return {
                ok: false,
                error: 'payment_below_minimum',
                message:
                    `Valor mínimo para PIX/cartão: <b>R$ ${MP_MIN_PAYMENT_BRL.toFixed(2).replace('.', ',')}</b>.\\n` +
                    `Use pelo menos <b>${payMinQty.toLocaleString('pt-BR')}</b> un.`,
                minQuantity: payMinQty,
            };
        }"""

replacement = """        if (Number(quantity) < payMinQty) {
            return {
                ok: false,
                error: 'payment_below_minimum',
                message: paymentBelowMinimumMessage({
                    quantity: Number(quantity),
                    total: quote.sale_total,
                    minQuantity: payMinQty,
                    unitLabel: quantityUnitLabel(svc, payMinQty),
                }),
                minQuantity: payMinQty,
            };
        }"""

if block not in t:
    raise SystemExit('first payment block not found')
t = t.replace(block, replacement)

block2 = """        if (!meetsMpMinPayment(saleTotal)) {
            return {
                ok: false,
                error: 'payment_below_minimum',
                message:
                    `Valor mínimo para PIX/cartão: <b>R$ ${MP_MIN_PAYMENT_BRL.toFixed(2).replace('.', ',')}</b>.\\n` +
                    `Use pelo menos <b>${payMinQty.toLocaleString('pt-BR')}</b> un.`,
                minQuantity: payMinQty,
            };
        }"""

replacement2 = """        if (!meetsMpMinPayment(saleTotal)) {
            return {
                ok: false,
                error: 'payment_below_minimum',
                message: paymentBelowMinimumMessage({
                    quantity: Number(quantity),
                    total: saleTotal,
                    minQuantity: payMinQty,
                    unitLabel: quantityUnitLabel(svc, payMinQty),
                }),
                minQuantity: payMinQty,
            };
        }"""

if block2 not in t:
    raise SystemExit('second payment block not found')
t = t.replace(block2, replacement2)

p.write_text(t, encoding='utf-8')
print('checkoutService patched')
