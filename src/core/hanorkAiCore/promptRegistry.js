'use strict';

/**
 * B4 AI-V4.1 — Prompt Registry (versioned templates, sem dependência YAML).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function promptVersion() {
    return String(process.env.HANORK_PROMPT_VERSION || 'v1').trim() || 'v1';
}

function promptsDir(version = promptVersion()) {
    return path.join(REPO_ROOT, 'prompts', version);
}

let _cache = { version: null, registry: null, files: new Map() };

function loadRegistry(version = promptVersion()) {
    if (_cache.version === version && _cache.registry) return _cache.registry;
    const dir = promptsDir(version);
    const regPath = path.join(dir, 'registry.json');
    if (!fs.existsSync(regPath)) {
        throw new Error(`Prompt registry not found: ${regPath}`);
    }
    const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    _cache = { version, registry, files: new Map() };
    return registry;
}

function loadPromptFile(relativeName, version = promptVersion()) {
    const key = `${version}:${relativeName}`;
    if (_cache.files.has(key)) return _cache.files.get(key);
    const full = path.join(promptsDir(version), relativeName);
    if (!fs.existsSync(full)) {
        throw new Error(`Prompt file missing: ${full}`);
    }
    const text = fs.readFileSync(full, 'utf8');
    _cache.files.set(key, text);
    return text;
}

function renderTemplate(template, vars = {}) {
    return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const v = vars[key];
        return v == null ? '' : String(v);
    });
}

function getPrompt(promptId, vars = {}, version = promptVersion()) {
    const registry = loadRegistry(version);
    const rel = registry.prompts?.[promptId];
    if (!rel) return null;
    const raw = loadPromptFile(rel, version);
    return renderTemplate(raw, vars);
}

function getRegistryMeta(version = promptVersion()) {
    const registry = loadRegistry(version);
    const ids = Object.keys(registry.prompts || {});
    const dir = promptsDir(version);
    let hash = '';
    try {
        const parts = ids.map((id) => loadPromptFile(registry.prompts[id], version));
        hash = crypto.createHash('sha256').update(parts.join('\n---\n')).digest('hex').slice(0, 12);
    } catch {
        /* ignore */
    }
    return { version, ids, hash, dir };
}

function clearCache() {
    _cache = { version: null, registry: null, files: new Map() };
}

module.exports = {
    promptVersion,
    promptsDir,
    loadRegistry,
    getPrompt,
    getRegistryMeta,
    renderTemplate,
    clearCache,
};
