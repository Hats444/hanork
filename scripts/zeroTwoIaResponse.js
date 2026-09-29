'use strict';

/**
 * Normaliza respostas JSON das rotas IA Zero Two.
 *
 * Formatos observados (probe scripts/probe-ia-api-responses.js):
 *
 * gpt / gpt4 / zerotwo — sucesso:
 *   { status: true, resultado: "texto", criador: "@..." }
 *
 * gpt / gpt4 — erro (HTTP 200):
 *   { status: false, criador: "@...", error: "Todos os métodos... 429" }
 *
 * gemini /gemini/texto/imagem — erro (HTTP 500):
 *   { error: "Ocorreu um erro...", detalhes: "{\"error\":{\"code\":429,...}}" }
 *
 * gemini — sucesso (variantes possíveis):
 *   { status: true, resultado: "texto" }
 *   { status: true, texto: "texto" }
 *   { resultado: { candidates: [{ content: { parts: [{ text: "..." }] } }] } }
 */

function pickString(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function parseDetalhesField(detalhes) {
    if (detalhes == null) return null;
    if (typeof detalhes === 'object') return detalhes;
    if (typeof detalhes === 'string') {
        const s = detalhes.trim();
        if (!s) return null;
        if (s.startsWith('{') || s.startsWith('[')) {
            try {
                return JSON.parse(s);
            } catch {
                return { _raw: s };
            }
        }
        return { _raw: s };
    }
    return null;
}

function isExplicitBadStatus(data) {
    const status = data?.status;
    return (
        status === false ||
        status === 0 ||
        status === '0' ||
        status === 'error' ||
        status === 'false'
    );
}

function isExplicitOkStatus(data) {
    const status = data?.status;
    return (
        status === true ||
        status === 1 ||
        status === '1' ||
        status === 'ok' ||
        status === 'success' ||
        status === 'true'
    );
}

function looksLikeErrorPayload(data) {
    if (!data || typeof data !== 'object') return false;
    if (isExplicitBadStatus(data)) return true;
    const errMsg = pickString(data.error || data.erro);
    const hasResult =
        pickString(data.resultado) ||
        pickString(data.texto) ||
        pickString(data.resposta) ||
        pickString(data.result);
    if (errMsg && !hasResult && !data.candidates && !data.choices) return true;
    if (data.detalhes && !hasResult && errMsg) return true;
    return false;
}

function extractFromGeminiCandidates(obj) {
    const pools = [obj?.candidates, obj?.resultado?.candidates, obj?.data?.candidates];
    for (const candidates of pools) {
        if (!Array.isArray(candidates)) continue;
        for (const c of candidates) {
            const parts = c?.content?.parts || c?.parts;
            if (!Array.isArray(parts)) continue;
            for (const p of parts) {
                const t = pickString(p?.text ?? p?.content);
                if (t) return t;
            }
        }
    }
    return '';
}

function extractFromChoices(obj) {
    const choices = obj?.choices || obj?.resultado?.choices;
    if (!Array.isArray(choices)) return '';
    for (const c of choices) {
        const t = pickString(c?.message?.content ?? c?.text ?? c?.delta?.content);
        if (t) return t;
    }
    return '';
}

function extractFromNestedResultado(obj) {
    const r = obj?.resultado;
    if (r == null) return '';
    if (typeof r === 'string') return pickString(r);
    if (typeof r !== 'object') return '';
    const direct =
        pickString(r.texto) ||
        pickString(r.text) ||
        pickString(r.content) ||
        pickString(r.resposta) ||
        pickString(r.message) ||
        pickString(r.output);
    if (direct) return direct;
    return extractFromGeminiCandidates(r) || extractFromChoices(r);
}

function extractIaResponseText(data) {
    if (data == null) return '';
    if (typeof data === 'string') {
        const s = data.trim();
        if (s.startsWith('{') || s.startsWith('[')) {
            try {
                return extractIaResponseText(JSON.parse(s));
            } catch {
                return s;
            }
        }
        return s;
    }
    if (typeof data !== 'object') return '';

    if (looksLikeErrorPayload(data)) return '';

    const direct =
        extractFromNestedResultado(data) ||
        pickString(data.resposta) ||
        pickString(data.result) ||
        pickString(data.texto) ||
        pickString(data.text) ||
        pickString(data.content) ||
        pickString(data.resposta_texto) ||
        pickString(data.respostaTexto) ||
        pickString(data.output) ||
        pickString(data.answer) ||
        pickString(data.response);

    if (direct) return direct;

    if (isExplicitOkStatus(data) && pickString(data.message)) {
        return pickString(data.message);
    }

    return extractFromGeminiCandidates(data) || extractFromChoices(data);
}

function collectErrorMessages(data, httpStatus) {
    const msgs = [];
    if (httpStatus === 403) msgs.push('API Key inválida (403)');
    if (httpStatus === 429) msgs.push('429');
    if (!data || typeof data !== 'object') return msgs;

    for (const k of ['error', 'erro', 'message', 'detalhes']) {
        const v = data[k];
        if (typeof v === 'string' && v.trim()) msgs.push(v);
    }

    const det = parseDetalhesField(data.detalhes);
    if (det) {
        if (det.error?.message) msgs.push(String(det.error.message));
        if (det.error?.code != null) msgs.push(String(det.error.code));
        if (det.message) msgs.push(String(det.message));
        if (det._raw) msgs.push(String(det._raw));
    }
    return msgs;
}

function is429Error(err, data, httpStatus, headers) {
    const code = httpStatus ?? err?.response?.status ?? data?.statusCode;
    if (code === 429) return true;

    const h = headers?.['retry-after'] ?? headers?.['Retry-After'] ?? err?.response?.headers;
    const retryAfter = h?.['retry-after'] ?? h?.['Retry-After'];
    if (Number(retryAfter) > 0) return true;

    const blob = collectErrorMessages(data, httpStatus).join(' ').toLowerCase();
    const errMsg = String(err?.message || '').toLowerCase();
    const combined = `${blob} ${errMsg}`;
    return (
        combined.includes('429') ||
        combined.includes('rate limit') ||
        combined.includes('too many') ||
        combined.includes('quota exceeded') ||
        combined.includes('resource_exhausted')
    );
}

function isHtmlOrAuthError(data, httpStatus) {
    if (httpStatus === 403) return true;
    if (typeof data === 'string') {
        const s = data.toLowerCase();
        return (
            s.includes('<html') ||
            s.includes('api key inválida') ||
            s.includes('api key invalida')
        );
    }
    if (data && typeof data === 'object') {
        const blob = collectErrorMessages(data, httpStatus).join(' ').toLowerCase();
        if (blob.includes('api key inválida') || blob.includes('api key invalida')) return true;
    }
    return false;
}

function isGatewayHttpStatus(httpStatus) {
    const code = Number(httpStatus);
    return code >= 502 && code <= 504;
}

function isGatewayError(data, httpStatus) {
    if (isGatewayHttpStatus(httpStatus)) return true;
    if (typeof data === 'string') {
        const s = data.toLowerCase();
        if (!s.includes('<html') && !s.includes('bad gateway') && !s.includes('service unavailable')) {
            return false;
        }
        return (
            s.includes('502') ||
            s.includes('503') ||
            s.includes('504') ||
            s.includes('bad gateway') ||
            s.includes('service unavailable') ||
            s.includes('gateway time-out') ||
            s.includes('gateway timeout')
        );
    }
    return false;
}

function buildApiError(data, httpStatus) {
    if (httpStatus === 403) return new Error('API Key inválida (403)');
    const msgs = collectErrorMessages(data, httpStatus).filter(Boolean);
    if (msgs.length) return new Error(msgs[0]);
    if (httpStatus >= 400) return new Error(`API HTTP ${httpStatus}`);
    if (data && typeof data === 'object') {
        try {
            const preview = JSON.stringify(data).slice(0, 200);
            if (preview.length > 2) {
                return new Error(`API erro (HTTP ${httpStatus || 200}): ${preview}`);
            }
        } catch {
            /* ignore */
        }
    }
    return new Error('API retornou erro');
}

function parseIaApiBody(data, httpStatus, headers) {
    if (isGatewayError(data, httpStatus)) {
        const err = new Error(`API gateway indisponível (HTTP ${httpStatus || 502})`);
        err.code = 'GATEWAY_OUTAGE';
        throw err;
    }
    if (isHtmlOrAuthError(data, httpStatus)) {
        throw buildApiError(data, httpStatus);
    }
    if (is429Error(null, data, httpStatus, headers)) {
        throw new Error('Request failed with status code 429');
    }

    if (looksLikeErrorPayload(data) && !extractIaResponseText(data)) {
        throw buildApiError(data, httpStatus);
    }

    const raw = extractIaResponseText(data);
    if (!raw) {
        if (httpStatus >= 400) throw buildApiError(data, httpStatus);
        throw new Error('Resposta vazia da API');
    }
    return raw;
}

module.exports = {
    parseDetalhesField,
    extractIaResponseText,
    parseIaApiBody,
    is429Error,
    isHtmlOrAuthError,
    isGatewayError,
    isGatewayHttpStatus,
    looksLikeErrorPayload,
    collectErrorMessages,
    /** @deprecated alias */
    extractRawText: extractIaResponseText,
    /** @deprecated alias */
    parseGptBody: parseIaApiBody,
};
