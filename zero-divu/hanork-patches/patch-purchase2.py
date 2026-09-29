import pathlib

p = pathlib.Path('/home/vendetta/hanork/src/modules/smm/services/purchaseGuideService.js')
t = p.read_text(encoding='utf-8')

old_qty = """    if (profile.fixedQuantity) {
        return `Este pacote é fixo: <b>${profile.defaultQuantity || service.min_quantity}</b> un.${extraLine}`;
    }"""

new_qty = """    if (profile.fixedQuantity) {
        const q = profile.defaultQuantity || service.min_quantity;
        const unit = normalizeServiceType(service?.service_type) === 'Package' ? 'pacote' : 'un.';
        return `Este pacote é fixo: <b>${q}</b> ${unit}.${extraLine}`;
    }"""

old_detail = """    parts.push(`🛒 <b>Como comprar</b>\\n${buildPurchaseGuideBlock(service)}`);

    return parts.join('\\n\\n');"""

new_detail = """    parts.push(
        '🛒 <b>Como comprar</b>\\n' +
            'Toque em <b>Comprar</b> e siga os passos na tela ' +
            '(dados ou link → quantidade se houver → pagamento).'
    );

    return parts.join('\\n\\n');"""

if old_qty not in t:
    raise SystemExit('qty hint block not found')
if old_detail not in t:
    raise SystemExit('detail extras block not found')

t = t.replace(old_qty, new_qty).replace(old_detail, new_detail)
p.write_text(t, encoding='utf-8')
print('purchaseGuideService patched')
