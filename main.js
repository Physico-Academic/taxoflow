"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");

const TAXOFLOW_PROPERTY_PREFIX = "taxo.";
const DEFAULT_SETTINGS = { profiles: [], activeProfileId: "", suppressedAutoRegistrationKeys: [], universalExcludedFolders: [], propertySchemas: [], globalPropertyLabels: {} };
function stripPropertyRootPrefix(value) {
    const text = String(value || "");
    return text.startsWith(TAXOFLOW_PROPERTY_PREFIX) ? text.slice(TAXOFLOW_PROPERTY_PREFIX.length) : text;
}
function isValidProfileNamespace(namespace) {
    const value = String(namespace || "");
    return value.startsWith(TAXOFLOW_PROPERTY_PREFIX) && /^[a-z0-9_-]+_$/.test(value.slice(TAXOFLOW_PROPERTY_PREFIX.length));
}
const EMPTY_ARRAY = Object.freeze([]);

function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(v => String(v ?? "").trim()).filter(Boolean))];
}
function slugify(value) {
    return String(value || "").toLocaleLowerCase().trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "profile";
}
function humanize(value) {
    const text = stripPropertyRootPrefix(value).replace(/^[a-z0-9]+_/, "").replace(/[_-]+/g, " ").trim();
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : "";
}
function parseOptionList(value) {
    if (Array.isArray(value)) return uniqueStrings(value);
    if (typeof value !== "string") return [];
    const result = [];
    let current = "", quoted = false, quote = "", escaped = false;
    const push = () => { const value = current.trim(); if (value) result.push(value); current = ""; };
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) { current += ch; escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (quoted) {
            if (ch === quote) {
                if (value[i + 1] === quote) { current += quote; i++; }
                else quoted = false;
            } else current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") { quoted = true; quote = ch; continue; }
        if (ch === "," || ch === "\n" || ch === "\r") { push(); if (ch === "\r" && value[i + 1] === "\n") i++; continue; }
        current += ch;
    }
    if (escaped) current += "\\";
    push();
    return uniqueStrings(result);
}
function normalizeDependsOn(value) {
    return uniqueStrings(Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []);
}
function normalizeRules(value) {
    if (!Array.isArray(value)) return [];
    const output = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.when || typeof raw.when !== "object" || Array.isArray(raw.when)) continue;
        const when = {};
        for (const [key, val] of Object.entries(raw.when)) {
            const cleanKey = String(key || "").trim();
            const values = parseOptionList(val);
            if (cleanKey && values.length) when[cleanKey] = values;
        }
        const logic = String(raw.logic || raw.match || "and").toLocaleLowerCase() === "or" ? "or" : "and";
        output.push({ when, options: parseOptionList(raw.options), logic });
    }
    return output;
}
function normalizeCustomContexts(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(x => x && typeof x === "object" && x.context && typeof x.context === "object")
        .map(x => {
            const context = {};
            for (const [key, val] of Object.entries(x.context)) context[key] = parseOptionList(val);
            return { context, options: parseOptionList(x.options) };
        }).filter(x => Object.keys(x.context).length > 0 && x.options.length > 0);
}
function namespacesOverlap(a, b) { return a === b || a.startsWith(b) || b.startsWith(a); }
function profileNameKey(value) { return String(value || "").trim().toLocaleLowerCase(); }
function profileNameAvailable(name, profiles, exceptProfile = null) {
    const key = profileNameKey(name);
    return Boolean(key) && !(Array.isArray(profiles) ? profiles : []).some(profile => profile !== exceptProfile && profileNameKey(profile?.name) === key);
}
function profileNamespaceAvailable(namespace, profiles, exceptProfile = null) {
    const value = String(namespace || "");
    return Boolean(value) && !(Array.isArray(profiles) ? profiles : []).some(profile => profile !== exceptProfile && namespacesOverlap(profile?.namespace || "", value));
}
function matchingProfilesForPropertyKey(key, profiles) {
    const value = String(key || "");
    if (!value.startsWith(TAXOFLOW_PROPERTY_PREFIX)) return [];
    return (Array.isArray(profiles) ? profiles : []).filter(profile => typeof profile?.namespace === "string" && profile.namespace && value.startsWith(profile.namespace));
}
function normalizeFolderPath(path) {
    return String(path || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
function isFileInExcludedFolder(file, profileExcluded, universalExcluded = []) {
    if (!file || !file.parent) return false;
    const combined = uniqueStrings([...(profileExcluded || []), ...(universalExcluded || [])]);
    if (!combined.length) return false;
    const parentPath = normalizeFolderPath(file.parent.path);
    return combined.some(folder => {
        const excluded = normalizeFolderPath(folder);
        if (!excluded) return false;
        return parentPath === excluded || parentPath.startsWith(`${excluded}/`);
    });
}
function getMatchingProfilesForFrontmatterKeys(keys, profiles) {
    const matched = new Set();
    const keyList = Array.isArray(keys) ? keys : (keys instanceof Set ? Array.from(keys) : Object.keys(keys || {}));
    for (const key of keyList) {
        for (const profile of matchingProfilesForPropertyKey(key, profiles)) {
            matched.add(profile);
        }
    }
    return Array.from(matched);
}
function resolveTargetFolderForProfiles(matchingProfiles) {
    const withFolders = (matchingProfiles || []).filter(p => normalizeFolderPath(p?.defaultFolder).length > 0);
    if (!withFolders.length) return { status: "none", folder: null, profiles: [] };
    const folderMap = new Map();
    for (const p of withFolders) {
        const folder = normalizeFolderPath(p.defaultFolder);
        if (!folderMap.has(folder)) folderMap.set(folder, []);
        folderMap.get(folder).push(p);
    }
    if (folderMap.size === 1) {
        return { status: "single", folder: folderMap.keys().next().value, profiles: withFolders };
    }
    return { status: "conflict", folder: null, profiles: withFolders, folders: Array.from(folderMap.keys()) };
}
function getOrphanSelectorKeys(propertyKeys, profiles) {
    return [...new Set((Array.isArray(propertyKeys) ? propertyKeys : []).map(value => String(value || "").trim()).filter(key =>
        key.startsWith(TAXOFLOW_PROPERTY_PREFIX) && matchingProfilesForPropertyKey(key, profiles).length !== 1
    ))].sort((a, b) => a.localeCompare(b));
}
function isValidProfilePropertyKey(key, profile) {
    if (!profile || typeof key !== "string" || !key.startsWith(profile.namespace)) return false;
    const suffix = key.slice(profile.namespace.length);
    return Boolean(suffix) && /^[a-z0-9_-]+$/.test(suffix);
}
function remapRecordKeys(record, mapping) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return {};
    const out = {};
    for (const [key, value] of Object.entries(record)) out[mapping?.[key] || key] = value;
    return out;
}
function normalizeSelector(raw) {
    const name = typeof raw?.name === "string" ? raw.name : "";
    const dependsOn = normalizeDependsOn(raw?.dependsOn);
    let rules = normalizeRules(raw?.rules);
    if (!rules.length) {
        rules = normalizeRules(raw?.optionsByContext);
        const oldMap = raw?.optionsByValue;
        if (oldMap && typeof oldMap === "object" && !Array.isArray(oldMap) && dependsOn.length === 1) {
            for (const [parentValue, options] of Object.entries(oldMap)) {
                rules.push({ when: { [dependsOn[0]]: [parentValue] }, options: parseOptionList(options), logic: "and" });
            }
        }
    }
    const customOptionsByContext = normalizeCustomContexts(raw?.customOptionsByContext);
    const options = parseOptionList(raw?.options);
    const allConfiguredOptions = uniqueStrings([
        ...options,
        ...rules.flatMap(rule => parseOptionList(rule.options)),
        ...customOptionsByContext.flatMap(entry => parseOptionList(entry.options)),
    ]);

    let defaultValue = typeof raw?.defaultValue === "string" ? raw.defaultValue.trim() : "";
    if (!defaultValue && raw?.defaultFirst && allConfiguredOptions.length) defaultValue = allConfiguredOptions[0];
    return {
        name,
        label: typeof raw?.label === "string" ? raw.label : humanize(name),
        options,
        defaultValue,
        dependsOn,
        rules,
        customOptionsByContext,
    };
}
function normalizeProfile(raw) {
    const namespace = typeof raw?.namespace === "string" && raw.namespace.trim() ? raw.namespace.trim() : `${TAXOFLOW_PROPERTY_PREFIX}profile_`;
    const selectors = (Array.isArray(raw?.selectors) ? raw.selectors : [])
        .map(item => normalizeSelector(item))
        .filter(item => item.name);
    const labels = {};
    if (raw?.propertyLabels && typeof raw.propertyLabels === "object" && !Array.isArray(raw.propertyLabels)) {
        for (const [key, label] of Object.entries(raw.propertyLabels)) {
            if (typeof label === "string" && label.trim()) labels[key] = label.trim();
        }
    return {
        id: String(raw?.id || slugify(raw?.name || namespace)),
        name: String(raw?.name || humanize(namespace) || "Profile"),
        namespace,
        selectors,
        propertyLabels: labels,
        defaultFolder: String(raw?.defaultFolder || "").trim(),
        excludedFolders: Array.isArray(raw?.excludedFolders) ? raw.excludedFolders.map(f => normalizeFolderPath(f)).filter(Boolean) : [],
    };
    }
    return {
        id: String(raw?.id || slugify(raw?.name || namespace)),
        name: String(raw?.name || humanize(namespace) || "Profile"),
        namespace,
        selectors,
        propertyLabels: labels,
        defaultFolder: String(raw?.defaultFolder || "").trim(),
    };
}
function normalizeSavedSettings(saved) {
    const hasSavedSettings = Boolean(saved && typeof saved === "object");
    let migrated = hasSavedSettings && saved.schemaVersion !== 4;
    const unsupportedFlatSchema = !Array.isArray(saved?.profiles) && Array.isArray(saved?.selectors) && saved.selectors.length > 0;
    const savedProfiles = Array.isArray(saved?.profiles) ? saved.profiles : [];
    
    if (savedProfiles.some(profile => (Array.isArray(profile?.selectors) ? profile.selectors : []).some(selector =>
        Object.prototype.hasOwnProperty.call(selector || {}, "defaultFirst") || !Object.prototype.hasOwnProperty.call(selector || {}, "defaultValue")
    ))) migrated = true;

    const globalPropertyLabels = saved?.globalPropertyLabels || {};

    const profiles = savedProfiles.map(profile => {
        const p = normalizeProfile(profile);
        if (p.propertyLabels && Object.keys(p.propertyLabels).length > 0) {
            for (const [k, v] of Object.entries(p.propertyLabels)) {
                globalPropertyLabels[k] = v;
            }
            p.propertyLabels = {};
            migrated = true;
        }
        return p;
    });

    const activeProfileId = profiles.some(profile => profile.id === saved?.activeProfileId)
        ? saved.activeProfileId
        : (profiles[0]?.id || "");
    const suppressedAutoRegistrationKeys = uniqueStrings(saved?.suppressedAutoRegistrationKeys)
        .filter(key => key.startsWith(TAXOFLOW_PROPERTY_PREFIX));
    const universalExcludedFolders = Array.isArray(saved?.universalExcludedFolders) ? saved.universalExcludedFolders.map(f => normalizeFolderPath(f)).filter(Boolean) : [];
    const propertySchemas = (Array.isArray(saved?.propertySchemas) ? saved.propertySchemas : []).map(schema => {
        if (!schema.conditions && schema.triggerKey) {
            schema.conditions = [{ key: schema.triggerKey, value: schema.triggerValue }];
            schema.matchType = "ALL";
            migrated = true;
        }
        return schema;
    });
    
    return {
        settings: { profiles, activeProfileId, suppressedAutoRegistrationKeys, universalExcludedFolders, propertySchemas, globalPropertyLabels },
        migrated: migrated && !unsupportedFlatSchema,
        unsupportedFlatSchema,
    };
}

function ruleLogic(rule) { return String(rule?.logic || "and").toLocaleLowerCase() === "or" ? "or" : "and"; }
function ruleSpecificity(rule) {
    const entries = Object.entries(rule?.when || {}).filter(([, vals]) => parseOptionList(vals).length > 0);
    const valueCount = entries.reduce((sum, [, vals]) => sum + parseOptionList(vals).length, 0);

    if (ruleLogic(rule) === "or" && entries.length > 1) return [-entries.length, -valueCount];
    return [entries.length, -valueCount];
}
function compareSpecificity(a, b) {
    const sa = ruleSpecificity(a), sb = ruleSpecificity(b);
    return sb[0] - sa[0] || sb[1] - sa[1];
}
function ruleBranches(rule) {
    const entries = Object.entries(rule?.when || {}).map(([key, raw]) => [key, parseOptionList(raw)]).filter(([, values]) => values.length > 0);
    if (!entries.length) return [];
    if (ruleLogic(rule) === "or") return entries.map(([key, values]) => ({ [key]: values }));
    return [Object.fromEntries(entries)];
}
function conjunctionsOverlap(a, b) {
    for (const key of Object.keys(a)) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
        const av = parseOptionList(a[key]), bv = parseOptionList(b[key]);
        if (!av.some(value => bv.includes(value))) return false;
    }
    return true;
}
function rulesOverlap(a, b) {
    const aBranches = ruleBranches(a), bBranches = ruleBranches(b);
    return aBranches.some(ab => bBranches.some(bb => conjunctionsOverlap(ab, bb)));
}
function conflictingRulePairs(rules) {
    const conflicts = [];
    for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
        if (compareSpecificity(rules[i], rules[j]) !== 0 || !rulesOverlap(rules[i], rules[j])) continue;
        if (JSON.stringify(parseOptionList(rules[i].options)) !== JSON.stringify(parseOptionList(rules[j].options))) conflicts.push([i, j]);
    }
    return conflicts;
}
function mergeRuleConstraints(existing, branch) {
    const merged = new Map([...existing.entries()].map(([key, values]) => [key, parseOptionList(values)]));
    for (const [key, rawValues] of Object.entries(branch || {})) {
        const values = parseOptionList(rawValues);
        if (!values.length) return null;
        if (merged.has(key)) {
            const intersection = values.filter(value => merged.get(key).includes(value));
            if (!intersection.length) return null;
            merged.set(key, intersection);
        } else merged.set(key, values);
    }
    return merged;
}

function describeConstraintConflict(existing, branch) {
    for (const [key, rawValues] of Object.entries(branch || {})) {
        const nextValues = parseOptionList(rawValues);
        if (!existing.has(key)) continue;
        const priorValues = parseOptionList(existing.get(key));
        if (!priorValues.some(value => nextValues.includes(value))) {
            return `${key} must be ${priorValues.join(" or ")} in the required ancestor context, but this rule requires ${nextValues.join(" or ")}.`;
        }
    }
    return "The parent conditions contradict an existing dependency constraint.";
}

function inspectSelectorContextFeasibility(key, constraints, byName, visiting = new Set(), memo = new Map()) {
    const selector = byName.get(key);
    if (!selector) return { status: "unknown", reason: `The parent selector ${key} is not configured.` };
    const dependencies = normalizeDependsOn(selector.dependsOn);
    if (!dependencies.length) return { status: "possible", reason: "" };
    if (visiting.has(key)) return { status: "unknown", reason: `Dependency cycle encountered while evaluating ${key}.` };
    const normalizedConstraints = [...constraints.entries()]
        .map(([parent, values]) => [parent, parseOptionList(values).slice().sort()])
        .sort(([a], [b]) => a.localeCompare(b));
    const visitingSignature = [...visiting].sort().join("\u0001");
    const memoKey = `${key}\u0000${JSON.stringify(normalizedConstraints)}\u0000${visitingSignature}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const rules = normalizeRules(selector.rules).filter(rule => parseOptionList(rule.options).length > 0);
    if (!rules.length) {
        const result = { status: "impossible", reason: `${key} is dependent but has no rule that offers options in this context.` };
        memo.set(memoKey, result); return result;
    }
    const nextVisiting = new Set(visiting); nextVisiting.add(key);
    const unresolved = [];
    const blocked = [];
    for (const rule of rules) {
        for (const branch of ruleBranches(rule)) {
            const merged = mergeRuleConstraints(constraints, branch);
            if (!merged) { blocked.push(describeConstraintConflict(constraints, branch)); continue; }
            let branchStatus = "possible";
            let branchReason = "";
            const requiredParents = new Set(Object.keys(branch));
            if (ruleLogic(rule) === "and") dependencies.forEach(parent => requiredParents.add(parent));
            for (const parentKey of requiredParents) {
                const result = inspectSelectorContextFeasibility(parentKey, merged, byName, nextVisiting, memo);
                if (result.status === "impossible") { branchStatus = "impossible"; branchReason = result.reason; break; }
                if (result.status === "unknown" && branchStatus !== "impossible") { branchStatus = "unknown"; branchReason = result.reason; }
            }
            if (branchStatus === "possible") {
                const result = { status: "possible", reason: "" };
                memo.set(memoKey, result); return result;
            }
            if (branchStatus === "unknown") unresolved.push(branchReason);
            else if (branchReason) blocked.push(branchReason);
        }
    }
    let result;
    if (unresolved.length) result = { status: "unknown", reason: unresolved[0] };
    else result = { status: "impossible", reason: blocked[0] || `${key} has no rule that can match the required parent context.` };
    memo.set(memoKey, result);
    return result;
}

function findUnreachableRuleDetails(selector, selectors) {
    if (!normalizeDependsOn(selector?.dependsOn).length) return [];
    const byName = new Map((selectors || []).map(item => [item.name, item]));
    const dependencies = normalizeDependsOn(selector.dependsOn);
    const results = [];
    for (const [index, rule] of normalizeRules(selector.rules).entries()) {
        if (!rule.options.length || !Object.keys(rule.when || {}).length) continue;
        const branchResults = [];
        for (const branch of ruleBranches(rule)) {
            const constraints = mergeRuleConstraints(new Map(), branch);
            if (!constraints) {
                branchResults.push({ status: "impossible", reason: describeConstraintConflict(new Map(), branch) });
                continue;
            }
            let status = "possible";
            let reason = "";
            const requiredParents = new Set(Object.keys(branch));

            if (ruleLogic(rule) === "and") dependencies.forEach(parent => requiredParents.add(parent));
            const memo = new Map();
            for (const parentKey of requiredParents) {
                const feasibility = inspectSelectorContextFeasibility(parentKey, constraints, byName, new Set(), memo);
                if (feasibility.status === "impossible") { status = "impossible"; reason = feasibility.reason; break; }
                if (feasibility.status === "unknown" && status !== "impossible") { status = "unknown"; reason = feasibility.reason; }
            }
            branchResults.push({ status, reason });
        }
        if (branchResults.some(result => result.status === "possible")) results.push({ index, status: "possible", reason: "" });
        else if (branchResults.some(result => result.status === "unknown")) results.push({ index, status: "unknown", reason: branchResults.find(result => result.status === "unknown")?.reason || "The dependency context could not be fully resolved." });
        else results.push({ index, status: "impossible", reason: branchResults.find(result => result.reason)?.reason || "The parent conditions cannot all be satisfied together." });
    }
    return results;
}

function rulesAreCyclic(selector, selectors) {
    const byName = new Map(selectors.map(s => [s.name, s]));
    const visiting = new Set(), visited = new Set();
    const visit = key => {
        if (visiting.has(key)) return true;
        if (visited.has(key)) return false;
        visiting.add(key);
        const next = byName.get(key);
        if (next) for (const parent of normalizeDependsOn(next.dependsOn)) if (visit(parent)) return true;
        visiting.delete(key); visited.add(key); return false;
    };
    return visit(selector.name);
}
function stableValues(values) { return uniqueStrings(values).sort((a, b) => a.localeCompare(b)); }
function stableJson(value) {
    const seen = new WeakSet();
    const normalize = item => {
        if (item && typeof item === "object") {
            if (seen.has(item)) return "[Circular]";
            seen.add(item);
            if (Array.isArray(item)) return item.map(normalize);
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
        }
        if (typeof item === "undefined") return "[undefined]";
        return item;
    };
    try { return JSON.stringify(normalize(value)); } catch (_) { return String(value); }
}
function valueToArray(value) {
    if (Array.isArray(value)) return uniqueStrings(value);
    if (value === null || value === undefined || value === "") return [];
    return [String(value).replace(/\s+/g, " ").trim()].filter(Boolean);
}
function isEmptyPropertyValue(value) {
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}
function valueToString(value) { return valueToArray(value).join(", "); }

class TaxoOptionSuggest extends obsidian_1.AbstractInputSuggest {
    constructor(app, editor, optionsProvider, listProperty, selectedValuesProvider, onChoose, onCustomInput, isContextReady) {
        super(app, editor);
        this.editor = editor; this.optionsProvider = optionsProvider; this.listProperty = listProperty;
        this.selectedValuesProvider = selectedValuesProvider; this.onChoose = onChoose; this.onCustomInput = onCustomInput; this.isContextReady = isContextReady;
        this.showAllUntilTyped = false; this.valueAtOpen = ""; this.disposed = false; this.ignoreNextBlur = false;
        this.pendingCustomValue = ""; this.hiddenSuggestionContainers = new Map(); this.limit = 100; this.lastKnownListMode = Boolean(this.listProperty());
        this.userNavigated = false;

        this.handleKeydown = event => {
            if (event.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                this.userNavigated = true;
            }
            if (event.key === "Enter") {
                const typedValue = this.normalizeValue(this.readEditorValue());
                if (!typedValue || typedValue === this.normalizeValue(this.valueAtOpen)) return;
                
                const available = this.optionsProvider() || [];
                const exactMatch = available.find(option => this.normalizeValue(option).toLocaleLowerCase() === typedValue.toLocaleLowerCase());
                
                if (!this.userNavigated) {
                    event.preventDefault(); event.stopImmediatePropagation(); this.ignoreNextBlur = true;
                    this.showAllUntilTyped = false; this.close();
                    if (exactMatch) this.onChoose(exactMatch);
                    else this.dispatchCustomValue(typedValue);
                    return;
                }

                if (exactMatch) {
                    event.preventDefault(); event.stopImmediatePropagation(); this.ignoreNextBlur = true; this.close(); this.onChoose(exactMatch); return;
                }
                if (this.getSuggestions(typedValue).length > 0) return;

                event.preventDefault(); event.stopImmediatePropagation(); this.ignoreNextBlur = true;
                this.showAllUntilTyped = false; this.close(); this.dispatchCustomValue(typedValue); return;
            }
            if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
                this.showAllUntilTyped = false;
                this.userNavigated = false;
            }
        };
        this.handlePaste = () => { this.showAllUntilTyped = false; this.userNavigated = false; };
        this.handleInput = () => { window.setTimeout(() => this.hideCompetingSuggestionContainers(), 0); window.setTimeout(() => this.hideCompetingSuggestionContainers(), 40); };
        this.handleBlur = () => {
            window.setTimeout(() => this.restoreCompetingSuggestionContainers(), 0);
            const typedValue = this.normalizeValue(this.readEditorValue());
            if (this.ignoreNextBlur) { this.ignoreNextBlur = false; return; }
            if (!typedValue || typedValue === this.normalizeValue(this.valueAtOpen) || (this.pendingCustomValue && typedValue === this.pendingCustomValue)) return;
            const available = this.optionsProvider() || [];
            const exactMatch = available.find(option => this.normalizeValue(option).toLocaleLowerCase() === typedValue.toLocaleLowerCase());
            if (exactMatch) { window.setTimeout(() => this.onChoose(exactMatch), 0); return; }
            if (!this.isContextReady()) {

                this.writeEditorValue(this.valueAtOpen); this.close(); return;
            }
            this.dispatchCustomValue(typedValue);
        };
        this.editor.addEventListener("keydown", this.handleKeydown, true);
        this.editor.addEventListener("paste", this.handlePaste, true);
        this.editor.addEventListener("input", this.handleInput, true);
        this.editor.addEventListener("blur", this.handleBlur, true);
    }
    getSuggestions(query) {
        const container = this.suggestEl || this.suggestions?.containerEl || this.suggestions?.suggestEl;
        if (container instanceof HTMLElement) {
            container.classList.add("taxoflow-property-dropdown");
            container.classList.add("mod-property");
        }
        let options = this.optionsProvider() || [];
        const listMode = Boolean(this.listProperty());
        this.lastKnownListMode = listMode;
        if (listMode) {
            const selected = new Set((this.selectedValuesProvider() || []).map(value => this.normalizeValue(value).toLocaleLowerCase()));
            options = options.filter(option => !selected.has(this.normalizeValue(option).toLocaleLowerCase()));
        }
        if (this.showAllUntilTyped && this.readEditorValue() === this.valueAtOpen) return options.slice(0, this.limit);
        this.showAllUntilTyped = false;
        const normalizedQuery = this.normalizeValue(query).toLocaleLowerCase();
        if (!normalizedQuery) return options.slice(0, this.limit);
        return options.filter(option => option.toLocaleLowerCase().includes(normalizedQuery)).slice(0, this.limit);
    }
    renderSuggestion(value, element) {
        element.empty();
        element.createDiv({ cls: "suggestion-content", text: value });
    }
    propertyTypeChanged() {
        if (this.disposed) return;
        this.lastKnownListMode = Boolean(this.listProperty());
        this.showAllUntilTyped = false;
        this.refresh();
    }
    refresh() {
        if (this.disposed || !this.editor.isConnected || document.activeElement !== this.editor) return;
        if (typeof this.updateSuggestions === "function") this.updateSuggestions();
        else this.editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    selectSuggestion(value) {
        this.ignoreNextBlur = true; this.close(); this.showAllUntilTyped = false; this.onChoose(value);
    }
    openAll() {
        if (this.disposed || !this.editor.isConnected) return;
        this.ignoreNextBlur = false; this.showAllUntilTyped = true; this.valueAtOpen = this.readEditorValue();
        if (this.editor instanceof HTMLInputElement) this.editor.select();
        else {
            const range = document.createRange(); range.selectNodeContents(this.editor);
            const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
        }
        this.hideCompetingSuggestionContainers();
        this.editor.dispatchEvent(new Event("input", { bubbles: true }));
        window.setTimeout(() => this.hideCompetingSuggestionContainers(), 0);
    }
    hideCompetingSuggestionContainers() {
        if (this.disposed || !this.editor.isConnected || document.activeElement !== this.editor) return;
        const ownContainer = this.suggestEl || this.suggestions?.containerEl || this.suggestions?.suggestEl;
        if (!(ownContainer instanceof HTMLElement)) return;
        document.querySelectorAll(".suggestion-container").forEach(container => {
            if (!(container instanceof HTMLElement) || container === ownContainer || container.contains(ownContainer) || ownContainer.contains(container)) return;
            if (!this.hiddenSuggestionContainers.has(container)) this.hiddenSuggestionContainers.set(container, { display: container.style.display, visibility: container.style.visibility });
            container.style.display = "none";
        });
    }
    restoreCompetingSuggestionContainers() {
        for (const [container, previous] of this.hiddenSuggestionContainers) {
            if (!container.isConnected) continue;
            container.style.display = previous.display; container.style.visibility = previous.visibility;
        }
        this.hiddenSuggestionContainers.clear();
    }
    dispatchCustomValue(value) {
        if (!value || this.pendingCustomValue === value) return;
        this.pendingCustomValue = value;
        Promise.resolve(this.onCustomInput(value, this.valueAtOpen)).finally(() => { if (this.pendingCustomValue === value) this.pendingCustomValue = ""; });
    }
    writeEditorValue(value) { if (this.editor instanceof HTMLInputElement) this.editor.value = value; else this.editor.textContent = value; }
    normalizeValue(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
    dispose() {
        if (this.disposed) return; this.disposed = true;
        this.editor.removeEventListener("keydown", this.handleKeydown, true); this.editor.removeEventListener("paste", this.handlePaste, true);
        this.editor.removeEventListener("input", this.handleInput, true); this.editor.removeEventListener("blur", this.handleBlur, true);
        this.restoreCompetingSuggestionContainers(); this.close();
    }
    readEditorValue() { return this.editor instanceof HTMLInputElement ? this.editor.value : (this.editor.textContent || ""); }
}

class TaxoModal extends obsidian_1.Modal {
    constructor(app, title, subtitle) { super(app); this.title = title; this.subtitle = subtitle; this._tfModalDragCleanup = null; }
    onOpen() {
        const { contentEl, modalEl } = this;
        modalEl?.addClass("taxoflow-draggable-modal");
        modalEl?.addClass("taxoflow-registration-modal");
        contentEl.empty();
        contentEl.addClass("taxoflow-modal");
        const heading = contentEl.createEl("h2", { text: this.title, cls: "taxoflow-modal-drag-handle" });
        if (this.subtitle) contentEl.createEl("p", { text: this.subtitle, cls: "setting-item-description" });
        this.installModalDrag(heading);
    }
    installModalDrag(heading = null) {
        this._tfModalDragCleanup?.();
        const modal = this.modalEl;
        modal?.addClass("taxoflow-draggable-modal");
        if (!modal) return;
        const dragHandle = heading instanceof HTMLElement ? heading : modal.querySelector(".taxoflow-modal-drag-handle") || modal;
        dragHandle.classList?.add("taxoflow-modal-drag-handle");
        let drag = null;
        let activePointerId = null;
        const removeWindowListeners = () => {
            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            window.removeEventListener("pointercancel", onUp, true);
        };
        const onMove = event => {
            if (!drag || event.pointerId !== activePointerId) return;
            const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
            const viewportHeight = document.documentElement?.clientHeight || window.innerHeight;
            const maxLeft = Math.max(0, viewportWidth - drag.width);
            const maxTop = Math.max(0, viewportHeight - drag.height);
            const left = Math.min(maxLeft, Math.max(0, drag.left + event.clientX - drag.x));
            const top = Math.min(maxTop, Math.max(0, drag.top + event.clientY - drag.y));
            const offsetX = drag.offsetX + left - drag.left;
            const offsetY = drag.offsetY + top - drag.top;
            modal.style.translate = `${offsetX}px ${offsetY}px`;
            modal.dataset.tfModalDragX = String(offsetX);
            modal.dataset.tfModalDragY = String(offsetY);
            event.preventDefault?.();
        };
        const finishDrag = pointerId => {
            if (!drag || (pointerId != null && pointerId !== activePointerId)) return;
            const capturedPointerId = activePointerId;
            drag = null;
            activePointerId = null;
            removeWindowListeners();
            dragHandle.removeEventListener("lostpointercapture", onLostPointerCapture);
            modal.classList?.remove("is-dragging");
            dragHandle.classList?.remove("is-dragging");
            try {
                if (capturedPointerId != null && dragHandle.hasPointerCapture?.(capturedPointerId)) dragHandle.releasePointerCapture(capturedPointerId);
            } catch (_) {}
        };
        const onUp = event => finishDrag(event?.pointerId);
        const onLostPointerCapture = event => finishDrag(event.pointerId);
        const onDown = event => {
            if (event.button !== 0 || event.isPrimary === false) return;
            if (event.target instanceof Element && event.target.closest("button, input, textarea, select, a, [role=button], .setting-item-control, details")) return;
            const rect = modal.getBoundingClientRect();
            drag = {
                x: event.clientX,
                y: event.clientY,
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                offsetX: Number(modal.dataset.tfModalDragX || 0),
                offsetY: Number(modal.dataset.tfModalDragY || 0),
            };
            activePointerId = event.pointerId;
            modal.classList?.add("is-dragging");
            dragHandle.classList?.add("is-dragging");
            dragHandle.addEventListener("lostpointercapture", onLostPointerCapture);
            try {
                dragHandle.setPointerCapture(event.pointerId);
            } catch (_) {}
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
            event.preventDefault?.();
        };
        dragHandle.addEventListener("pointerdown", onDown);
        this._tfModalDragCleanup = () => {
            finishDrag();
            dragHandle.removeEventListener("pointerdown", onDown);
            dragHandle.removeEventListener("lostpointercapture", onLostPointerCapture);
        };
    }
    onClose() { this._tfModalDragCleanup?.(); this._tfModalDragCleanup = null; this.contentEl.empty(); }
}
class TaxoCreateProfileModal extends TaxoModal {
    constructor(app, plugin, onCreated) { super(app, "Create profile", "Create a separate namespace for a new kind of record."); this.plugin = plugin; this.onCreated = onCreated; }
    onOpen() {
        super.onOpen();
        let name = "";
        let namespaceTouched = false;
        let namespaceInput = null;
        new obsidian_1.Setting(this.contentEl).setName("Profile name").addText(t => t.setPlaceholder("Countries").onChange(value => {
            name = value;
            if (!namespaceTouched && namespaceInput) namespaceInput.value = `${TAXOFLOW_PROPERTY_PREFIX}${slugify(value)}_`;
        }));
        new obsidian_1.Setting(this.contentEl).setName("Property namespace").setDesc("Must be unique and not overlap another namespace, e.g. taxo.country_.").addText(t => {
            t.setPlaceholder(`${TAXOFLOW_PROPERTY_PREFIX}country_`); t.inputEl.dataset.tfNamespace = "true"; namespaceInput = t.inputEl;
            t.onChange(() => { namespaceTouched = true; });
        });
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Create profile").setCta().onClick(async () => {
            const cleanName = name.trim(); const ns = String(namespaceInput?.value || "").trim() || `${TAXOFLOW_PROPERTY_PREFIX}${slugify(cleanName)}_`;
            if (!cleanName) { new obsidian_1.Notice("Enter a profile name."); return; }
            if (!profileNameAvailable(cleanName, this.plugin.settings.profiles)) { new obsidian_1.Notice("Profile names must be unique, ignoring letter case."); return; }
            if (!isValidProfileNamespace(ns)) { new obsidian_1.Notice("Use a namespace like taxo.country_."); return; }
            if (!profileNamespaceAvailable(ns, this.plugin.settings.profiles)) { new obsidian_1.Notice("That namespace overlaps another profile namespace. Use a distinct prefix, such as taxo.country_."); return; }
            const idBase = slugify(cleanName); let id = idBase, n = 2;
            while (this.plugin.settings.profiles.some(p => p.id === id)) id = `${idBase}_${n++}`;
            const profile = { id, name: cleanName, namespace: ns, selectors: [], propertyLabels: {}, defaultFolder: "", excludedFolders: [] };
            const previousActiveProfileId = this.plugin.settings.activeProfileId;
            this.plugin.settings.profiles.push(profile); this.plugin.settings.activeProfileId = id;
            try {
                this.plugin.invalidateRuntimeCaches(); await this.plugin.saveSettings(); this.plugin.scheduleLabelRefresh();
                this.close(); this.onCreated();
            } catch (error) {
                this.plugin.settings.profiles = this.plugin.settings.profiles.filter(p => p !== profile);
                this.plugin.settings.activeProfileId = previousActiveProfileId;
                this.plugin.invalidateRuntimeCaches();
                new obsidian_1.Notice(`Could not create profile: ${error?.message || error}`);
            }
        });
    }
}

class TaxoRenameProfileModal extends TaxoModal {
    constructor(app, plugin, profile, onRenamed) { super(app, "Rename profile", `Profile ID and namespace remain unchanged. Current namespace: ${profile.namespace}`); this.plugin = plugin; this.profile = profile; this.onRenamed = onRenamed; }
    onOpen() {
        super.onOpen(); let name = this.profile.name;
        new obsidian_1.Setting(this.contentEl).setName("Profile name").addText(t => t.setValue(name).onChange(value => name = value));
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Rename profile").setCta().onClick(async () => {
            const clean = name.trim();
            if (!clean) { new obsidian_1.Notice("Profile name cannot be empty."); return; }
            if (!profileNameAvailable(clean, this.plugin.settings.profiles, this.profile)) { new obsidian_1.Notice("Profile names must be unique, ignoring letter case."); return; }
            const previous = this.profile.name; this.profile.name = clean;
            try { await this.plugin.saveSettings(); this.close(); this.onRenamed(); }
            catch (error) { this.profile.name = previous; this.plugin.invalidateRuntimeCaches(); new obsidian_1.Notice(`Could not rename profile: ${error?.message || error}`); }
        });
    }
}

class TaxoNewPropertyRegistrationModal extends TaxoModal {
    constructor(app, plugin, profile, selector) {
        super(app, "New selector property", `Registered ${selector.name} in profile “${profile.name}”. Set its display label or open its detailed settings.`);
        this.plugin = plugin; this.profile = profile; this.selector = selector;
    }
    onOpen() {
        super.onOpen();
        this.modalEl?.addClass("taxoflow-registration-modal");
        const heading = this.contentEl.querySelector("h2");
        if (heading) heading.addClass("taxoflow-modal-drag-handle");
        new obsidian_1.Setting(this.contentEl).setName("Label").setDesc("Display label only; the stored property key is unchanged.").addText(t => {
            t.setValue(this.selector.label || humanize(this.selector.name)).setPlaceholder(humanize(this.selector.name)).onChange(value => {
                this.selector.label = value.trim();
                this.plugin.refreshFlatSelectors();
                this.plugin.scheduleSettingsSave();
                this.plugin.scheduleLabelRefresh();
            });
        });
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Open property settings").setCta().onClick(() => {
            this.close();
            void this.plugin.openSelectorSettings(this.selector.name);
        });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Close").onClick(() => this.close());
    }
    onClose() { this.modalEl?.removeClass("taxoflow-registration-modal"); super.onClose(); }
}

class TaxoNamespaceModal extends TaxoModal {
    constructor(app, plugin, profile, onDone) {
        super(app, "Change profile namespace", "This changes configured keys and rule references only. Existing note properties are not renamed; they remain as note data and may appear in Orphans. Use Orphan Management to bulk-change stored keys separately.");
        this.plugin = plugin; this.profile = profile; this.onDone = onDone;
    }
    onOpen() {
        super.onOpen();
        let ns = this.profile.namespace;
        new obsidian_1.Setting(this.contentEl).setName("New namespace").setDesc("Format: taxo.some_name_. Existing note frontmatter will not be renamed.").addText(t => t.setValue(ns).onChange(value => ns = value.trim()));
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Apply namespace").setCta().onClick(async () => {
            if (!isValidProfileNamespace(ns)) { new obsidian_1.Notice("Use a namespace like taxo.country_."); return; }
            if (!profileNamespaceAvailable(ns, this.plugin.settings.profiles, this.profile)) { new obsidian_1.Notice("That namespace overlaps another profile namespace. Use a distinct prefix."); return; }
            const oldNamespace = this.profile.namespace;
            if (oldNamespace === ns) { this.close(); return; }
            const mapping = {};
            this.profile.selectors.forEach(selector => {
                const newKey = selector.name.startsWith(oldNamespace) ? ns + selector.name.slice(oldNamespace.length) : selector.name;
                if (newKey !== selector.name) mapping[selector.name] = newKey;
            });
            for (const labelKey of Object.keys(this.profile.propertyLabels || {})) {
                if (labelKey.startsWith(oldNamespace)) mapping[labelKey] = ns + labelKey.slice(oldNamespace.length);
            }
            const oldSnapshot = JSON.parse(JSON.stringify({
                namespace: this.profile.namespace,
                selectors: this.profile.selectors,
                propertyLabels: this.profile.propertyLabels || {},
                suppressedAutoRegistrationKeys: this.plugin.settings.suppressedAutoRegistrationKeys || [],
            }));
            for (const selector of this.profile.selectors) {
                selector.name = mapping[selector.name] || selector.name;
                selector.dependsOn = normalizeDependsOn(selector.dependsOn).map(key => mapping[key] || key);
                selector.rules = (selector.rules || []).map(rule => ({ when: remapRecordKeys(rule.when, mapping), options: rule.options, logic: rule.logic || "and" }));
                selector.customOptionsByContext = (selector.customOptionsByContext || []).map(entry => ({ context: remapRecordKeys(entry.context, mapping), options: entry.options }));
            }
            const labels = {};
            for (const [key, label] of Object.entries(this.profile.propertyLabels || {})) labels[mapping[key] || key] = label;
            this.profile.propertyLabels = labels;
            this.profile.namespace = ns;
            this.plugin.settings.suppressedAutoRegistrationKeys = uniqueStrings([
                ...(this.plugin.settings.suppressedAutoRegistrationKeys || []), ...Object.keys(mapping).filter(key => key.startsWith(oldNamespace))
            ]);
            this.plugin.refreshFlatSelectors();
            try {
                await this.plugin.saveSettings();
                this.plugin.scheduleLabelRefresh();
                this.plugin.scheduleSettingsInventoryRefresh(true);
                this.close(); this.onDone();
            } catch (error) {
                this.profile.namespace = oldSnapshot.namespace;
                this.profile.selectors = oldSnapshot.selectors;
                this.profile.propertyLabels = oldSnapshot.propertyLabels;
                this.plugin.settings.suppressedAutoRegistrationKeys = oldSnapshot.suppressedAutoRegistrationKeys;
                this.plugin.invalidateRuntimeCaches();
                new obsidian_1.Notice(`Could not change namespace: ${error?.message || error}`);
            }
        });
    }
}
class TaxoAddSelectorModal extends TaxoModal {
    constructor(app, plugin, profile, onDone) { super(app, "Add property", `Add a selector to ${profile.name}. The full key will use ${profile.namespace}.`); this.plugin = plugin; this.profile = profile; this.onDone = onDone; }
    onOpen() {
        super.onOpen(); let suffix = "", label = "";
        new obsidian_1.Setting(this.contentEl).setName("Property suffix").setDesc("Use a short machine-friendly key, e.g. genre.").addText(t => t.setPlaceholder("genre").onChange(v => suffix = v));
        new obsidian_1.Setting(this.contentEl).setName("Display label").setDesc("Human-readable label shown in Obsidian Properties.").addText(t => t.setPlaceholder("Genre").onChange(v => label = v));
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Add property").setCta().onClick(async () => {
            const cleanSuffix = slugify(suffix).replace(/_+/g, "_");
            const name = `${this.profile.namespace}${cleanSuffix}`;
            if (!suffix.trim() || this.profile.selectors.some(s => s.name === name) || this.profile.propertyLabels?.[name]) { new obsidian_1.Notice("Enter a unique property suffix."); return; }
            this.profile.selectors.push({ name, label: label.trim() || humanize(name), options: [], defaultValue: "", dependsOn: [], rules: [], customOptionsByContext: [] });
            this.plugin.refreshFlatSelectors(); await this.plugin.saveSettings(); this.plugin.scheduleLabelRefresh(); this.close(); this.onDone();
        });
    }
}

class TaxoRenameSelectorModal extends TaxoModal {
    constructor(app, plugin, profile, selector, onDone) {
        super(app, "Rename property key", "This renames the selector configuration and its rule references only. Existing note frontmatter is not renamed; old-key instances remain available in Orphan Management for review or bulk-change.");
        this.plugin = plugin; this.profile = profile; this.selector = selector; this.onDone = onDone;
    }
    onOpen() {
        super.onOpen();
        let suffix = this.selector.name.startsWith(this.profile.namespace) ? this.selector.name.slice(this.profile.namespace.length) : stripPropertyRootPrefix(this.selector.name);
        new obsidian_1.Setting(this.contentEl).setName("Property suffix").setDesc(`Full key: ${this.profile.namespace}<suffix>. Note values are not renamed by this action.`).addText(t => t.setValue(suffix).onChange(value => suffix = value));
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Rename key").setCta().onClick(async () => {
            const cleanSuffix = slugify(suffix);
            if (!suffix.trim()) { new obsidian_1.Notice("Enter a property suffix."); return; }
            const oldKey = this.selector.name, newKey = `${this.profile.namespace}${cleanSuffix}`;
            if (oldKey === newKey) { this.close(); return; }
            if (this.profile.selectors.some(selector => selector !== this.selector && selector.name === newKey) || Object.prototype.hasOwnProperty.call(this.profile.propertyLabels || {}, newKey)) {
                new obsidian_1.Notice("That property key is already used in this profile."); return;
            }
            const oldSnapshot = JSON.parse(JSON.stringify({
                selectors: this.profile.selectors,
                propertyLabels: this.profile.propertyLabels || {},
                suppressedAutoRegistrationKeys: this.plugin.settings.suppressedAutoRegistrationKeys || [],
            }));
            const mapping = { [oldKey]: newKey };
            for (const selector of this.profile.selectors) {
                selector.name = mapping[selector.name] || selector.name;
                selector.dependsOn = normalizeDependsOn(selector.dependsOn).map(key => mapping[key] || key);
                selector.rules = (selector.rules || []).map(rule => ({ when: remapRecordKeys(rule.when, mapping), options: rule.options, logic: rule.logic || "and" }));
                selector.customOptionsByContext = (selector.customOptionsByContext || []).map(entry => ({ context: remapRecordKeys(entry.context, mapping), options: entry.options }));
            }
            const labels = {};
            for (const [key, label] of Object.entries(this.profile.propertyLabels || {})) labels[mapping[key] || key] = label;
            this.profile.propertyLabels = labels;
            this.plugin.settings.suppressedAutoRegistrationKeys = uniqueStrings([...(this.plugin.settings.suppressedAutoRegistrationKeys || []), oldKey]);
            this.plugin.refreshFlatSelectors();
            try {
                await this.plugin.saveSettings();
                this.plugin.scheduleLabelRefresh();
                this.plugin.scheduleSettingsInventoryRefresh(true);
                this.close(); this.onDone();
            } catch (error) {
                this.profile.selectors = oldSnapshot.selectors;
                this.selector = this.profile.selectors.find(selector => selector.name === oldKey) || this.selector;
                this.profile.propertyLabels = oldSnapshot.propertyLabels;
                this.plugin.settings.suppressedAutoRegistrationKeys = oldSnapshot.suppressedAutoRegistrationKeys;
                this.plugin.invalidateRuntimeCaches();
                new obsidian_1.Notice(`Could not rename selector configuration: ${error?.message || error}`);
            }
        });
    }
}
class TaxoRuleBuilderModal extends TaxoModal {
    constructor(app, plugin, profile, selector, onSaved) {
        super(app, "Dependency rules", `${profile.name} · ${selector.name}`);
        this.plugin = plugin; 
        this.profile = profile; 
        this.selector = selector; 
        this.onSaved = onSaved;
        
        this.rules = (selector.rules || []).map(r => ({
            when: Object.entries(r.when || {}).map(([k, v]) => ({ key: k, values: parseOptionList(v) })),
            options: parseOptionList(r.options),
            logic: r.logic === "or" ? "or" : "and"
        }));
        
        this.activeRuleIndex = null;
    }

    onOpen() {
        super.onOpen();
        this.modalEl.addClass("taxoflow-schema-editor-modal");
        this.render();
    }

    render() {
        const { contentEl } = this;
        const currentScroll = contentEl.scrollTop;
        contentEl.empty();
        contentEl.addClass("taxoflow-modal");
        
        const heading = contentEl.createEl("h2", { text: "Dependency rules", cls: "taxoflow-modal-drag-handle" });
        contentEl.createEl("p", { text: `${this.profile.name} · ${this.selector.name}`, cls: "setting-item-description", style: "margin-bottom: 12px;" });

        contentEl.createEl("h3", { text: "Configured Rules" });
        const rulesContainer = contentEl.createDiv({ cls: "taxoflow-schema-table-container", style: "margin-bottom: 16px; padding: 12px;" });
        
        if (!this.rules.length) {
            rulesContainer.createEl("p", { text: "No rules configured yet.", cls: "setting-item-description", style: "margin: 0;" });
        }

        for (let i = 0; i < this.rules.length; i++) {
            const ruleSetting = new obsidian_1.Setting(rulesContainer)
                .setName(`Rule ${i + 1}`)
                .addToggle(toggle => {
                    toggle.setValue(this.activeRuleIndex === i)
                          .setTooltip(this.activeRuleIndex === i ? "Collapse rule editor" : "Expand rule editor")
                          .onChange(val => {
                              this.activeRuleIndex = val ? i : null;
                              this.render();
                          });
                })
                .addButton(btn => {
                    btn.setIcon("trash-2")
                       .setTooltip("Delete rule")
                       .onClick(() => this.confirmDeleteRule(i));
                });
                
            ruleSetting.settingEl.style.cursor = "pointer";
            ruleSetting.settingEl.addEventListener("click", (e) => {
                if(e.target.closest(".setting-item-control")) return;
                this.activeRuleIndex = this.activeRuleIndex === i ? null : i;
                this.render();
            });
        }

        new obsidian_1.Setting(contentEl).addButton(b => b.setButtonText("+ Add rule").onClick(() => {
            this.rules.push({ when: [], options: [], logic: "and" });
            this.activeRuleIndex = this.rules.length - 1;
            this.render();
        }));

        if (this.activeRuleIndex !== null && this.rules[this.activeRuleIndex]) {
            const rule = this.rules[this.activeRuleIndex];
            const editorEl = contentEl.createDiv({ style: "margin-top: 24px; border-top: 1px solid var(--background-modifier-border); padding-top: 16px;" });
            
            new obsidian_1.Setting(editorEl)
                .setName("Match type")
                .setDesc("Require all conditions to match, or any single condition.")
                .addDropdown(d => {
                    d.addOption("and", "All of the following (AND)");
                    d.addOption("or", "Any of the following (OR)");
                    d.setValue(rule.logic);
                    d.onChange(v => rule.logic = v);
                });

            editorEl.createEl("h3", { text: "Conditions (If)", style: "margin-top: 16px;" });
            const ifContainer = editorEl.createDiv({ cls: "taxoflow-schema-table-container" });
            
            const ifHeader = ifContainer.createDiv({ cls: "taxoflow-schema-grid if-grid table-header" });
            ifHeader.createDiv({ text: "Property Key" });
            ifHeader.createDiv({ text: "Value" });
            ifHeader.createDiv({ text: "" });

            const possibleParents = this.profile.selectors.filter(s => s.name !== this.selector.name);

            rule.when.forEach((cond, idx) => {
                const row = ifContainer.createDiv({ cls: "taxoflow-schema-grid if-grid", style: "align-items: start;" });
            
            const keySelect = row.createEl("select", { cls: "dropdown" });
            keySelect.createEl("option", { value: "", text: "Select parent..." });
            possibleParents.forEach(p => {
                keySelect.createEl("option", { value: p.name, text: p.name });
            });
            keySelect.value = cond.key || "";
            
            keySelect.addEventListener("change", (e) => {
                cond.key = e.target.value;
                cond.values = [];
                this.render();
            });

            const valWrapper = row.createDiv({ style: "display: flex; flex-direction: column; gap: 6px;" });
            
            if (cond.key) {
                const parentSelector = possibleParents.find(s => s.name === cond.key);
                const knownValues = parentSelector ? this.plugin.getKnownOptionsForSelector(parentSelector) : [];
                
                const pillContainer = valWrapper.createDiv({ cls: "taxo-pill-container" });
                
                cond.values.forEach((val) => {
                    const pill = pillContainer.createEl("span", { cls: "taxo-pill" });
                    pill.setText(val);
                    const removeBtn = pill.createEl("span", { cls: "taxo-pill-remove", text: "x" });
                    removeBtn.addEventListener("click", () => {
                        cond.values = cond.values.filter(v => v !== val);
                        this.render();
                    });
                });

                const availableOptions = knownValues.filter(opt => !cond.values.includes(opt));
                if (availableOptions.length > 0) {
                    const select = pillContainer.createEl("select", { cls: "dropdown" });
                    select.createEl("option", { text: "Add value...", value: "" });
                    availableOptions.forEach((opt) => {
                        select.createEl("option", { text: opt, value: opt });
                    });
                    select.addEventListener("change", (e) => {
                        const selected = e.target.value;
                        if (selected) {
                            cond.values.push(selected);
                            this.render();
                        }
                    });
                } else if (knownValues.length === 0) {
                    pillContainer.createEl("span", { text: "No known values for this parent.", cls: "setting-item-description" });
                }
            } else {
                valWrapper.createEl("span", { text: "Select a property key first.", cls: "setting-item-description" });
            }

            const actionsWrapper = row.createDiv({ style: "display: flex; gap: 4px; align-items: center;" });
            
            if (cond.key) {
                new obsidian_1.ButtonComponent(actionsWrapper)
                    .setIcon("settings")
                    .setTooltip("Manage parent property options")
                    .onClick(async () => {
                        await this.plugin.saveSettings();
                        this.close();
                        void this.plugin.openSelectorSettings(cond.key);
                    });
            }

            new obsidian_1.ButtonComponent(actionsWrapper)
                .setIcon("trash-2")
                .setTooltip("Remove condition")
                .onClick(() => {
                    rule.when.splice(idx, 1);
                    this.render();
                });
            });

            new obsidian_1.Setting(editorEl).addButton(b => b.setButtonText("+ Add condition").onClick(() => {
                rule.when.push({ key: "", values: [] });
                this.render();
            }));

            editorEl.createEl("h3", { text: "Actions (Then)", style: "margin-top: 24px;" });
            new obsidian_1.Setting(editorEl)
                .setName("Options to offer")
                .setDesc("Comma-separated or newline-separated values for the dropdown menu.")
                .addTextArea(t => {
                    t.inputEl.rows = 4;
                    t.inputEl.style.width = "100%";
                    t.inputEl.addClass("taxoflow-options-input");
                    t.setValue(rule.options.join("\n"));
                    t.onChange(v => {
                        rule.options = v.split(/,|\n/).map(s => s.trim()).filter(Boolean);
                    });
                });
        }

        this.validationEl = contentEl.createDiv({ cls: "taxoflow-rule-validation setting-item-description", style: "margin-top: 16px;" });
        const buttons = contentEl.createDiv({ cls: "modal-button-container", style: "margin-top: auto;" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Save rules").setCta().onClick(() => this.saveRules());
        
        this.installModalDrag(heading);
        contentEl.scrollTop = currentScroll;
    }

    confirmDeleteRule(index) {
        const rule = this.rules[index];
        if (!rule) return;
        const details = { profile: this.profile.name, propertyKey: this.selector.name, ruleNumber: index + 1 };
        new TaxoDetailedConfirmModal(this.app, `Delete rule ${index + 1}?`, `Profile: ${this.profile.name}. Property: ${this.selector.name}. This removes this rule from plugin configuration only; no note data is changed.`, "Delete rule", JSON.stringify(details, null, 2), async () => {
            this.rules.splice(index, 1);
            if (this.activeRuleIndex === index) {
                this.activeRuleIndex = null;
            } else if (this.activeRuleIndex > index) {
                this.activeRuleIndex--;
            }
            this.render();
        }).open();
    }

    saveRules() {
        const finalRules = this.rules.map(r => {
            const whenObj = {};
            for (const cond of r.when) {
                if (cond.key && cond.values.length > 0) {
                    whenObj[cond.key] = cond.values;
                }
            }
            return {
                when: whenObj,
                options: r.options,
                logic: r.logic
            };
        }).filter(r => Object.keys(r.when).length > 0 && r.options.length > 0);

        const deps = new Set();
        for (const r of finalRules) {
            for (const k of Object.keys(r.when)) {
                deps.add(k);
            }
        }
        const dependencies = Array.from(deps);

        if (dependencies.some(key => !this.profile.selectors.some(s => s.name === key) || key === this.selector.name)) { 
            new obsidian_1.Notice("Every parent must be another selector in this profile."); 
            return; 
        }
        if (this.rules.length > 0 && finalRules.length === 0) {
            new obsidian_1.Notice("Ensure every rule has at least one valid condition and option to save.");
            return;
        }
        
        if (rulesAreCyclic({ ...this.selector, dependsOn: dependencies }, this.profile.selectors.map(s => s.name === this.selector.name ? { ...s, dependsOn: dependencies } : s))) { 
            new obsidian_1.Notice("These dependencies would create a cycle."); 
            return; 
        }

        const candidateSelector = { ...this.selector, dependsOn: dependencies, rules: finalRules };
        const candidateSelectors = this.profile.selectors.map(item => item.name === this.selector.name ? candidateSelector : item);
        const reachability = findUnreachableRuleDetails(candidateSelector, candidateSelectors);
        const impossible = reachability.filter(result => result.status === "impossible");
        const uncertain = reachability.filter(result => result.status === "unknown");
        
        if (impossible.length) {
            const first = impossible[0];
            const message = `Cannot save: Rule ${first.index + 1} is impossible. ${first.reason} Correct the conflicting parent conditions before saving.`;
            new obsidian_1.Notice(message);
            this.validationEl.setText(`Impossible rules: ${impossible.map(result => `Rule ${result.index + 1}:${result.reason}`).join("; ")}`); 
            this.validationEl.style.color = "var(--text-error)"; 
            return;
        }
        
        if (uncertain.length) {
            this.validationEl.setText(`Reachability warning: ${uncertain.map(result => `Rule ${result.index + 1}:${result.reason}`).join("; ")}. The validator cannot prove these rules reachable because the dependency graph is incomplete or cyclic.`);
            this.validationEl.style.color = "var(--text-warning)";
        } else {
            this.validationEl.setText(""); 
            this.validationEl.style.color = "";
        }

        const conflicts = conflictingRulePairs(finalRules);
        if (conflicts.length) {
            new obsidian_1.Notice(`Cannot save: Rule ${conflicts[0][0] + 1} and Rule ${conflicts[0][1] + 1} have equal specificity, overlapping conditions, and different options. Resolve all conflicts first.`);
            this.validationEl.setText(`Conflicting rules: ${conflicts.map(pair => `${pair[0] + 1} and${pair[1] + 1}`).join(", ")}.`); 
            this.validationEl.style.color = "var(--text-error)"; 
            return;
        }

        const previous = { dependsOn: this.selector.dependsOn, rules: this.selector.rules, options: this.selector.options };
        this.selector.dependsOn = dependencies; 
        this.selector.rules = finalRules; 
        if (dependencies.length) this.selector.options = [];

        void this.plugin.saveSettings().then(() => {
            if (uncertain.length) new obsidian_1.Notice(`Rules saved with ${uncertain.length} reachability warning(s).`);
            this.plugin.refreshOpenSuggestions(this.selector.name); 
            this.close(); 
            this.onSaved();
        }).catch(error => {
            this.selector.dependsOn = previous.dependsOn; 
            this.selector.rules = previous.rules; 
            this.selector.options = previous.options; 
            this.plugin.invalidateRuntimeCaches();
            new obsidian_1.Notice(`Could not save dependency rules: ${error?.message || error}`);
        });
    }
}
class TaxoDefaultValueConflictModal extends TaxoModal {
    constructor(app, plugin, selector, defaultValue, populatedOccurrences, emptyCount, onChoose) {
        super(app, "Apply default value", `The property ${selector.name} already has values in ${populatedOccurrences.length} note(s).`);
        this.plugin = plugin;
        this.selector = selector;
        this.defaultValue = defaultValue;
        this.populatedOccurrences = populatedOccurrences;
        this.emptyCount = emptyCount;
        this.onChoose = onChoose;
    }
    onOpen() {
        super.onOpen();
        const { contentEl } = this;
        contentEl.createEl("p", { text: `You are setting the default value to "${this.defaultValue}". How would you like to apply this to existing notes?` });
        
        const details = contentEl.createEl("details", { cls: "taxoflow-delete-details" });
        details.createEl("summary", { text: `Show ${this.populatedOccurrences.length} note(s) with existing values` });
        const list = details.createDiv({ cls: "taxoflow-delete-note-list" });
        for (const item of this.populatedOccurrences) {
            const row = list.createDiv({ cls: "taxoflow-delete-note-row" });
            row.createEl("code", { text: item.path });
            row.createEl("pre", { text: JSON.stringify(item.value, null, 2) });
        }
        
        const buttons = contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => {
            this.close();
            this.onChoose("cancel");
        });
        new obsidian_1.ButtonComponent(buttons).setButtonText(`Fill ${this.emptyCount} empty only`).onClick(() => {
            this.close();
            this.onChoose("empty-only");
        });
        new obsidian_1.ButtonComponent(buttons).setButtonText(`Overwrite all ${this.populatedOccurrences.length + this.emptyCount} notes`).setWarning().onClick(() => {
            this.close();
            this.onChoose("overwrite-all");
        });
    }
}
class TaxoFlowSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this._displayedProfileId = null;
        this._searchQuery = "";
        this._collapsedStateBySelector = new Map();
        this._sectionCollapsed = { activeProfile: false, properties: false, extraLabels: true, orphans: false, maintenance: true };
        this._orphanCategoryCollapsed = { noProfile: true, profileMissing: true };
        this._selectorOccurrenceMap = null;
        this.plugin.settingTab = this;
    }
    display() {
        const { containerEl } = this;
        const active = this.plugin.getActiveProfile();
        const focusRequested = Boolean(this.plugin.pendingFocusSelectorKey);
        const sameProfile = Boolean(active && this._displayedProfileId === active.id);
        const scrollPositions = sameProfile && !focusRequested ? this.captureScrollPositions(containerEl) : [];
        if (focusRequested) {
            this._searchQuery = "";
            this._collapsedStateBySelector = new Map();
        } else if (sameProfile) {
            const oldSearch = containerEl.querySelector(".taxoflow-property-search"); if (oldSearch) this._searchQuery = oldSearch.value;
            containerEl.querySelectorAll(".taxoflow-selector-card").forEach(card => { if (card._tfSelector) this._collapsedStateBySelector.set(card._tfSelector, card.classList.contains("is-collapsed")); });
        } else { this._searchQuery = ""; this._collapsedStateBySelector = new Map(); }
        
        containerEl.empty(); containerEl.addClass("taxoflow-settings"); this._displayedProfileId = active?.id || null;
        new obsidian_1.Setting(containerEl).setName("TaxoFlow Properties").setDesc("Manage profiles, property schemas, context-dependent rules, and additional labels.").setHeading();

        const groupA = containerEl.createDiv({ cls: "taxoflow-settings-group" });
        const activeSection = groupA.createDiv({ cls: `taxoflow-settings-section taxoflow-active-profile-section${active ? " has-data" : ""}` });
        const activeHeader = new obsidian_1.Setting(activeSection).setName("Active Profile").setDesc(active ? `${active.name} · ${active.namespace}` : "No profile configured. Create your first profile to begin.").setHeading();

        if (this.plugin.settings.profiles.length) {
            activeHeader.addDropdown(drop => {
                this.plugin.settings.profiles.forEach(p => drop.addOption(p.id, `${p.name} (${p.namespace})`));
                drop.setValue(active?.id || this.plugin.settings.profiles[0].id);
                drop.onChange(async id => { this.plugin.settings.activeProfileId = id; await this.plugin.saveSettings(); this.display(); });
            });
        }

        if (active) {
            activeHeader.addExtraButton(button => {
                button.setIcon("chevrons-up-down");
                button.extraSettingsEl.classList.add("taxoflow-invisible-spacer");
                button.extraSettingsEl.tabIndex = -1;
            });
        }

        activeHeader.addExtraButton(button => button.setIcon("plus").setTooltip("Create profile").onClick(() => new TaxoCreateProfileModal(this.app, this.plugin, () => this.display()).open()));
        
        const profileDetails = activeSection.createDiv({ cls: "taxoflow-active-profile-details" });
        let activeCollapsed = this._sectionCollapsed.activeProfile ?? false;
        const updateActiveCollapsed = () => {
            profileDetails.hidden = activeCollapsed;
            activeSection.classList.toggle("is-collapsed", activeCollapsed);
            activeToggle?.setIcon(activeCollapsed ? "chevron-right" : "chevron-down");
            activeToggle?.setTooltip(activeCollapsed ? "Expand profile details" : "Collapse profile details");
        };
        let activeToggle = null;
        activeHeader.addExtraButton(button => { activeToggle = button; button.setIcon(activeCollapsed ? "chevron-right" : "chevron-down").setTooltip(activeCollapsed ? "Expand profile details" : "Collapse profile details").onClick(() => { activeCollapsed = !activeCollapsed; this._sectionCollapsed.activeProfile = activeCollapsed; updateActiveCollapsed(); }); });
        
        if (active) {
            new obsidian_1.Setting(profileDetails).setName("Profile name").setDesc(active.name).addButton(b => b.setButtonText("Rename profile…").onClick(() => new TaxoRenameProfileModal(this.app, this.plugin, active, () => this.display()).open()));
            new obsidian_1.Setting(profileDetails).setName("Property namespace").setDesc(active.namespace).addButton(b => b.setButtonText("Change namespace…").onClick(() => new TaxoNamespaceModal(this.app, this.plugin, active, () => this.display()).open()));
            const folderSetting = new obsidian_1.Setting(profileDetails).setName("Default folder").setDesc("Automatically moves notes containing properties under this profile namespace to the root of this folder.");
            let moveNotesBtn = null;
            folderSetting.addText(text => {
                text.setPlaceholder("e.g. Notes/Books").setValue(active.defaultFolder || "").onChange(async value => {
                    active.defaultFolder = value.trim();
                    await this.plugin.saveSettings();
                    if (moveNotesBtn) moveNotesBtn.setDisabled(!active.defaultFolder);
                });
            });
            folderSetting.addButton(b => {
                moveNotesBtn = b;
                b.setButtonText("Move existing notes to folder…").setTooltip("Scan vault and move existing notes that contain this profile's properties to the default folder").setDisabled(!active.defaultFolder).onClick(() => this.moveExistingNotesForProfile(active));
            });
            const allExcluded = uniqueStrings([...(active.excludedFolders || []), ...(this.plugin.settings.universalExcludedFolders || [])]);
            new obsidian_1.Setting(profileDetails)
                .setName("Excluded folders")
                .setDesc(allExcluded.length ? `Excluded: ${allExcluded.join(", ")}` : "Notes in specific folders will bypass auto-routing.")
                .addButton(b => b.setButtonText("Manage excluded folders…").onClick(() => {
                    new TaxoExcludeFoldersModal(this.app, this.plugin, active, () => this.display()).open();
                }));
            new obsidian_1.Setting(profileDetails).addButton(b => b.setButtonText("Delete profile configuration…").setWarning().onClick(() => this.confirmDeleteProfile(active)));
        } else profileDetails.createEl("p", { text: "Your first profile will define a namespace and own its selector configuration. No book-specific or other domain-specific profile is created automatically.", cls: "setting-item-description" });
        updateActiveCollapsed();

        if (active) {
            const properties = groupA.createDiv({ cls: "taxoflow-settings-section taxoflow-properties-section has-data" });
            const sticky = properties.createDiv({ cls: "taxoflow-properties-sticky-header" });
            const propertiesHeader = new obsidian_1.Setting(sticky).setName("Properties").setDesc("Underlying frontmatter keys stay stable; display labels customize the Obsidian Properties UI.").setHeading();
            const propertyBody = properties.createDiv({ cls: "taxoflow-properties-body" });
            const propertyCollapsed = this._sectionCollapsed.properties ?? false;
            propertyBody.hidden = propertyCollapsed; properties.classList.toggle("is-collapsed", propertyCollapsed);

            const textContainer = createDiv({ cls: 'taxoflow-properties-text-wrapper' });
            textContainer.style.display = 'flex';
            textContainer.style.flexDirection = 'column';

            textContainer.appendChild(propertiesHeader.nameEl);
            textContainer.appendChild(propertiesHeader.descEl);
            propertiesHeader.infoEl.prepend(textContainer);

            propertiesHeader.addSearch(search => {
                search.setPlaceholder("Search properties…").setValue(this._searchQuery);
                search.inputEl.addClass("taxoflow-property-search");
                search.inputEl.setAttribute("aria-label", "Search properties in active profile");
                search.onChange(value => {
                    this._searchQuery = value;
                    this.filterProperties(active, value);
                });
            });

            let toggleAllBtn = null;
            const updateToggleAllState = () => {
                if (!toggleAllBtn || !active?.selectors?.length) {
                    if (toggleAllBtn) {
                        toggleAllBtn.setIcon("chevrons-up-down");
                        toggleAllBtn.setTooltip("Expand all properties");
                    }
                    return;
                }
                const allExpanded = active.selectors.every(s => this._collapsedStateBySelector.get(s) === false);
                if (allExpanded) {
                    toggleAllBtn.setIcon("chevrons-down-up");
                    toggleAllBtn.setTooltip("Collapse all properties");
                } else {
                    toggleAllBtn.setIcon("chevrons-up-down");
                    toggleAllBtn.setTooltip("Expand all properties");
                }
            };
            this._updateToggleAllState = updateToggleAllState;
            propertiesHeader.addExtraButton(button => {
                toggleAllBtn = button;
                button.onClick(() => {
                    const allExpanded = active.selectors.every(s => this._collapsedStateBySelector.get(s) === false);
                    this.setVisiblePropertiesCollapsed(allExpanded);
                    updateToggleAllState();
                });
            });

            propertiesHeader.addExtraButton(button => button.setIcon("plus").setTooltip("Add property").onClick(() => new TaxoAddSelectorModal(this.app, this.plugin, active, () => this.display()).open()));

            propertiesHeader.addExtraButton(button => button.setIcon(propertyCollapsed ? "chevron-right" : "chevron-down").setTooltip(propertyCollapsed ? "Expand Properties" : "Collapse Properties").onClick(() => {
                this._sectionCollapsed.properties = !propertyBody.hidden; propertyBody.hidden = !propertyBody.hidden; properties.classList.toggle("is-collapsed", propertyBody.hidden);
                button.setIcon(propertyBody.hidden ? "chevron-right" : "chevron-down"); button.setTooltip(propertyBody.hidden ? "Expand Properties" : "Collapse Properties");
            }));

            const list = propertyBody.createDiv({ cls: "taxoflow-properties-list" });

            if (active.selectors && active.selectors.length > 0) {
                for (const selector of active.selectors) this.renderSelector(list, active, selector);
            } else {
                list.createEl("p", {
                    text: "No properties configured yet. Click '+' above to add your first selector property.",
                    cls: "taxoflow-properties-empty setting-item-description",
                    attr: { style: "padding-bottom: 12px;" }
                });
            }

            const noResults = propertyBody.createEl("p", { cls: "taxoflow-no-property-results", text: "No properties match this search." }); noResults.hidden = true; this._noPropertyResultsEl = noResults;
            this.filterProperties(active, this._searchQuery);
            updateToggleAllState();
        } else {
            const emptyProperties = groupA.createDiv({ cls: "taxoflow-settings-section taxoflow-properties-section" });
            const sticky = emptyProperties.createDiv({ cls: "taxoflow-properties-sticky-header" });
            const header = new obsidian_1.Setting(sticky).setName("Properties").setDesc("Create a profile before adding properties.").setHeading();

            const textContainer = createDiv({ cls: 'taxoflow-properties-text-wrapper' });
            textContainer.style.display = 'flex';
            textContainer.style.flexDirection = 'column';

            textContainer.appendChild(header.nameEl);
            textContainer.appendChild(header.descEl);
            header.infoEl.prepend(textContainer);

            const emptyBody = emptyProperties.createDiv({ cls: "taxoflow-properties-body" });
            let emptyCollapsed = this._sectionCollapsed.properties ?? false; emptyBody.hidden = emptyCollapsed;
            emptyProperties.classList.toggle("is-collapsed", emptyCollapsed);

            header.addExtraButton(button => button.setIcon("plus").setTooltip("Create first profile").onClick(() => new TaxoCreateProfileModal(this.app, this.plugin, () => this.display()).open()));
            header.addExtraButton(button => button.setIcon(emptyCollapsed ? "chevron-right" : "chevron-down").setTooltip(emptyCollapsed ? "Expand Properties" : "Collapse Properties").onClick(() => {
                emptyCollapsed = !emptyCollapsed;
                this._sectionCollapsed.properties = emptyCollapsed;
                emptyBody.hidden = emptyCollapsed;
                emptyProperties.classList.toggle("is-collapsed", emptyCollapsed);
                button.setIcon(emptyCollapsed ? "chevron-right" : "chevron-down");
                button.setTooltip(emptyCollapsed ? "Expand Properties" : "Collapse Properties");
            }));
            emptyBody.createEl("p", { text: "No active profile exists. Create your first profile to define a namespace and begin adding selectors.", cls: "setting-item-description" });
        }

        const groupB = containerEl.createDiv({ cls: "taxoflow-settings-group" });
        this.renderPropertySchemas(groupB);
        this.renderExtraLabels(groupB);
        this.renderOrphans(groupB, this._selectorOccurrenceMap);
        this.renderMaintenance(groupB);

        if (sameProfile && scrollPositions.length) this.restoreScrollPositions(scrollPositions);
        const focusKey = this.plugin.pendingFocusSelectorKey;
        if (focusKey && active?.selectors.some(selector => selector.name === focusKey)) {
            const searchInput = containerEl.querySelector(".taxoflow-property-search"); if (searchInput) searchInput.value = "";
            this._searchQuery = ""; this.filterProperties(active, "");
            const card = [...containerEl.querySelectorAll(".taxoflow-selector-card")].find(item => item.dataset.selectorKey === focusKey);
            if (card) {
                containerEl.querySelectorAll(".taxoflow-selector-card").forEach(other => { if (other._tfSelector) this.setSelectorCollapsed(other, other._tfSelector, other !== card); });
                this.setSelectorCollapsed(card, card._tfSelector, false); this.plugin.pendingFocusSelectorKey = "";
                window.requestAnimationFrame(() => { if (card.isConnected) card.scrollIntoView({ block: "center", behavior: "auto" }); });
            }
        }
    }
    renderMaintenance(containerEl) {
        const section = containerEl.createDiv({ cls: "taxoflow-settings-section taxoflow-maintenance-section" });
        const heading = new obsidian_1.Setting(section).setName("Maintenance").setDesc("Configuration validation and maintenance tools.").setHeading();
        const body = section.createDiv({ cls: "taxoflow-maintenance-body" });
        let collapsed = this._sectionCollapsed.maintenance ?? true; body.hidden = collapsed; section.classList.toggle("is-collapsed", collapsed);
        let toggle = null;
        heading.addExtraButton(button => { toggle = button; button.setIcon(collapsed ? "chevron-right" : "chevron-down").setTooltip(collapsed ? "Expand Maintenance" : "Collapse Maintenance").onClick(() => {
            collapsed = !collapsed; this._sectionCollapsed.maintenance = collapsed; body.hidden = collapsed; section.classList.toggle("is-collapsed", collapsed); button.setIcon(collapsed ? "chevron-right" : "chevron-down"); button.setTooltip(collapsed ? "Expand Maintenance" : "Collapse Maintenance");
        }); });
        new obsidian_1.Setting(body).setName("Validate configuration").setDesc("Check namespaces, missing parents, dependency cycles, option lists, rule conflicts, and selector defaults.").addButton(b => b.setButtonText("Run checks…").onClick(() => new TaxoValidationModal(this.app, this.plugin).open()));
    }

    renderPropertySchemas(containerEl) {
        const section = containerEl.createDiv({ cls: "taxoflow-settings-section" });
        const heading = new obsidian_1.Setting(section)
            .setName("Property Schemas")
            .setDesc("Define payloads that completely replace a note's frontmatter when a specific property is triggered.")
            .setHeading();
            
        const body = section.createDiv({ cls: "taxoflow-properties-body" });
        let collapsed = this._sectionCollapsed.schemas ?? false;
        body.hidden = collapsed;
        section.classList.toggle("is-collapsed", collapsed);
        
        heading.addExtraButton(button => button.setIcon("plus").setTooltip("Create Schema").onClick(() => {
            new TaxoSchemaEditorModal(this.app, this.plugin, null, true, () => this.display()).open();
        }));

        heading.addExtraButton(button => {
            button.setIcon(collapsed ? "chevron-right" : "chevron-down")
                .setTooltip(collapsed ? "Expand Schemas" : "Collapse Schemas")
                .onClick(() => {
                    collapsed = !collapsed;
                    this._sectionCollapsed.schemas = collapsed;
                    body.hidden = collapsed;
                    section.classList.toggle("is-collapsed", collapsed);
                    button.setIcon(collapsed ? "chevron-right" : "chevron-down");
                });
        });

        const schemas = this.plugin.settings.propertySchemas || [];
        if (schemas.length === 0) {
            body.createEl("p", { text: "No schemas configured. Click '+' to create one.", cls: "setting-item-description" });
            return;
        }

        for (const schema of schemas) {
            new obsidian_1.Setting(body)
                .setName(schema.name)
                .setDesc(`Triggers when "${schema.triggerKey || (schema.conditions?.[0]?.key)}" is matched. Injects ${schema.properties.length} properties.`)
                .addButton(b => b.setIcon("pencil").setTooltip("Edit schema").onClick(() => {
                    new TaxoSchemaEditorModal(this.app, this.plugin, schema, false, () => this.display()).open();
                }))
                .addButton(b => b.setIcon("trash-2").setTooltip("Delete schema").onClick(async () => {
                    this.plugin.settings.propertySchemas = this.plugin.settings.propertySchemas.filter(s => s.id !== schema.id);
                    await this.plugin.saveSettings();
                    this.display();
                }));
        }
    }

    renderOrphans(containerEl, occurrencesByKey = null, scanError = null) {
        let section = containerEl.querySelector(".taxoflow-orphans-section");
        if (!section) section = containerEl.createDiv({ cls: "taxoflow-settings-section taxoflow-orphans-section" });
        section.empty(); section.addClass("taxoflow-settings-section");
        const header = new obsidian_1.Setting(section).setName("Orphans").setDesc("Selector-key instances without an active selector definition. Inspect, remove, or bulk-change actual note data.").setHeading();
        const body = section.createDiv({ cls: "taxoflow-orphans-body" });
        const collapsed = this._sectionCollapsed.orphans ?? false; body.hidden = collapsed; section.classList.toggle("is-collapsed", collapsed);
        header.addExtraButton(button => { button.setIcon(collapsed ? "chevron-right" : "chevron-down").setTooltip(collapsed ? "Expand Orphans" : "Collapse Orphans").onClick(() => {
            this._sectionCollapsed.orphans = !body.hidden; body.hidden = !body.hidden; section.classList.toggle("is-collapsed", body.hidden); button.setIcon(body.hidden ? "chevron-right" : "chevron-down"); button.setTooltip(body.hidden ? "Expand Orphans" : "Collapse Orphans");
        }); });
        const status = body.createEl("p", { cls: "taxoflow-orphans-empty setting-item-description", text: scanError ? `Could not scan orphan properties: ${scanError?.message || scanError}` : "Scanning note frontmatter for orphan selector properties…" });
        const generation = ++this.plugin.orphanInventoryGeneration;
        const inventoryPromise = occurrencesByKey ? Promise.resolve(occurrencesByKey) : this.plugin.scanAllSelectorOccurrences();
        void inventoryPromise.then(async map => {
            if (!section.isConnected || generation !== this.plugin.orphanInventoryGeneration) return;
            this._selectorOccurrenceMap = map; this.updateSelectorInstanceCountLabels(map);
            const orphans = await this.plugin.scanOrphanProperties(map);
            if (!section.isConnected || generation !== this.plugin.orphanInventoryGeneration) return;
            body.empty();
            if (!orphans.length) { body.createEl("p", { cls: "taxoflow-orphans-empty setting-item-description", text: "No orphan selector properties with note instances were found." }); return; }
            const noProfile = orphans.filter(item => item.kind === "unmatched-profile" || item.kind === "ambiguous-profile");
            const profileMissing = orphans.filter(item => item.kind === "unregistered-selector");
            const renderGroup = (key, title, items, description, removeButtonText) => {
                if (!items.length) return;
                const group = body.createDiv({ cls: `taxoflow-orphan-group taxoflow-orphan-group-${key}` });
                const groupHeader = group.createDiv({ cls: "taxoflow-orphan-group-header" });
                const titleButton = groupHeader.createEl("button", { cls: "taxoflow-orphan-group-toggle" });
                let groupCollapsed = this._orphanCategoryCollapsed[key] ?? true;
                titleButton.setText(`${groupCollapsed ? "▸" : "▾"} ${title} (${items.length})`);
                titleButton.setAttribute("aria-expanded", String(!groupCollapsed));
                const groupActions = groupHeader.createDiv({ cls: "taxoflow-orphan-group-actions" });
                new obsidian_1.ButtonComponent(groupActions).setButtonText(removeButtonText).setWarning().onClick(() => this.confirmRemoveOrphanCategory(title, items));
                const groupBody = group.createDiv({ cls: "taxoflow-orphan-group-body" }); groupBody.hidden = groupCollapsed;
                titleButton.addEventListener("click", () => { groupCollapsed = !groupCollapsed; this._orphanCategoryCollapsed[key] = groupCollapsed; groupBody.hidden = groupCollapsed; titleButton.setText(`${groupCollapsed ? "▸" : "▾"} ${title} (${items.length})`); titleButton.setAttribute("aria-expanded", String(!groupCollapsed)); });
                groupBody.createEl("p", { text: description, cls: "setting-item-description" });
                const list = groupBody.createDiv({ cls: "taxoflow-orphans-list" });
                for (const item of items) {
                    const setting = new obsidian_1.Setting(list).setName(item.key).setDesc(`${item.count} note instance(s)${item.profile ? ` · Profile: ${item.profile.name}` : ""}`);
                    setting.addButton(button => button.setButtonText("Inspect & manage…").onClick(() => new TaxoOrphanManagementModal(this.app, this.plugin, item, () => { this.display(); }).open()));
                    if (item.profile && item.kind === "unregistered-selector") setting.addButton(button => button.setButtonText("Register selector").onClick(async () => {
                        try { await this.plugin.registerOrphanSelector(item); this.display(); new obsidian_1.Notice(`Registered ${item.key} in ${item.profile.name}.`); }
                        catch (error) { new obsidian_1.Notice(error?.message || `Could not register ${item.key}.`); }
                    }));
                    if (!item.profile || item.kind !== "unregistered-selector") setting.addButton(button => button.setButtonText("Create profile…").onClick(() => new TaxoCreateProfileModal(this.app, this.plugin, () => { this.display(); void this.plugin.registerExistingNamespacedProperties(); }).open()));
                }
            };
            renderGroup("noProfile", "No matching profile", noProfile, "These selector keys do not match exactly one configured profile namespace. Their note data is preserved.", "Remove all no-profile orphans…");
            renderGroup("profileMissing", "Profile exists, selector is not configured", profileMissing, "These keys match a profile namespace but have no selector definition. They may have been intentionally removed from a profile.", "Remove all profile orphans…");
        }).catch(error => {
            if (!section.isConnected || generation !== this.plugin.orphanInventoryGeneration) return;
            status.textContent = `Could not scan orphan properties: ${error?.message || error}`;
        });
    }
    confirmRemoveOrphanCategory(title, items) {
        const details = {
            operation: "Remove all orphan occurrences in category",
            category: title,
            scope: "Every listed Markdown note across the vault",
            propertyKeys: items.map(item => item.key),
            exactOccurrences: items.flatMap(item => item.occurrences.map(occurrence => ({ propertyKey: item.key, notePath: occurrence.path, exactValue: occurrence.value }))),
            configurationAffected: false,
        };
        new TaxoDetailedConfirmModal(this.app, `Remove all ${title.toLocaleLowerCase()}?`, `This removes every listed orphan property occurrence in the vault for ${items.length} key(s). The exact paths and values are shown in the review details. This action cannot be undone by TaxoFlow Properties.`, "Remove all listed occurrences", JSON.stringify(details, null, 2), async () => {
            const report = { deleted: [], conflicts: [], errors: [] };
            for (const item of items) {
                const result = await this.plugin.removeOrphanOccurrences(item.key, item.occurrences);
                report.deleted.push(...result.deleted); report.conflicts.push(...result.conflicts); report.errors.push(...result.errors);
            }
            this.display();
            if (report.conflicts.length || report.errors.length) new obsidian_1.Notice(`Partial orphan removal: ${report.deleted.length} note occurrence(s) removed, ${report.conflicts.length} conflict(s), ${report.errors.length} error(s). Review Orphans again.`, 10000);
            else new obsidian_1.Notice(`Removed orphan occurrences from ${report.deleted.length} note(s).`);
        }).open();
    }
    updateSelectorInstanceCountLabels(occurrencesByKey) {
        const map = occurrencesByKey instanceof Map ? occurrencesByKey : new Map();
        this._selectorOccurrenceMap = map;
        this.containerEl.querySelectorAll(".taxoflow-selector-card").forEach(card => {
            const key = card.dataset.selectorKey || ""; const description = card.querySelector(".taxoflow-selector-header .setting-item-description");
            if (!description || !key) return;
            const count = map.get(key)?.length || 0;
            description.textContent = `${key} · ${count === 0 ? "No note instances" : `${count} note instance(s)`}`;
        });
    }
    refreshLiveInventory(occurrencesByKey = null) {
        if (!this.containerEl?.isConnected) return;
        const scrollPositions = this.captureScrollPositions(this.containerEl);
        const update = map => {
            if (!this.containerEl.isConnected) return;
            this.updateSelectorInstanceCountLabels(map);
            this.renderOrphans(this.containerEl, map);
            this.restoreScrollPositions(scrollPositions);
        };
        if (occurrencesByKey instanceof Map) { update(occurrencesByKey); return; }
        void this.plugin.scanAllSelectorOccurrences().then(update).catch(error => {
            if (this.containerEl.isConnected) this.renderOrphans(this.containerEl, null, error);
        });
    }
    captureScrollPositions(element) {
        const positions = [];
        let current = element;
        while (current && current !== document.body && current !== document.documentElement) {
            if (current.clientHeight > 0 && current.scrollHeight > current.clientHeight + 1) {
                positions.push({ element: current, top: current.scrollTop });
            }
            current = current.parentElement;
        }
        return positions;
    }
    restoreScrollPositions(positions) {
        window.requestAnimationFrame(() => {
            for (const position of positions) {
                if (position.element?.isConnected) position.element.scrollTop = position.top;
            }
        });
    }
    filterProperties(profile, query) {
        const needle = String(query || "").trim().toLocaleLowerCase();
        let visibleCount = 0;
        this.containerEl.querySelectorAll(".taxoflow-selector-card").forEach(card => {
            const selector = card._tfSelector;
            const searchable = selector ? `${selector.label || humanize(selector.name)} ${selector.name}`.toLocaleLowerCase() : "";
            const matches = !needle || searchable.includes(needle);
            card.classList.toggle("taxoflow-filtered-out", !matches);
            card.style.display = matches ? "" : "none";
            if (matches) visibleCount += 1;
        });
        this.containerEl.querySelectorAll(".taxoflow-extra-label-row").forEach(row => {
            const searchable = `${row.dataset.labelKey || ""} ${row.dataset.labelValue || ""}`.toLocaleLowerCase();
            const matches = !needle || searchable.includes(needle);
            row.classList.toggle("taxoflow-filtered-out", !matches);
            row.style.display = matches ? "" : "none";
            if (matches) visibleCount += 1;
        });
        if (this._noPropertyResultsEl) this._noPropertyResultsEl.hidden = !(needle && visibleCount === 0);
    }
    setVisiblePropertiesCollapsed(collapsed) {
        this.containerEl.querySelectorAll(".taxoflow-selector-card").forEach(card => {
            if (card.style.display === "none") return;
            if (card._tfSelector) this.setSelectorCollapsed(card, card._tfSelector, collapsed);
        });
        this._updateToggleAllState?.();
    }
    setSelectorCollapsed(group, selector, collapsed) {
        group.classList.toggle("is-collapsed", Boolean(collapsed));
        group.setAttribute("aria-expanded", String(!collapsed));
        this._collapsedStateBySelector.set(selector, Boolean(collapsed));
        const control = group._tfCollapseControl;
        if (control) {
            control.setIcon(collapsed ? "chevron-right" : "chevron-down");
            control.setTooltip(collapsed ? "Expand property settings" : "Collapse property settings");
        }
        this._updateToggleAllState?.();
    }
    renderSelector(containerEl, profile, selector) {
        const group = containerEl.createDiv({ cls: "taxoflow-selector-card" });
        group.dataset.selectorKey = selector.name;
        group._tfSelector = selector;

        let collapseControl = null;
        const cachedOccurrences = this._selectorOccurrenceMap instanceof Map ? (this._selectorOccurrenceMap.get(selector.name) || []) : null;
        const countDescription = cachedOccurrences === null ? `${selector.name} · Checking note instances…` : `${selector.name} · ${cachedOccurrences.length ? `${cachedOccurrences.length} note instance(s)` : "No note instances"}`;
        const header = new obsidian_1.Setting(group)
            .setName(selector.label || humanize(selector.name))
            .setDesc(countDescription)
            .setHeading();
        header.settingEl.addClass("taxoflow-selector-header");
        header.settingEl.querySelector(".setting-item-description")?.classList.add("taxoflow-selector-instance-status");
        header.addExtraButton(b => {
            collapseControl = b;
            b.setIcon("chevron-right")
                .setTooltip("Expand property settings")
                .onClick(() => this.setSelectorCollapsed(group, selector, !group.classList.contains("is-collapsed")));
        });
        header.addExtraButton(b => b.setIcon("minus-circle")
            .setTooltip("Remove selector configuration only; note data remains")
            .onClick(() => new TaxoRemoveSelectorConfigModal(this.app, this.plugin, profile, selector, () => this.display()).open()));
        header.addButton(b => b.setButtonText("Delete data…").setWarning()
            .onClick(() => new TaxoDeleteSelectorAndDataModal(this.app, this.plugin, profile, selector, () => this.display()).open()));

        group._tfCollapseControl = collapseControl;
        const details = group.createDiv({ cls: "taxoflow-selector-details" });

        new obsidian_1.Setting(details).setName("Display label").setDesc("Shown visually; the stored property key is not changed.").addText(t =>
            t.setPlaceholder(humanize(selector.name)).setValue(selector.label || "").onChange(value => {
                selector.label = value.trim();
                this.plugin.refreshFlatSelectors();
                this.refreshLabel(group, selector);
                this.plugin.scheduleLabelRefresh();
                this.plugin.scheduleSettingsSave();
                this.filterProperties(profile, this._searchQuery);
            }));
        new obsidian_1.Setting(details).setName("Property key").setDesc("Namespaced key stored in frontmatter.").addText(t =>
            t.setValue(selector.name).setDisabled(true)).addButton(b =>
            b.setButtonText("Rename key…").onClick(() => new TaxoRenameSelectorModal(
                this.app, this.plugin, profile, selector, () => this.display()
            ).open()));

        if (normalizeDependsOn(selector.dependsOn).length || (selector.rules || []).length) {
            const deps = normalizeDependsOn(selector.dependsOn);
            const summary = deps.length ? deps.map(k => {
                const parent = profile.selectors.find(s => s.name === k);
                return parent?.label || humanize(k);
            }).join(" → ") : "Rules not configured";
            new obsidian_1.Setting(details).setName("Dependency rules")
                .setDesc(`${summary}. ${selector.rules?.length || 0} rule(s).`)
                .addButton(b => b.setButtonText("Manage rules…").setCta().onClick(() =>
                    new TaxoRuleBuilderModal(this.app, this.plugin, profile, selector, () => this.display()).open()));
        } else {
            new obsidian_1.Setting(details).setName("Options")
                .setDesc("Comma-separated or newline-separated values for this independent selector.")
                .addTextArea(t => {
                    t.inputEl.rows = 2;
                    t.inputEl.addClass("taxoflow-options-input");
                    t.setValue((selector.options || []).join("\n")).setPlaceholder("First option, Second option");
                    t.onChange(value => {
                        selector.options = parseOptionList(value);
                        this.plugin.invalidateRuntimeCaches();
                        this.plugin.refreshOpenSuggestions(selector.name);
                        this.plugin.scheduleSettingsSave();
                    });
                });
            new obsidian_1.Setting(details).setName("Dependency rules")
                .setDesc("Use a visual rule builder to make options depend on other properties.")
                .addButton(b => b.setButtonText("Set up dependencies…").onClick(() =>
                    new TaxoRuleBuilderModal(this.app, this.plugin, profile, selector, () => this.display()).open()));
        }
        const configuredDefaultOptions = this.plugin.getKnownOptionsForSelector(selector);
        const defaultSetting = new obsidian_1.Setting(details).setName("Default value")
            .setDesc("Choose an option to automatically populate instances of this property when valid in context. If existing notes already have values, you will be prompted before anything is overwritten.")
            .addDropdown(dropdown => {
                dropdown.addOption("", "No default");
                if (selector.defaultValue && !configuredDefaultOptions.includes(selector.defaultValue)) {
                    dropdown.addOption(selector.defaultValue, `Unavailable option: ${selector.defaultValue}`);
                }
                for (const option of configuredDefaultOptions) dropdown.addOption(option, option);
                dropdown.setValue(selector.defaultValue || "");
                dropdown.onChange(async value => {
                    const previous = selector.defaultValue || "";
                    selector.defaultValue = value;
                    this.plugin.invalidateRuntimeCaches();
                    try {
                        await this.plugin.saveSettings();
                    } catch (error) {
                        selector.defaultValue = previous;
                        this.plugin.invalidateRuntimeCaches();
                        new obsidian_1.Notice(`Could not save the default value: ${error?.message || error}`);
                        return;
                    }
                    if (!value) {
                        this.plugin.refreshOpenSuggestions(selector.name);
                        return;
                    }
                    try {
                        const occurrences = await this.plugin.scanPropertyOccurrences(selector.name);
                        const populated = [];
                        let emptyCount = 0;
                        for (const occ of occurrences) {
                            if (isEmptyPropertyValue(occ.value)) emptyCount++;
                            else populated.push(occ);
                        }

                        const applyAction = async (overwriteAll) => {
                            const result = await this.plugin.applyDefaultToExistingInstances(selector, overwriteAll);
                            this.plugin.refreshOpenSuggestions(selector.name);
                            const messages = [`Applied default to ${result.updated} note instance(s).`];
                            if (result.unsupportedType) messages.push(`${result.unsupportedType} skipped because the property type is not explicitly Text or List.`);
                            if (result.errors.length) messages.push(`${result.errors.length} note write(s) failed; see the console for details.`);
                            new obsidian_1.Notice(messages.join(" "), result.errors.length ? 10000 : 6000);
                        };

                        if (populated.length > 0) {
                            new TaxoDefaultValueConflictModal(this.app, this.plugin, selector, value, populated, emptyCount, async (choice) => {
                                if (choice === "cancel") return;
                                await applyAction(choice === "overwrite-all");
                            }).open();
                        } else {
                            await applyAction(false);
                        }
                    } catch (error) {
                        console.error("TaxoFlow Properties: could not apply default value to existing instances", selector.name, error);
                        new obsidian_1.Notice(`Default saved, but existing instances could not all be scanned: ${error?.message || error}`, 10000);
                    }
                });
            });
        if (selector.defaultValue && !configuredDefaultOptions.includes(selector.defaultValue)) {
            defaultSetting.setDesc(`The saved default “${selector.defaultValue}” is no longer a configured option. Choose an available option or No default. The current default will not be applied until corrected.`);
        }

        const priorState = this._collapsedStateBySelector.get(selector);
        this.setSelectorCollapsed(group, selector, priorState === undefined ? true : priorState);
    }
    refreshLabel(group, selector) { const h = group.querySelector(".setting-item-name"); if (h) h.textContent = selector.label || humanize(selector.name); }
    renderExtraLabels(containerEl) {
        const section = containerEl.createDiv({ cls: "taxoflow-settings-section taxoflow-extra-labels-section" });
        const header = new obsidian_1.Setting(section).setName("Additional property labels").setDesc("Optional display labels for any property across your vault.").setHeading();
        const body = section.createDiv({ cls: "taxoflow-extra-labels-body" });
        let collapsed = this._sectionCollapsed.extraLabels ?? true; body.hidden = collapsed; section.classList.toggle("is-collapsed", collapsed);
        
        let labelSearchQuery = "";
        header.addSearch(search => {
            search.setPlaceholder("Search labels...");
            search.onChange(value => {
                labelSearchQuery = value.trim().toLocaleLowerCase();
                body.querySelectorAll(".taxoflow-extra-label-row").forEach(row => {
                    const key = (row.dataset.labelKey || "").toLocaleLowerCase();
                    const val = (row.dataset.labelValue || "").toLocaleLowerCase();
                    row.style.display = (!labelSearchQuery || key.includes(labelSearchQuery) || val.includes(labelSearchQuery)) ? "" : "none";
                });
            });
        });

        header.addButton(button => button.setButtonText("Label unassigned keys...").onClick(() => {
            new TaxoUnlabeledPropertiesModal(this.app, this.plugin, () => this.display()).open();
        }));

        header.addExtraButton(button => button.setIcon("plus").setTooltip("Add property label").onClick(() => new TaxoAddLabelModal(this.app, this.plugin, () => this.display()).open()));
        
        header.addExtraButton(button => button.setIcon(collapsed ? "chevron-right" : "chevron-down").setTooltip(collapsed ? "Expand additional labels" : "Collapse additional labels").onClick(() => {
            collapsed = !collapsed; this._sectionCollapsed.extraLabels = collapsed; body.hidden = collapsed; section.classList.toggle("is-collapsed", collapsed); button.setIcon(collapsed ? "chevron-right" : "chevron-down"); button.setTooltip(collapsed ? "Expand additional labels" : "Collapse additional labels");
        }));
        
        const labelsObj = this.plugin.settings.globalPropertyLabels || {};
        if (Object.keys(labelsObj).length === 0) {
            body.createEl("p", { text: "No additional labels configured. Click '+' to add one.", cls: "setting-item-description" });
        }

        for (const [key, label] of Object.entries(labelsObj)) {
            const row = new obsidian_1.Setting(body).setName(key).addText(t => t.setValue(label).onChange(value => {
                if (value.trim()) this.plugin.settings.globalPropertyLabels[key] = value.trim(); else delete this.plugin.settings.globalPropertyLabels[key];
                this.plugin.refreshFlatSelectors(); this.plugin.scheduleLabelRefresh(); this.plugin.scheduleSettingsSave();
                const rowEl = t.inputEl.closest(".setting-item"); if (rowEl) rowEl.dataset.labelValue = value.trim();
            }));
            row.settingEl.addClass("taxoflow-extra-label-row"); row.settingEl.dataset.labelKey = key; row.settingEl.dataset.labelValue = label;
            row.addExtraButton(b => b.setIcon("trash-2").setTooltip("Remove label").onClick(() => {
                const details = { propertyKey: key, label, noteDataAffected: false };
                new TaxoDetailedConfirmModal(this.app, "Remove property label?", `This removes only the display label configuration; the property's stored key and values are preserved in all notes.`, "Remove label", JSON.stringify(details, null, 2), async () => {
                    delete this.plugin.settings.globalPropertyLabels[key];
                    try { await this.plugin.saveSettings(); } catch (error) { this.plugin.settings.globalPropertyLabels[key] = label; this.plugin.invalidateRuntimeCaches(); throw error; }
                    this.plugin.scheduleLabelRefresh(); this.display();
                }).open();
            }));
        }
    }
    addLabel(profile) {
        new TaxoAddLabelModal(this.app, this.plugin, profile, () => this.display()).open();
    }
    confirmDeleteProfile(profile) {
        new TaxoDeleteProfileModal(this.app, this.plugin, profile, () => this.display()).open();
    }
    async moveExistingNotesForProfile(profile) {
        const targetFolder = normalizeFolderPath(profile.defaultFolder);
        if (!targetFolder) {
            new obsidian_1.Notice("Please specify a default folder first.");
            return;
        }
        const files = this.app.vault.getMarkdownFiles();
        const nonConflict = [];
        const conflict = [];
        let alreadyInPlace = 0;
        for (const file of files) {
            if (isFileInExcludedFolder(file, profile.excludedFolders, this.plugin.settings.universalExcludedFolders)) continue;
            
            const keys = await this.plugin.getNoteFrontmatterKeys(file);
            if (!keys.size) continue;
            const matchingProfiles = getMatchingProfilesForFrontmatterKeys(keys, this.plugin.settings.profiles || []);
            
            const validProfiles = matchingProfiles.filter(p => !isFileInExcludedFolder(file, p.excludedFolders, this.plugin.settings.universalExcludedFolders));
            
            if (!validProfiles.some(p => p.id === profile.id)) continue;
            const resolution = resolveTargetFolderForProfiles(validProfiles);
            if (resolution.status === "single") {
                const targetPath = `${targetFolder}/${file.name}`;
                if (file.path === targetPath) alreadyInPlace++;
                else nonConflict.push(file);
            } else if (resolution.status === "conflict") {
                conflict.push({ file, resolution });
            }
        }
        if (nonConflict.length === 0 && conflict.length === 0) {
            new obsidian_1.Notice(`All matching notes are already in "${targetFolder}/".`);
            return;
        }
        new TaxoMoveExistingNotesConfirmModal(this.app, this.plugin, profile, nonConflict, conflict, async (itemsToMove) => {
            let movedCount = 0;
            let skippedCollisions = 0;
            
            for (const item of itemsToMove) {
                const res = await this.plugin.moveNoteToFolder(item.file, item.targetFolder);
                if (res.success && !res.alreadyThere) movedCount++;
                else if (res.reason === "collision") skippedCollisions++;
            }
            
            let msg = `Moved ${movedCount} note(s).`;
            if (skippedCollisions > 0) msg += ` (${skippedCollisions} note(s) skipped due to name collisions)`;
            new obsidian_1.Notice(msg);
            
        }).open();
    }
}

class TaxoSchemaApplyConfirmModal extends TaxoModal {
    constructor(app, plugin, schema, file) {
        super(app, "Apply Property Schema?", `Note matched conditions for "${schema.name}".`);
        this.plugin = plugin;
        this.schema = schema;
        this.file = file;
    }
    onOpen() {
        super.onOpen();
        this.contentEl.createEl("p", { text: `Would you like to apply the "${this.schema.name}" schema?` });
        
        const warning = this.contentEl.createDiv({ cls: "taxoflow-delete-warning" });
        warning.createEl("strong", { text: "Warning: " });
        warning.createSpan({ text: "Applying this schema will replace ALL existing properties. Your trigger properties and the schema properties will remain." });
        
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("No, leave as is").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Apply schema").setCta().onClick(async () => {
            this.close();
            this.plugin.isApplyingSchema = true;
            try {
                await this.plugin.processFrontMatterSerialized(this.file, fm => {
                    const preserved = {};
                    for (const cond of this.schema.conditions) {
                        if (fm[cond.key] !== undefined) preserved[cond.key] = fm[cond.key];
                    }
                    
                    for (const key of Object.keys(fm)) delete fm[key];
                    
                    for (const prop of this.schema.properties) {
                        if (preserved[prop.key] !== undefined) {
                            fm[prop.key] = preserved[prop.key];
                        } else {
                            fm[prop.key] = prop.isList ? parseOptionList(prop.defaultValue) : String(prop.defaultValue || "").trim();
                        }
                    }
                });
                new obsidian_1.Notice(`Applied "${this.schema.name}" schema to note.`);
            } catch (error) {
                new obsidian_1.Notice(`Failed to apply schema: ${error?.message || error}`);
            } finally {
                window.setTimeout(() => { this.plugin.isApplyingSchema = false; }, 500);
            }
        });
    }
}

class TaxoSchemaEditorModal extends TaxoModal {
    constructor(app, plugin, schema, isNew, onSaved) {
        super(app, isNew ? "Create Property Schema" : "Edit Property Schema", "");
        this.plugin = plugin;
        this.isNew = isNew;
        this.onSaved = onSaved;
        this.schema = schema ? JSON.parse(JSON.stringify(schema)) : {
            id: Date.now().toString(), name: "", matchType: "ALL", conditions: [{ key: "", value: "" }], properties: []
        };
    }
    onOpen() {
        super.onOpen();
        this.modalEl.addClass("taxoflow-schema-editor-modal");
        this.render();
    }
    render() {
        const currentScroll = this.contentEl.scrollTop;
        this.contentEl.empty();
        this.contentEl.addClass("taxoflow-modal");

        this.schema.conditions.forEach(cond => {
            const k = cond.key.trim();
            if (k) {
                const prop = this.schema.properties.find(p => p.key === k);
                if (!prop) {
                    this.schema.properties.unshift({ key: k, defaultValue: cond.value, isList: false });
                } else {
                    prop.defaultValue = cond.value;
                }
            }
        });
        
        const heading = this.contentEl.createEl("h2", { text: this.title, cls: "taxoflow-modal-drag-handle" });
        
        new obsidian_1.Setting(this.contentEl)
            .setName("Schema name")
            .addText(t => t.setValue(this.schema.name).setPlaceholder("e.g., Media Note").onChange(v => this.schema.name = v.trim()));

        this.contentEl.createEl("h3", { text: "Conditions (If)" });
        
        new obsidian_1.Setting(this.contentEl)
            .setName("Match type")
            .setDesc("Require all conditions to match, or any single condition.")
            .addDropdown(d => {
                d.addOption("ALL", "All of the following");
                d.addOption("ANY", "Any of the following");
                d.setValue(this.schema.matchType || "ALL");
                d.onChange(v => { this.schema.matchType = v; });
            });

        const ifContainer = this.contentEl.createDiv({ cls: "taxoflow-schema-table-container" });
        
        const ifHeader = ifContainer.createDiv({ cls: "taxoflow-schema-grid if-grid table-header" });
        ifHeader.createDiv({ text: "Property Key" });
        ifHeader.createDiv({ text: "Value" });
        ifHeader.createDiv({ text: "" });

        this.schema.conditions.forEach((cond, i) => {
            const row = ifContainer.createDiv({ cls: "taxoflow-schema-grid if-grid" });
            
            row.createEl("input", { attr: { type: "text", placeholder: "e.g., taxo.category" }, value: cond.key })
               .addEventListener("change", e => {
                   const oldKey = cond.key.trim();
                   const newKey = e.target.value.trim();
                   cond.key = newKey;
                   if (oldKey && oldKey !== newKey) {
                       const pIdx = this.schema.properties.findIndex(p => p.key === oldKey);
                       if (pIdx > -1) {
                           if (newKey) this.schema.properties[pIdx].key = newKey;
                           else this.schema.properties.splice(pIdx, 1);
                       }
                   }
                   this.render();
               });
               
            row.createEl("input", { attr: { type: "text", placeholder: "e.g., media" }, value: cond.value })
               .addEventListener("change", e => {
                   cond.value = e.target.value;
                   if (cond.key.trim()) {
                       const prop = this.schema.properties.find(p => p.key === cond.key.trim());
                       if (prop) prop.defaultValue = cond.value;
                   }
                   this.render();
               });

            const delBtnContainer = row.createDiv();
            new obsidian_1.ButtonComponent(delBtnContainer)
                .setIcon("trash-2")
                .setTooltip("Remove condition")
                .onClick(() => {
                    const deletedKey = this.schema.conditions[i].key.trim();
                    this.schema.conditions.splice(i, 1);
                    if (deletedKey) {
                        const pIdx = this.schema.properties.findIndex(p => p.key === deletedKey);
                        if (pIdx > -1) this.schema.properties.splice(pIdx, 1);
                    }
                    this.render();
                });
        });

        new obsidian_1.Setting(this.contentEl)
            .addButton(b => b.setButtonText("+ Add condition").onClick(() => {
                this.schema.conditions.push({key: "", value: ""});
                this.render();
            }));

        this.contentEl.createEl("h3", { text: "Actions (Then)", style: "margin-top: 24px;" });
        this.contentEl.createEl("p", { text: "These properties will replace the note's frontmatter. Drag rows to reorder them.", cls: "setting-item-description", style: "margin-bottom: 12px;" });

        const thenContainer = this.contentEl.createDiv({ cls: "taxoflow-schema-table-container" });
        
        const thenHeader = thenContainer.createDiv({ cls: "taxoflow-schema-grid then-grid table-header" });
        thenHeader.createDiv({ text: "" });
        thenHeader.createDiv({ text: "Property Key" });
        thenHeader.createDiv({ text: "Type" });
        thenHeader.createDiv({ text: "Default Value" });
        thenHeader.createDiv({ text: "" });

        if (this.schema.properties.length === 0) {
            thenContainer.createEl("p", { text: "No properties added yet.", cls: "setting-item-description" });
        }

        this.schema.properties.forEach((prop, i) => {
            const row = thenContainer.createDiv({ cls: "taxoflow-schema-grid then-grid taxoflow-draggable-row", attr: { draggable: "true" } });
            
            const handle = row.createDiv({ cls: "taxoflow-drag-handle" });
            obsidian_1.setIcon(handle, "grip-vertical");

            row.addEventListener("dragstart", e => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", i.toString());
                row.classList.add("is-dragging");
            });
            row.addEventListener("dragend", () => {
                row.classList.remove("is-dragging");
                thenContainer.querySelectorAll(".is-drag-over").forEach(el => el.classList.remove("is-drag-over"));
            });
            row.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; row.classList.add("is-drag-over"); });
            row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
            row.addEventListener("drop", e => {
                e.preventDefault();
                row.classList.remove("is-drag-over");
                const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                if (fromIndex !== i && !isNaN(fromIndex)) {
                    const movedItem = this.schema.properties.splice(fromIndex, 1)[0];
                    this.schema.properties.splice(i, 0, movedItem);
                    this.render();
                }
            });

            const isCondition = this.schema.conditions.some(c => c.key.trim() === prop.key && prop.key !== "");

            const keyInput = row.createEl("input", { attr: { type: "text", placeholder: "e.g., taxo.director" }, value: prop.key });
            if (isCondition) {
                keyInput.disabled = true;
                keyInput.style.opacity = "0.6";
            } else {
                keyInput.addEventListener("input", e => prop.key = e.target.value.trim());
            }

            const typeSelect = row.createEl("select", { cls: "dropdown" });
            typeSelect.createEl("option", { value: "text", text: "Text" });
            typeSelect.createEl("option", { value: "list", text: "List" });
            typeSelect.value = prop.isList ? "list" : "text";
            if (isCondition) {
                typeSelect.disabled = true;
                typeSelect.style.opacity = "0.6";
            } else {
                typeSelect.addEventListener("change", e => prop.isList = (e.target.value === "list"));
            }

            const valInput = row.createEl("input", { attr: { type: "text", placeholder: "e.g., Christopher Nolan" }, value: prop.defaultValue });
            if (isCondition) {
                valInput.disabled = true;
                valInput.style.opacity = "0.6";
            } else {
                valInput.addEventListener("input", e => prop.defaultValue = e.target.value);
            }

            const actions = row.createDiv();
            if (isCondition) {
                const lockContainer = actions.createDiv({ attr: { style: "display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);" } });
                obsidian_1.setIcon(lockContainer, "lock");
                lockContainer.setAttribute("aria-label", "Managed in Conditions");
            } else {
                new obsidian_1.ButtonComponent(actions)
                    .setIcon("trash-2")
                    .setTooltip("Remove property")
                    .onClick(() => { this.schema.properties.splice(i, 1); this.render(); });
            }
        });

        new obsidian_1.Setting(this.contentEl)
            .addButton(b => b.setButtonText("+ Add property").onClick(() => {
                this.schema.properties.push({ key: "", defaultValue: "", isList: false });
                this.render();
            }));

        const buttons = this.contentEl.createDiv({ cls: "modal-button-container", style: "margin-top: 24px;" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Save Schema").setCta().onClick(async () => {
            if (!this.schema.name) return new obsidian_1.Notice("Schema name is required.");
            
            this.schema.conditions = this.schema.conditions.filter(c => c.key.trim() !== "");
            if (this.schema.conditions.length === 0) return new obsidian_1.Notice("At least one valid condition is required.");

            if (this.isNew) {
                this.plugin.settings.propertySchemas = this.plugin.settings.propertySchemas || [];
                this.plugin.settings.propertySchemas.push(this.schema);
            } else {
                const index = this.plugin.settings.propertySchemas.findIndex(s => s.id === this.schema.id);
                if (index > -1) this.plugin.settings.propertySchemas[index] = this.schema;
            }
            await this.plugin.saveSettings();
            this.close();
            this.onSaved();
        });
        
        this.installModalDrag(heading);
        this.contentEl.scrollTop = currentScroll;
    }
}

class TaxoUnlabeledPropertiesModal extends TaxoModal {
    constructor(app, plugin, onDone) {
        super(app, "Unlabeled Property Keys", "Select property keys from your vault to assign display labels.");
        this.plugin = plugin;
        this.onDone = onDone;
        this.unlabeledKeys = [];
        this.searchQuery = "";
    }
    async onOpen() {
        super.onOpen();
        this.modalEl.addClass("taxoflow-schema-editor-modal"); 
        this.contentEl.empty();
        this.contentEl.addClass("taxoflow-modal");
        const heading = this.contentEl.createEl("h2", { text: this.title, cls: "taxoflow-modal-drag-handle" });
        this.contentEl.createEl("p", { text: "Scanning vault for properties...", cls: "setting-item-description" });
        
        window.setTimeout(() => {
            const allKeys = this.plugin.getVaultPropertyKeys();
            const configuredLabels = this.plugin.settings.globalPropertyLabels || {};
            const profileLabels = new Set(this.plugin.settings.profiles.flatMap(p => Object.keys(p.propertyLabels || {})));
            
            const selectorKeys = new Set(this.plugin.settings.profiles.flatMap(p => p.selectors.map(s => s.name)));
            
            this.unlabeledKeys = allKeys.filter(k => !configuredLabels[k] && !profileLabels.has(k) && !selectorKeys.has(k)).sort();
            this.render();
        }, 50);
    }
    render() {
        this.contentEl.empty();
        const heading = this.contentEl.createEl("h2", { text: this.title, cls: "taxoflow-modal-drag-handle" });
        this.contentEl.createEl("p", { text: `Found ${this.unlabeledKeys.length} unlabeled keys in your vault.`, cls: "setting-item-description", style: "margin-bottom: 12px;" });
        
        new obsidian_1.Setting(this.contentEl).addSearch(search => {
            search.setPlaceholder("Search keys...").onChange(v => {
                this.searchQuery = v.trim().toLocaleLowerCase();
                this.renderList();
            });
        });
        
        this.listContainer = this.contentEl.createDiv({ cls: "taxoflow-schema-table-container" });
        this.listContainer.style.height = "100%";
        this.listContainer.style.overflowY = "auto";
        
        this.buttons = this.contentEl.createDiv({ cls: "modal-button-container", style: "margin-top: auto;" });
        new obsidian_1.ButtonComponent(this.buttons).setButtonText("Done").setCta().onClick(() => {
            this.close();
            this.onDone();
        });
        
        this.renderList();
        this.installModalDrag(heading);
    }
    renderList() {
        this.listContainer.empty();
        const filtered = this.unlabeledKeys.filter(k => k.toLocaleLowerCase().includes(this.searchQuery));
        
        if (filtered.length === 0) {
            this.listContainer.createEl("p", { text: "No keys match your search.", cls: "setting-item-description" });
            return;
        }
        
        for (const key of filtered.slice(0, 150)) {
            const row = new obsidian_1.Setting(this.listContainer)
                .setName(key)
                .addText(t => {
                    t.setPlaceholder("Display label...");
                    t.setValue(this.plugin.settings.globalPropertyLabels[key] || "");
                    t.onChange(val => {
                        const label = val.trim();
                        this.plugin.settings.globalPropertyLabels = this.plugin.settings.globalPropertyLabels || {};
                        if (label) {
                            this.plugin.settings.globalPropertyLabels[key] = label;
                        } else {
                            delete this.plugin.settings.globalPropertyLabels[key];
                        }
                        
                        this.plugin.refreshFlatSelectors();
                        
                        this.plugin.scheduleSettingsSave(500);
                        this.plugin.scheduleLabelRefresh();
                    });
                });
            row.settingEl.style.borderBottom = "1px solid var(--background-modifier-border)";
            row.settingEl.style.padding = "var(--size-4-2)";
            row.settingEl.style.margin = "0";
        }
        if (filtered.length > 150) {
            this.listContainer.createEl("p", { text: `Showing first 150 of ${filtered.length} keys. Please refine your search.`, cls: "setting-item-description", style: "padding: var(--size-4-2)" });
        }
    }
}

class TaxoAddLabelModal extends TaxoModal {
    constructor(app, plugin, onDone) { super(app, "Add property label", "Add a display label for any property key in your vault."); this.plugin = plugin; this.onDone = onDone; }
    onOpen() {
        super.onOpen(); let key = "", label = "";
        new obsidian_1.Setting(this.contentEl).setName("Property key").setDesc("The exact property key (e.g., taxo.topic or my-custom-field).").addText(t => t.setPlaceholder("topic").setValue(key).onChange(v => key = v.trim()));
        new obsidian_1.Setting(this.contentEl).setName("Label").addText(t => t.setPlaceholder("Topic").onChange(v => label = v.trim()));
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Add label").setCta().onClick(async () => {
            if (!key || !label) { new obsidian_1.Notice("Provide both a property key and a label."); return; }
            this.plugin.settings.globalPropertyLabels = this.plugin.settings.globalPropertyLabels || {};
            if (this.plugin.settings.globalPropertyLabels[key]) { new obsidian_1.Notice("This property key already has a global label. Edit it instead."); return; }
            this.plugin.settings.globalPropertyLabels[key] = label;
            await this.plugin.saveSettings(); this.plugin.scheduleLabelRefresh(); this.close(); this.onDone();
        });
    }
}

class TaxoConfirmModal extends TaxoModal {
    constructor(app, title, body, confirmLabel, callback) { super(app, title, body); this.confirmLabel = confirmLabel; this.callback = callback; }
    onOpen() {
        super.onOpen(); const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText(this.confirmLabel).setWarning().onClick(async () => { this.close(); await this.callback(); });
    }
}

class TaxoDetailedConfirmModal extends TaxoModal {
    constructor(app, title, body, confirmLabel, details, callback) { super(app, title, body); this.confirmLabel = confirmLabel; this.details = details; this.callback = callback; }
    onOpen() {
        super.onOpen();
        const details = this.contentEl.createEl("details", { cls: "taxoflow-delete-details" });
        details.createEl("summary", { text: "Show exact configuration entries affected" });
        details.createEl("pre", { text: this.details });
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText(this.confirmLabel).setWarning().onClick(async () => {
            const button = buttons.querySelector("button.mod-warning"); if (button) button.disabled = true;
            try { await this.callback(); this.close(); }
            catch (error) { console.error("TaxoFlow Properties destructive operation failed", error); new obsidian_1.Notice(error?.message || "The operation failed. No further action was taken."); if (button) button.disabled = false; }
        });
    }
}

class TaxoDeleteProfileModal extends TaxoModal {
    constructor(app, plugin, profile, onDone) { super(app, `Delete profile “${profile.name}”?`, "This deletes only the profile configuration. Properties and values in notes are preserved."); this.plugin = plugin; this.profile = profile; this.onDone = onDone; }
    onOpen() {
        super.onOpen();
        const external = this.plugin.getExternalProfileDependents(this.profile);
        const config = {
            profile: { id: this.profile.id, name: this.profile.name, namespace: this.profile.namespace },
            selectors: (this.profile.selectors || []).map(s => ({ key: s.name, label: s.label || "", options: parseOptionList(s.options), defaultValue: typeof s.defaultValue === "string" ? s.defaultValue : "", dependsOn: normalizeDependsOn(s.dependsOn), rules: normalizeRules(s.rules), customOptionsByContext: normalizeCustomContexts(s.customOptionsByContext) })),
            additionalLabels: this.profile.propertyLabels || {},
            configuredPropertyKeys: (this.profile.selectors || []).map(selector => selector.name),
            notePropertiesDeleted: false,
        };
        this.contentEl.createEl("p", { text: `The following complete configuration will be removed from data.json. Note scope: all notes in the vault are preserved. ${this.profile.selectors.length} selector(s), ${Object.keys(this.profile.propertyLabels || {}).length} additional label(es), and all profile rules and custom-option contexts will be removed.` });
        const details = this.contentEl.createEl("details", { cls: "taxoflow-delete-details" });
        details.createEl("summary", { text: "Show exact profile configuration to be removed" });
        details.createEl("pre", { text: JSON.stringify(config, null, 2) });
        if (external.length) {
            const warning = this.contentEl.createDiv({ cls: "taxoflow-delete-warning" });
            warning.createEl("strong", { text: "Profile deletion is blocked by cross-profile dependencies." });
            warning.createEl("p", { text: external.map(x => `${x.profile}: ${x.key}`).join("\n") });
            warning.createEl("p", { text: "Reconfigure these selectors first so deleting this profile does not break another profile." });
        }
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        const confirm = new obsidian_1.ButtonComponent(buttons).setButtonText("Delete profile configuration").setWarning().onClick(async () => {
            confirm.setDisabled(true);
            try {
                await this.plugin.deleteProfileConfiguration(this.profile);
                this.plugin.scheduleLabelRefresh(); this.close(); this.onDone();
                new obsidian_1.Notice(`Deleted profile configuration “${this.profile.name}”. Note properties and values were preserved.`);
            } catch (error) { new obsidian_1.Notice(error?.message || "Could not delete profile."); confirm.setDisabled(false); }
        });
        if (external.length) confirm.setDisabled(true);
    }
}

class TaxoRemoveSelectorConfigModal extends TaxoModal {
    constructor(app, plugin, profile, selector, onDone) {
        super(app, "Remove selector configuration?", `Profile: ${profile.name}. The property's data in notes will be preserved.`);
        this.plugin = plugin; this.profile = profile; this.selector = selector; this.onDone = onDone;
    }
    onOpen() {
        super.onOpen();
        const dependents = this.plugin.getSelectorDependents(this.profile, this.selector.name);
        const summary = this.contentEl.createEl("pre", { cls: "taxoflow-delete-details", text: JSON.stringify(this.plugin.getConfigSummaryForSelector(this.profile, this.selector), null, 2) });
        this.contentEl.createEl("p", { text: "Configuration to remove is shown above. All Markdown note values are preserved; no note data is deleted." });
        if (dependents.length) {
            const warning = this.contentEl.createDiv({ cls: "taxoflow-delete-warning" });
            warning.createEl("strong", { text: "Cannot remove this selector yet." });
            warning.createEl("p", { text: `These selectors depend on or reference ${this.selector.name}: ${dependents.map(s => s.name).join(", ")}. Reconfigure those dependencies first to avoid breaking their behavior.` });
        }
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        const remove = new obsidian_1.ButtonComponent(buttons).setButtonText("Remove selector configuration").setWarning().onClick(async () => {
            remove.setDisabled(true);
            try { await this.plugin.removeSelectorConfiguration(this.profile, this.selector); this.close(); this.onDone(); new obsidian_1.Notice(`Removed ${this.selector.name} from ${this.profile.name}; note data was preserved.`); }
            catch (error) { new obsidian_1.Notice(error?.message || "Could not remove selector."); remove.setDisabled(false); }
        });
        if (dependents.length) remove.setDisabled(true);
    }
}

class TaxoOrphanManagementModal extends TaxoModal {
    constructor(app, plugin, item, onDone) {
        const kind = item.kind === "unregistered-selector" ? `Profile: ${item.profile?.name || "unknown"}; selector configuration is absent.` : "No configured profile namespace owns this property key.";
        super(app, `Orphan: ${item.key}`, `${kind} Note values are preserved unless you explicitly remove or rename them.`);
        this.plugin = plugin; this.item = item; this.onDone = onDone;
    }
    onOpen() {
        super.onOpen();
        this.contentEl.createEl("p", { text: `${this.item.occurrences.length} current occurrence(s) were found. Review the exact note paths and values below before making changes.` });
        const list = this.contentEl.createDiv({ cls: "taxoflow-delete-note-list" });
        for (const occurrence of this.item.occurrences) {
            const row = list.createDiv({ cls: "taxoflow-orphan-occurrence" });
            row.createEl("strong", { text: occurrence.path });
            row.createEl("pre", { text: JSON.stringify(occurrence.value, null, 2) });
            new obsidian_1.Setting(row).addButton(button => button.setButtonText("Remove this occurrence…").setWarning().onClick(() => {
                const details = { operation: "Remove one orphan occurrence", propertyKey: this.item.key, notePath: occurrence.path, exactValue: occurrence.value, scope: "This note only" };
                new TaxoDetailedConfirmModal(this.app, "Remove orphan occurrence?", `This removes only ${this.item.key} from ${occurrence.path}.`, "Remove occurrence", JSON.stringify(details, null, 2), async () => {
                    const removed = await this.plugin.removeOrphanOccurrence(this.item.key, occurrence);
                    if (!removed) new obsidian_1.Notice(`The occurrence in ${occurrence.path} was already absent.`);
                    else new obsidian_1.Notice(`Removed ${this.item.key} from ${occurrence.path}.`);
                    this.close(); this.onDone();
                }).open();
            }));
        }
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Bulk-change property key…").setCta().onClick(() => new TaxoOrphanBulkRenameModal(this.app, this.plugin, this.item, () => { this.close(); this.onDone(); }).open());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Remove all occurrences…").setWarning().onClick(() => {
            const details = {
                operation: "Remove all orphan occurrences", propertyKey: this.item.key, scope: "All Markdown notes in the vault",
                affectedNotes: this.item.occurrences.map(item => ({ path: item.path, exactValue: item.value })),
                count: this.item.occurrences.length,
                consequences: "The property key and values will be removed from the listed notes. Selector configuration is not changed. Cancellation leaves all notes unchanged."
            };
            new TaxoDetailedConfirmModal(this.app, "Remove all orphan occurrences?", `This removes ${this.item.key} from ${this.item.occurrences.length} note(s) across the vault.`, "Remove all occurrences", JSON.stringify(details, null, 2), async () => {
                const result = await this.plugin.removeOrphanOccurrences(this.item.key, this.item.occurrences);
                const failures = result.conflicts.length + result.errors.length;
                if (failures) new obsidian_1.Notice(`Partial orphan removal: ${result.deleted.length} removed, ${result.conflicts.length} conflict(s), ${result.errors.length} error(s). Review the remaining Orphans inventory.`, 10000);
                else new obsidian_1.Notice(`Removed ${this.item.key} from ${result.deleted.length} note(s).`, 8000);
                this.close(); this.onDone();
            }).open();
        });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Close").onClick(() => this.close());
    }
}

class TaxoOrphanBulkRenameModal extends TaxoModal {
    constructor(app, plugin, item, onDone) { super(app, "Bulk-change orphan property key", `All current instances of ${item.key} will be renamed, with their values preserved.`); this.plugin = plugin; this.item = item; this.onDone = onDone; }
    onOpen() {
        super.onOpen();
        let target = "";
        new obsidian_1.Setting(this.contentEl).setName("New property key").setDesc("May be a regular property (for example, subject) or a selector key. Existing destination properties in the same note are never overwritten.").addText(t => { t.setPlaceholder("subject").onChange(value => target = value.trim()); });
        const preview = this.contentEl.createDiv({ cls: "taxoflow-operation-preview" });
        preview.createEl("strong", { text: `Reviewing ${this.item.occurrences.length} note instance(s)` });
        for (const item of this.item.occurrences) {
            const row = preview.createDiv(); row.createEl("strong", { text: item.path }); row.createEl("pre", { text: JSON.stringify(item.value, null, 2) });
        }
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Review and rename all").setCta().onClick(() => {
            if (!target) { new obsidian_1.Notice("Enter a destination property key."); return; }
            if (target === this.item.key) { new obsidian_1.Notice("The destination key must differ from the orphan key."); return; }
            const details = {
                operation: "Bulk rename orphan property", sourceKey: this.item.key, destinationKey: target,
                scope: "Every currently listed Markdown note in the vault", affectedNotes: this.item.occurrences.map(item => ({ path: item.path, exactValue: item.value })),
                collisionPolicy: "If destination key already exists in a note, no value in that note will be overwritten; that note will be reported as a conflict.",
                valueHandling: "Values and arrays are copied unchanged to the destination key; the old key is removed only in successfully renamed notes."
            };
            new TaxoDetailedConfirmModal(this.app, "Confirm bulk property rename", `Rename ${this.item.key} to ${target} in all listed notes?`, "Rename all occurrences", JSON.stringify(details, null, 2), async () => {
                const result = await this.plugin.renameOrphanOccurrences(this.item.key, target, this.item.occurrences);
                const failures = result.conflicts.length + result.errors.length;
                if (failures) new obsidian_1.Notice(`Partial rename: ${result.renamed.length} note(s) changed, ${result.conflicts.length} conflict(s), ${result.errors.length} error(s). See Orphans for remaining source instances.`, 10000);
                else new obsidian_1.Notice(`Renamed ${this.item.key} to ${target} in ${result.renamed.length} note(s).`, 8000);
                this.close(); this.onDone();
                if (result.unassignedSelector) window.setTimeout(() => new TaxoUnassignedSelectorPromptModal(this.app, this.plugin, target).open(), 100);
                else if (result.registrationCandidatePath) window.setTimeout(() => {
                    const file = this.plugin.app.vault.getAbstractFileByPath(result.registrationCandidatePath);
                    if (file instanceof obsidian_1.TFile) void this.plugin.registerPropertiesInModifiedNote(file);
                }, 100);
            }).open();
        });
    }
}

class TaxoUnassignedSelectorPromptModal extends TaxoModal {
    constructor(app, plugin, key) { super(app, "Selector key has no matching profile", `${key} was renamed in note data, but no configured namespace owns it. It remains an orphan until you create or adjust a profile.`); this.plugin = plugin; this.key = key; }
    onOpen() {
        super.onOpen();
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Create profile…").setCta().onClick(() => {
            this.close();
            new TaxoCreateProfileModal(this.app, this.plugin, async () => {
                const profile = this.plugin.getProfileForPropertyKey(this.key);
                if (!profile) {
                    new obsidian_1.Notice(`No profile namespace matches ${this.key}. Adjust the new profile namespace or rename the property again.`);
                    return;
                }
                if (this.plugin.getSelector(this.key)) return;
                const selector = this.plugin.createAutoRegisteredSelector(this.key, profile);
                profile.selectors.push(selector);
                this.plugin.settings.suppressedAutoRegistrationKeys = (this.plugin.settings.suppressedAutoRegistrationKeys || []).filter(value => value !== this.key);
                try {
                    await this.plugin.saveSettings();
                    new TaxoNewPropertyRegistrationModal(this.app, this.plugin, profile, selector).open();
                    this.plugin.scheduleLabelRefresh();
                } catch (error) {
                    profile.selectors = profile.selectors.filter(item => item !== selector);
                    this.plugin.invalidateRuntimeCaches();
                    new obsidian_1.Notice(`Could not register ${this.key}: ${error?.message || error}`);
                }
            }).open();
        });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Open Orphans settings").onClick(() => {
            this.close(); this.plugin.app.setting?.open?.(); this.plugin.app.setting?.openTabById?.(this.plugin.manifest.id);
        });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Close").onClick(() => this.close());
    }
}

class TaxoFolderConflictModal extends TaxoModal {
    constructor(app, plugin, file, conflictingProfiles, onChoose) {
        super(app, "Choose destination folder", `The note "${file.name}" has properties from multiple profiles with different default folders.`);
        this.plugin = plugin;
        this.file = file;
        this.conflictingProfiles = conflictingProfiles;
        this.onChoose = onChoose;
        this._hasChosen = false;
    }
    onOpen() {
        super.onOpen();
        const { contentEl } = this;
        const list = contentEl.createDiv({ cls: "taxoflow-conflict-list" });
        list.style.display = "flex";
        list.style.flexDirection = "column";
        list.style.gap = "var(--size-4-2)";
        list.style.margin = "var(--size-4-3) 0";

        for (const profile of this.conflictingProfiles) {
            const folder = normalizeFolderPath(profile.defaultFolder);
            const row = list.createDiv({ cls: "taxoflow-conflict-row" });
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            row.style.alignItems = "center";
            row.style.padding = "var(--size-4-2) var(--size-4-3)";
            row.style.border = "1px solid var(--background-modifier-border)";
            row.style.borderRadius = "var(--radius-s)";
            row.style.background = "var(--background-secondary)";

            const info = row.createDiv();
            info.createEl("div", { text: profile.name, attr: { style: "font-weight: 600;" } });
            info.createEl("div", { text: `${folder}/`, cls: "setting-item-description" });

            new obsidian_1.ButtonComponent(row)
                .setButtonText(`Move to ${folder}`)
                .setCta()
                .onClick(async () => {
                    this._hasChosen = true;
                    this.close();
                    if (typeof this.onChoose === "function") {
                        await this.onChoose(folder, profile);
                    }
                });
        }

        const buttons = contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons)
            .setButtonText("Leave as is")
            .onClick(async () => {
                this._hasChosen = true;
                this.close();
                if (typeof this.onChoose === "function") {
                    await this.onChoose(null, null);
                }
            });
    }
    onClose() {
        super.onClose();
        if (!this._hasChosen && typeof this.onChoose === "function") {
            this._hasChosen = true;
            void this.onChoose(null, null);
        }
    }
}

class TaxoExcludeFoldersModal extends TaxoModal {
    constructor(app, plugin, profile, onDone) {
        super(app, "Excluded folders", `Profile: ${profile.name}`);
        this.plugin = plugin;
        this.profile = profile;
        this.onDone = onDone;
        
        const specific = profile.excludedFolders || [];
        const universal = plugin.settings.universalExcludedFolders || [];
        const map = new Map();
        
        for (const f of specific) map.set(f, { path: f, isUniversal: false, isSpecific: true });
        for (const f of universal) {
            if (map.has(f)) map.get(f).isUniversal = true;
            else map.set(f, { path: f, isUniversal: true, isSpecific: false });
        }
        
        this.items = Array.from(map.values());
    }
    onOpen() {
        super.onOpen();
        this.render();
    }
    render() {
        this.contentEl.empty();
        this.contentEl.addClass("taxoflow-modal");
        
        const heading = this.contentEl.createEl("h2", { text: "Excluded folders", cls: "taxoflow-modal-drag-handle" });
        this.contentEl.createEl("p", { text: "Notes located in these folders (or their nested subfolders) will bypass auto-routing. You can exclude them for this profile only, or universally across all profiles.", cls: "setting-item-description" });
        
        const list = this.contentEl.createDiv({ cls: "taxoflow-rule-parent-list" });
        list.style.display = "flex";
        list.style.flexDirection = "column";
        
        if (this.items.length === 0) {
            list.createEl("p", { text: "No folders are currently excluded.", cls: "setting-item-description" });
        } else {
            for (let i = 0; i < this.items.length; i++) {
                const item = this.items[i];
                const setting = new obsidian_1.Setting(list).addText(t => t.setValue(item.path).setPlaceholder("e.g. System/Templates").onChange(val => item.path = val));
                
                setting.addToggle(toggle => {
                    toggle.setValue(item.isUniversal)
                        .setTooltip(item.isUniversal ? "Universal (applies to all profiles)" : "Profile specific")
                        .onChange(val => {
                            item.isUniversal = val;
                            if (!val && !item.isSpecific) item.isSpecific = true;
                            toggle.setTooltip(val ? "Universal (applies to all profiles)" : "Profile specific");
                        });
                    
                    const label = document.createElement("span");
                    label.textContent = "Global";
                    label.style.marginInline = "6px";
                    label.style.color = "var(--text-muted)";
                    label.style.fontSize = "var(--font-ui-small)";
                    toggle.toggleEl.parentElement.insertBefore(label, toggle.toggleEl);
                });

                setting.addButton(b => b.setIcon("trash-2").setTooltip("Remove folder").onClick(() => {
                    this.items.splice(i, 1);
                    this.render();
                }));
                setting.settingEl.style.border = "none";
                setting.settingEl.style.padding = "0";
                setting.settingEl.style.gap = "8px";
            }
        }
        
        new obsidian_1.Setting(this.contentEl).addButton(b => b.setButtonText("Add folder path").onClick(() => {
            this.items.push({ path: "", isUniversal: false, isSpecific: true });
            this.render();
        }));
        
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        new obsidian_1.ButtonComponent(buttons).setButtonText("Save").setCta().onClick(async () => {
            const newSpecific = [];
            const newUniversal = [];
            
            for (const item of this.items) {
                const clean = normalizeFolderPath(item.path);
                if (!clean) continue;
                if (item.isUniversal) newUniversal.push(clean);
                if (item.isSpecific) newSpecific.push(clean);
            }
            
            this.profile.excludedFolders = uniqueStrings(newSpecific);
            this.plugin.settings.universalExcludedFolders = uniqueStrings(newUniversal);
            
            try {
                await this.plugin.saveSettings();
                this.close();
                this.onDone();
            } catch (error) {
                new obsidian_1.Notice(`Failed to save settings: ${error?.message || error}`);
            }
        });
        
        this.installModalDrag(heading);
    }
}

class TaxoMoveExistingNotesConfirmModal extends TaxoModal {
    constructor(app, plugin, profile, nonConflictFiles, conflictFiles, onProceed) {
        super(app, "Move existing notes to folder", `Scan results for profile "${profile.name}"`);
        this.plugin = plugin;
        this.profile = profile;
        this.onProceed = onProceed;
        this.targetFolder = normalizeFolderPath(profile.defaultFolder);

        this.items = [];
        
        for (const item of conflictFiles) {
            this.items.push({
                file: item.file,
                status: "conflict",
                availableProfiles: item.resolution.profiles,
                targetFolder: null,
                selected: false, 
                visible: true
            });
        }
        for (const file of nonConflictFiles) {
            this.items.push({
                file: file,
                status: "single",
                targetFolder: this.targetFolder,
                selected: true,
                visible: true
            });
        }
        this.searchQuery = "";
    }

    onOpen() {
        super.onOpen();
        this.render();
    }

    render() {
        this.contentEl.empty();
        this.contentEl.addClass("taxoflow-modal");
        
        const heading = this.contentEl.createEl("h2", { text: "Move existing notes to folder", cls: "taxoflow-modal-drag-handle" });
        this.contentEl.createEl("p", { text: `Scan results for profile "${this.profile.name}". Select the notes you want to move.`, cls: "setting-item-description" });

        const searchSetting = new obsidian_1.Setting(this.contentEl).addSearch(search => {
            search.setPlaceholder("Search notes by path...").setValue(this.searchQuery).onChange(val => {
                this.searchQuery = val.trim().toLocaleLowerCase();
                this.filterItems();
                this.renderList();
            });
        });
        searchSetting.settingEl.style.border = "none";
        searchSetting.settingEl.style.padding = "0 0 12px 0";

        this.bulkToggleContainer = this.contentEl.createDiv({ cls: "taxoflow-bulk-toggle" });
        this.bulkToggleContainer.style.display = "flex";
        this.bulkToggleContainer.style.alignItems = "center";
        this.bulkToggleContainer.style.gap = "8px";
        this.bulkToggleContainer.style.padding = "0 0 8px 4px";
        this.bulkToggleContainer.style.borderBottom = "1px solid var(--background-modifier-border)";

        this.bulkToggleCheckbox = this.bulkToggleContainer.createEl("input", { attr: { type: "checkbox" } });
        this.bulkToggleLabel = this.bulkToggleContainer.createEl("span", { text: "Select all visible" });
        
        this.bulkToggleCheckbox.addEventListener("change", (e) => {
            const checked = e.target.checked;
            for (const item of this.items) {
                if (item.visible) {
                    if (item.status === "single" || item.targetFolder !== null) {
                        item.selected = checked;
                    }
                }
            }
            this.renderList();
        });

        this.listContainer = this.contentEl.createDiv({ cls: "taxoflow-delete-note-list" });
        this.listContainer.style.maxHeight = "40vh";
        this.listContainer.style.marginTop = "8px";

        this.buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        
        this.renderList();
        this.installModalDrag(heading);
    }

    filterItems() {
        for (const item of this.items) {
            if (!this.searchQuery) {
                item.visible = true;
            } else {
                item.visible = item.file.path.toLocaleLowerCase().includes(this.searchQuery);
            }
        }
    }

    renderList() {
        this.listContainer.empty();
        let visibleCount = 0;
        let selectedVisibleCount = 0;
        let selectableVisible = 0;

        for (const item of this.items) {
            if (!item.visible) continue;
            
            visibleCount++;
            const canSelect = item.status === "single" || item.targetFolder !== null;
            if (canSelect) selectableVisible++;
            if (item.selected && item.visible) selectedVisibleCount++;

            const row = this.listContainer.createDiv({ cls: "taxoflow-delete-note-row" });
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.gap = "12px";

            const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
            checkbox.checked = item.selected;
            checkbox.disabled = !canSelect;

            const info = row.createDiv();
            info.style.flex = "1";
            info.style.minWidth = "0"; 
            
            info.createEl("div", { text: item.file.path, attr: { style: "word-break: break-all; font-weight: 500;" } });
            
            if (item.status === "single") {
                info.createEl("div", { text: `Target: ${item.targetFolder}/`, cls: "setting-item-description" });
            } else {
                const resolveContainer = info.createDiv();
                resolveContainer.style.marginTop = "6px";
                resolveContainer.createEl("span", { text: "Conflict: ", attr: { style: "color: var(--text-error); font-size: var(--font-ui-smaller);" } });
                
                const select = resolveContainer.createEl("select", { cls: "dropdown" });
                select.style.fontSize = "var(--font-ui-smaller)";
                select.createEl("option", { value: "", text: "Choose a folder to resolve..." });
                
                for (const p of item.availableProfiles) {
                    const folder = normalizeFolderPath(p.defaultFolder);
                    const opt = select.createEl("option", { value: folder, text: `${folder}/ (${p.name})` });
                    if (item.targetFolder === folder) opt.selected = true;
                }

                select.addEventListener("change", (e) => {
                    item.targetFolder = e.target.value || null;
                    if (item.targetFolder) {
                        item.selected = true;
                    } else {
                        item.selected = false;
                    }
                    this.renderList();
                });
            }

            checkbox.addEventListener("change", (e) => {
                item.selected = e.target.checked;
                this.updateFooter();
            });
        }

        if (visibleCount === 0) {
            this.listContainer.createEl("div", { text: "No notes match your search.", cls: "setting-item-description", attr: { style: "padding: 16px;" } });
        }

        if (selectableVisible > 0) {
            this.bulkToggleCheckbox.disabled = false;
            this.bulkToggleCheckbox.checked = (selectedVisibleCount === selectableVisible);
            this.bulkToggleCheckbox.indeterminate = (selectedVisibleCount > 0 && selectedVisibleCount < selectableVisible);
        } else {
            this.bulkToggleCheckbox.disabled = true;
            this.bulkToggleCheckbox.checked = false;
            this.bulkToggleCheckbox.indeterminate = false;
        }

        this.updateFooter();
    }

    updateFooter() {
        this.buttons.empty();
        let totalSelected = 0;
        
        for (const item of this.items) {
            if (item.selected) totalSelected++;
        }

        new obsidian_1.ButtonComponent(this.buttons).setButtonText("Cancel").onClick(() => this.close());
        
        const cta = new obsidian_1.ButtonComponent(this.buttons)
            .setButtonText(totalSelected > 0 ? `Move ${totalSelected} note(s)` : "Move notes")
            .setCta()
            .onClick(async () => {
                this.close();
                if (typeof this.onProceed === "function") {
                    const toMove = this.items.filter(i => i.selected && i.targetFolder);
                    await this.onProceed(toMove);
                }
            });
            
        cta.setDisabled(totalSelected === 0);
    }
}

class TaxoDeleteSelectorAndDataModal extends TaxoModal {
    constructor(app, plugin, profile, selector, onDone) {
        super(app, "Delete selector and note data?", "This is irreversible within the plugin. Nothing is deleted until you confirm after reviewing the exact configuration and note values below.");
        this.plugin = plugin; this.profile = profile; this.selector = selector; this.onDone = onDone;
        this.propertyKeys = this.plugin.getPropertyKeysForSelector(profile, selector);
        this.occurrences = []; this.isScanning = false; this.refreshRequired = false;
    }
    async onOpen() {
        super.onOpen();
        this.summaryEl = this.contentEl.createDiv({ cls: "taxoflow-delete-summary" });
        this.dependencyEl = this.contentEl.createDiv({ cls: "taxoflow-delete-warning" });
        this.previewEl = this.contentEl.createDiv({ cls: "taxoflow-delete-preview" });
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        this.confirmButton = new obsidian_1.ButtonComponent(buttons).setButtonText("Delete selector and property data").setWarning().onClick(() => this.confirmDelete());
        this.confirmButton.setDisabled(true);
        await this.refreshPreview(false);
    }
    getDependentSelectors() { return this.plugin.getSelectorDependents(this.profile, this.selector.name); }
    async scanAllLinkedKeys() {
        const occurrences = [];
        for (const key of this.propertyKeys) {
            const rows = await this.plugin.scanPropertyOccurrences(key, { forceRead: true });
            for (const row of rows) occurrences.push({ ...row, key });
        }
        occurrences.sort((a, b) => a.key.localeCompare(b.key) || a.path.localeCompare(b.path));
        return { occurrences };
    }
    async refreshPreview(changedDuringConfirmation) {
        this.isScanning = true;
        this.confirmButton?.setDisabled(true);
        this.summaryEl.setText("Scanning Markdown notes for the configured selector key…");
        this.previewEl.empty();
        this.dependencyEl.empty();
        this.propertyKeys = this.plugin.getPropertyKeysForSelector(this.profile, this.selector);
        let scan;
        try {
            scan = await this.scanAllLinkedKeys();
            this.scanError = null;
        } catch (error) {
            this.scanError = error;
            this.occurrences = [];
            this.snapshot = "";
            this.summaryEl.empty();
            this.summaryEl.createEl("h3", { text: "Deletion preview unavailable" });
            this.summaryEl.createEl("p", { text: `The vault could not be scanned completely: ${error?.message || error}. Deletion is blocked to protect unseen data.` });
            this.dependencyEl.empty(); this.previewEl.empty();
            this.previewEl.createEl("p", { text: "Resolve the scan error and reopen this confirmation. No note data or configuration has been changed." });
            this.isScanning = false;
            this.confirmButton?.setDisabled(true);
            return;
        }
        this.occurrences = scan.occurrences;
        this.snapshot = JSON.stringify(this.occurrences.map(item => [item.key, item.path, item.serializedValue]).sort((a,b) => `${a[0]}\u0000${a[1]}`.localeCompare(`${b[0]}\u0000${b[1]}`)));
        const selectorConfig = this.plugin.getConfigSummaryForSelector(this.profile, this.selector);
        this.summaryEl.empty();
        this.summaryEl.createEl("h3", { text: "What will be deleted" });
        this.summaryEl.createEl("p", { text: `Profile: ${this.profile.name} (${this.profile.namespace})` });
        this.summaryEl.createEl("p", { text: `Selector property: ${this.selector.name}` });
        this.summaryEl.createEl("p", { text: `Exact property key to delete from notes: ${this.selector.name}. No other property keys will be changed.` });
        this.summaryEl.createEl("p", { text: `Configuration: the selector definition, label, static options, dependency rules, and context-specific custom options will be removed from the plugin's data.json.` });
        this.summaryEl.createEl("p", { text: `Markdown scope: all matching properties in all Markdown notes in the vault (${this.occurrences.length} property occurrence(s) across ${new Set(this.occurrences.map(item => item.path)).size} note(s)). Exact keys and stored values are listed below. Other properties in those notes will be preserved.` });
        const configDetails = this.summaryEl.createEl("details", { cls: "taxoflow-delete-details" });
        configDetails.createEl("summary", { text: "Show exact selector configuration to be removed" });
        configDetails.createEl("pre", { text: JSON.stringify({ ...selectorConfig, notePropertyKeysToDelete: this.propertyKeys, noteDataDeleted: true, scope: "all Markdown notes in the vault" }, null, 2) });
        this.previewEl.createEl("h3", { text: `Exact note data (${this.occurrences.length} matching property occurrence(s))` });
        if (!this.occurrences.length) this.previewEl.createEl("p", { text: "No matching frontmatter properties currently exist in Markdown notes. The selector configuration will still be removed if confirmed." });
        const values = this.previewEl.createDiv({ cls: "taxoflow-delete-note-list" });
        for (const item of this.occurrences) {
            const row = values.createDiv({ cls: "taxoflow-delete-note-row" });
            row.createEl("code", { text: `${item.path} — ${item.key}` });
            row.createEl("pre", { text: JSON.stringify(item.value, null, 2) ?? "undefined" });
        }
        if (changedDuringConfirmation) {
            const note = this.previewEl.createDiv({ cls: "taxoflow-delete-warning" });
            note.createEl("strong", { text: "The vault changed since the previous preview." });
            note.createEl("p", { text: "Review the refreshed list above and press the delete button again to confirm this new snapshot." });
        }
        const dependents = this.getDependentSelectors();
        if (dependents.length) {
            this.dependencyEl.createEl("strong", { text: "Deletion is blocked to protect dependent selectors." });
            this.dependencyEl.createEl("p", { text: `The following selectors depend on or reference this property: ${dependents.map(s => s.name).join(", ")}. Reconfigure these relationships first. No data or configuration will be deleted while these dependencies exist.` });
        }
        this.isScanning = false;
        this.confirmButton.setDisabled(dependents.length > 0);
    }
    async confirmDelete() {
        if (this.isScanning || this.scanError || this.getDependentSelectors().length) return;
        this.confirmButton.setDisabled(true);
        let fresh;
        try { fresh = await this.scanAllLinkedKeys(); }
        catch (error) { this.scanError = error; await this.refreshPreview(true); return; }
        const freshSnapshot = JSON.stringify(fresh.occurrences.map(item => [item.key, item.path, item.serializedValue]).sort((a,b) => `${a[0]}\u0000${a[1]}`.localeCompare(`${b[0]}\u0000${b[1]}`)));
        if (freshSnapshot !== this.snapshot) {
            await this.refreshPreview(true);
            return;
        }
        try {
            const result = await this.plugin.deleteSelectorAndPropertyData(this.profile, this.selector, this.occurrences);
            if (result.configurationDeleted) {
                this.close();
                new obsidian_1.Notice(`Deleted selector configuration and removed ${result.deleted} matching property value(s) from the vault.`);
                this.onDone();
            } else {

                await this.refreshPreview(true);
                const outcome = this.previewEl.createDiv({ cls: "taxoflow-delete-warning" });
                outcome.createEl("strong", { text: "Deletion did not complete; the selector configuration was preserved." });
                if (result.conflicts.length) outcome.createEl("p", { text: `Files that changed during deletion: ${result.conflicts.join(", ")}` });
                if (result.errors.length) outcome.createEl("p", { text: `Write errors: ${result.errors.map(item => `${item.path}: ${item.error?.message || item.error}`).join("; ")}` });
                if (result.rollbackErrors.length) outcome.createEl("p", { text: `Rollback errors requiring manual review: ${result.rollbackErrors.map(item => `${item.path}: ${item.error?.message || item.error}`).join("; ")}` });
                if (result.issues?.length) outcome.createEl("p", { text: result.issues.join("; ") });
                new obsidian_1.Notice("Deletion did not complete. Review the refreshed preview and any rollback errors before trying again.", 12000);
            }
        } catch (error) {
            console.error("TaxoFlow Properties: selector/data deletion failed", error);
            new obsidian_1.Notice(error?.message || "Deletion failed; the selector configuration was preserved.");
            this.confirmButton.setDisabled(false);
        }
    }
}

class TaxoValidationModal extends TaxoModal {
    constructor(app, plugin) { super(app, "Validate TaxoFlow Properties configuration", "Checks profile namespaces, selector references, dependency cycles, option lists, conflicting rules, and selector defaults. No files or note properties are changed."); this.plugin = plugin; }
    onOpen() {
        super.onOpen();
        const issues = this.plugin.validateConfiguration();
        const summary = this.contentEl.createEl("p", { text: issues.length ? `${issues.length} issue(s) found.` : "No configuration issues were found." });
        summary.addClass(issues.length ? "taxoflow-validation-summary-warning" : "taxoflow-validation-summary-ok");
        const list = this.contentEl.createDiv({ cls: "taxoflow-validation-list" });
        for (const issue of issues) {
            const row = list.createDiv({ cls: `taxoflow-validation-item taxoflow-validation-${issue.severity}` });
            row.createEl("strong", { text: issue.severity.toUpperCase() });
            row.createSpan({ text: ` — ${issue.message}` });
        }
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new obsidian_1.ButtonComponent(buttons).setButtonText("Close").setCta().onClick(() => this.close());
    }
}

class TaxoFlowPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS; this.optionListCache = new Map();
        this.canonicalOptionSources = new WeakMap(); this.normalizedRulesCache = new WeakMap();
        this.preparedRulesCache = new WeakMap(); this.selectorDependenciesCache = new WeakMap(); this.dependencyOrderedSelectorsCache = null;
        this.selectorOccurrenceInventory = new Map(); this.selectorOccurrenceRowsByPath = new Map(); this.selectorOccurrenceFilesByPath = new Map();
        this.selectorOccurrenceInventoryReady = false; this.selectorOccurrenceFullScanPromise = null; this.selectorOccurrenceDirtyRefreshPromise = null;
        this.selectorOccurrenceDirtyEntries = new Map(); this.selectorOccurrenceDirtyCounter = 0; this._lastSelectorInventoryScanStats = null;
        this.boundSelectorHosts = new WeakMap(); this.selectorHostBindings = new Set(); this.selectorSuggests = new WeakMap(); this.activeSuggests = new Set();
        this.selectorWriteQueues = new Map(); this.optimisticPropertyValues = new Map(); this.reportedConflicts = new Set();
        this.selectorByKey = new Map(); this.labelByKey = new Map(); this.settingsSaveTimer = null;
        this.autoRegistrationInFlight = new Set(); this.pendingFocusSelectorKey = ""; this.settingTab = null;
        this.discoveredPropertyKeys = new Set(); this.autoRegistrationQueue = Promise.resolve();
        this.dependentReconcileQueues = new Map(); this.fileWriteQueues = new Map(); this.orphanInventoryGeneration = 0; this.orphanRefreshPaths = new Set(); this.settingsInventoryTimer = null; this.pendingPropertyMenuKey = ""; this.pendingPropertyMenuAt = 0; this.propertyTypeMenuContextKey = ""; this.propertyTypeMenuContextAt = 0; this.propertyTypeMenuContextProperty = null; this.propertyTypeMenuOptionHandler = null; this.decoratedNativeMenus = new WeakSet();
        this._movingFiles = new Set(); this._activeFolderConflictModals = new Set(); this._dismissedFolderConflicts = new Map();
        this.isApplyingSchema = false;
        this.lastKnownActiveFrontmatter = null;
    }
    async onload() {
        this._isStartingUp = true;
        window.setTimeout(() => { this._isStartingUp = false; }, 15000);

        this.registerEvent(this.app.metadataCache.on("changed", (file, data, cache) => {
            if (file !== this.app.workspace.getActiveFile()) return;
            const newFm = cache?.frontmatter || {};
            const oldFm = this.lastKnownActiveFrontmatter || {};
            
            if (!this.isApplyingSchema) {
                const evaluate = (fm, conditions, matchType) => {
                    if (!conditions || conditions.length === 0) return false;
                    const getNorm = (f, k) => (Array.isArray(f[k]) ? f[k] : [f[k]]).filter(v => v != null).map(s => String(s).toLocaleLowerCase().trim());
                    const check = (cond) => getNorm(fm, cond.key).includes(String(cond.value).toLocaleLowerCase().trim());
                    return matchType === "ANY" ? conditions.some(check) : conditions.every(check);
                };

                for (const schema of this.settings.propertySchemas || []) {
                    if (!schema.conditions || schema.conditions.length === 0) continue;
                    
                    const wasTriggered = evaluate(oldFm, schema.conditions, schema.matchType);
                    const isTriggered = evaluate(newFm, schema.conditions, schema.matchType);
                    
                    if (isTriggered && !wasTriggered) {
                        const currentKeys = Object.keys(newFm).filter(k => k !== "position");
                        const schemaKeys = new Set([
                            ...schema.conditions.map(c => c.key),
                            ...schema.properties.map(p => p.key)
                        ]);
                        
                        const hasExactSameKeys = currentKeys.length === schemaKeys.size && currentKeys.every(k => schemaKeys.has(k));
                        
                        if (!hasExactSameKeys) {
                            new TaxoSchemaApplyConfirmModal(this.app, this, schema, file).open();
                        }
                        break; 
                    }
                }
            }
            this.lastKnownActiveFrontmatter = newFm;
        }));

        this.registerEvent(this.app.metadataCache.on("changed", (file, data, cache) => {
            if (file !== this.app.workspace.getActiveFile()) return;
            const newFm = cache?.frontmatter || {};
            const oldFm = this.lastKnownActiveFrontmatter || {};
            
            if (!this.isApplyingSchema) {
                const evaluate = (fm, conditions, matchType) => {
                    if (!conditions || conditions.length === 0) return false;
                    const getNorm = (f, k) => (Array.isArray(f[k]) ? f[k] : [f[k]]).filter(v => v != null).map(s => String(s).toLocaleLowerCase().trim());
                    const check = (cond) => getNorm(fm, cond.key).includes(String(cond.value).toLocaleLowerCase().trim());
                    return matchType === "ANY" ? conditions.some(check) : conditions.every(check);
                };

                for (const schema of this.settings.propertySchemas || []) {
                    if (!schema.conditions || schema.conditions.length === 0) continue;
                    
                    const wasTriggered = evaluate(oldFm, schema.conditions, schema.matchType);
                    const isTriggered = evaluate(newFm, schema.conditions, schema.matchType);
                    
                    if (isTriggered && !wasTriggered) {
                        new TaxoSchemaApplyConfirmModal(this.app, this, schema, file).open();
                        break; 
                    }
                }
            }
            this.lastKnownActiveFrontmatter = newFm;
        }));

        await this.loadSettings();
        this.addSettingTab(new TaxoFlowSettingTab(this.app, this));
        this.observer = new MutationObserver(mutations => this.handleMutations(mutations));
        this.propertyKeyReconcileHandler = event => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || !target.matches(".metadata-property-key-input")) return;
            const property = target.closest(".metadata-property");
            if (property) window.setTimeout(() => { if (property.isConnected) this.injectDropdowns(property); }, 0);
        };
        document.addEventListener("focusout", this.propertyKeyReconcileHandler, true);
        document.addEventListener("change", this.propertyKeyReconcileHandler, true);
        this.propertyMenuLaunchHandler = event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const property = target.closest(".metadata-property");
            if (!property || target.closest(".taxoflow-modal, .taxoflow-settings")) return;
            const clickable = target.closest(".metadata-property-drag-handle, .metadata-property-drag, .metadata-property-icon, button, .clickable-icon, [role=button]");
            if (!clickable || !property.contains(clickable)) return;
            const signature = `${clickable.className || ""} ${clickable.getAttribute("aria-label") || ""} ${clickable.getAttribute("title") || ""}`.toLocaleLowerCase();
            if (!/drag|handle|menu|more|grip|property-icon/.test(signature) && !clickable.matches(".metadata-property-drag-handle, .metadata-property-drag, .metadata-property-icon")) return;
            this.pendingPropertyMenuKey = this.getPropertyKey(property); this.pendingPropertyMenuAt = Date.now();
            this.propertyTypeMenuContextKey = this.pendingPropertyMenuKey; this.propertyTypeMenuContextAt = Date.now(); this.propertyTypeMenuContextProperty = property;
            window.setTimeout(() => this.decorateOpenMenus(), 0);
        };
        document.addEventListener("pointerdown", this.propertyMenuLaunchHandler, true);
        document.addEventListener("contextmenu", this.propertyMenuLaunchHandler, true);
        document.addEventListener("click", this.propertyMenuLaunchHandler, true);
        this.propertyTypeMenuOptionHandler = event => {
            const target = event.target instanceof Element ? event.target.closest(".menu-item") : null;
            const key = this.propertyTypeMenuContextKey;
            if (!target || !key || Date.now() - this.propertyTypeMenuContextAt > 5000) return;
            const menu = target.closest(".menu");
            if (!menu) return;
            const labels = [...menu.querySelectorAll(".menu-item-title")].map(item => (item.textContent || "").trim().toLocaleLowerCase());
            if (!labels.includes("text") || !labels.includes("list")) return;
            const label = (target.querySelector(".menu-item-title")?.textContent || target.textContent || "").trim().toLocaleLowerCase();
            if (!new Set(["text", "list", "number", "checkbox", "date", "date & time", "tags", "aliases"]).has(label)) return;
            const propertyContext = this.propertyTypeMenuContextProperty;
            const refresh = () => {
                if (propertyContext?.isConnected && this.getPropertyKey(propertyContext) === key) {
                    this.injectDropdowns(propertyContext);
                } else {
                    for (const property of document.querySelectorAll(".metadata-property")) {
                        if (this.getPropertyKey(property) === key) this.injectDropdowns(property);
                    }
                }
                this.refreshOpenSuggestions(key);
            };
            for (const delay of [0, 60, 180, 360]) window.setTimeout(refresh, delay);
            this.propertyTypeMenuContextKey = "";
            this.propertyTypeMenuContextAt = 0;
            this.propertyTypeMenuContextProperty = null;
        };
        document.addEventListener("click", this.propertyTypeMenuOptionHandler, true);
        this.app.workspace.onLayoutReady(() => {
            void this.registerExistingNamespacedProperties().catch(error => console.error("TaxoFlow Properties: could not register existing namespaced properties", error)).finally(async () => {
                if (this.observer && document.body) {
                    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-property", "data-property-key", "data-property-type", "data-type"] });
                    this.injectDropdowns(document.body);
                }
                const migratedKeys = new Set(this.migratedLegacyDefaultKeys || []);
                this.migratedLegacyDefaultKeys = [];
                for (const selector of this.settings.selectors || []) {
                    if (!migratedKeys.has(selector.name) || !selector.defaultValue) continue;
                    try { await this.applyDefaultToExistingInstances(selector); }
                    catch (error) { console.error("TaxoFlow Properties: could not apply migrated default", selector.name, error); }
                }
            });
        });
        this.registerEvent(this.app.vault.on("create", file => {
            if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return;
            this.markSelectorOccurrencePathDirty(file);
            this.scheduleSettingsInventoryRefresh(false);

            window.setTimeout(() => {
                void this.applyConfiguredDefaultsForFile(file).then(() => {
                    void this.handleAutoFolderForFile(file);
                }).catch(error => console.error("TaxoFlow Properties: could not initialize defaults in new note", file.path, error));
            }, 220);
        }));
        this.registerEvent(this.app.vault.on("modify", file => {
            if (file instanceof obsidian_1.TFile && file.extension === "md") {
                this.markSelectorOccurrencePathDirty(file);
                if (this.settingTab) this.settingTab._selectorOccurrenceMap = null;
                this.scheduleSettingsInventoryRefresh(false);
                void this.reconcileDependentValuesForFile(file).catch(error => console.error("TaxoFlow Properties: dependent values could not be reconciled", file.path, error));
                window.setTimeout(() => {
                    this.reconcileOptimisticValuesForFile(file);
                    void this.registerPropertiesInModifiedNote(file);
                    void this.applyConfiguredDefaultsForFile(file).then(() => {
                        void this.handleAutoFolderForFile(file);
                    }).catch(error => console.error("TaxoFlow Properties: could not apply defaults in modified note", file.path, error));
                }, 200);
            }
        }));
        this.registerEvent(this.app.vault.on("delete", file => {
            if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return;
            this._dismissedFolderConflicts?.delete(file.path);
            this.markSelectorOccurrencePathDirty(file, true);
            if (this.settingTab) this.settingTab._selectorOccurrenceMap = null;
            this.scheduleSettingsInventoryRefresh(false);

            void this.cleanupUnusedRegistrationSuppressions().catch(error => console.error("TaxoFlow Properties: could not clean registration markers after note deletion", error));
        }));
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
            if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return;
            if (oldPath) {
                this.markSelectorOccurrencePathDirty(oldPath, null, true);
                this._dismissedFolderConflicts?.delete(oldPath);
            }
            this.markSelectorOccurrencePathDirty(file);
            if (this.settingTab) this.settingTab._selectorOccurrenceMap = null;
            this.scheduleSettingsInventoryRefresh(false);
        }));
    }
    onunload() {
        this.observer?.disconnect();
        if (this.propertyKeyReconcileHandler) {
            document.removeEventListener("focusout", this.propertyKeyReconcileHandler, true);
            document.removeEventListener("change", this.propertyKeyReconcileHandler, true);
        }
        if (this.propertyMenuLaunchHandler) {
            document.removeEventListener("pointerdown", this.propertyMenuLaunchHandler, true);
            document.removeEventListener("contextmenu", this.propertyMenuLaunchHandler, true);
            document.removeEventListener("click", this.propertyMenuLaunchHandler, true);
        }
        if (this.propertyTypeMenuOptionHandler) document.removeEventListener("click", this.propertyTypeMenuOptionHandler, true);
        if (this.settingsInventoryTimer) window.clearTimeout(this.settingsInventoryTimer);
        if (this.labelRefreshTimer) window.clearTimeout(this.labelRefreshTimer);
        if (this.settingsSaveTimer) { window.clearTimeout(this.settingsSaveTimer); this.settingsSaveTimer = null; void this.persistSettingsNow(); }
        for (const suggest of this.activeSuggests) suggest.dispose();
        this.activeSuggests.clear();
        for (const binding of [...this.selectorHostBindings]) this.unbindSelectorHost(binding.host);
        this.selectorHostBindings.clear();
        this.optimisticPropertyValues.clear();
        this._movingFiles?.clear();
        this._activeFolderConflictModals?.clear();
        this._dismissedFolderConflicts?.clear();
    }
    refreshFlatSelectors() {
        this.normalizedRulesCache = new WeakMap();
        this.preparedRulesCache = new WeakMap();
        this.selectorDependenciesCache = new WeakMap();
        this.dependencyOrderedSelectorsCache = null;
        this.canonicalOptionSources = new WeakMap();
        this.optionListCache?.clear();
        this.settings.selectors = this.settings.profiles.flatMap(p => p.selectors);
        this.selectorByKey = new Map(this.settings.selectors.map(selector => [selector.name, selector]));
        this.labelByKey = new Map();
        
        for (const profile of this.settings.profiles) {
            for (const selector of profile.selectors) if (selector.label) this.labelByKey.set(selector.name, selector.label);
        }
        
        for (const [key, label] of Object.entries(this.settings.globalPropertyLabels || {})) {
            if (label && !this.labelByKey.has(key)) this.labelByKey.set(key, label);
        }
        
        this.pruneStaleSuggestions();
        this.decorateOpenMenus();
    }
    pruneStaleSuggestions() {
        for (const binding of [...this.selectorHostBindings]) {
            const current = this.getSelector(binding.key);
            if (!current || current !== binding.selector) this.unbindSelectorHost(binding.host);
        }
        for (const suggest of [...this.activeSuggests]) {
            if (!suggest || suggest.disposed || !suggest.editor?.isConnected) { this.activeSuggests.delete(suggest); continue; }
            const current = this.getSelector(suggest.selectorKey);
            if (!current || (suggest.selectorRef && current !== suggest.selectorRef)) {
                suggest.dispose(); this.activeSuggests.delete(suggest); this.selectorSuggests.delete(suggest.editor);
            }
        }
    }
    scheduleSettingsInventoryRefresh(fullDisplay = false) {
        if (typeof window === "undefined") return;
        if (this.settingsInventoryTimer) window.clearTimeout(this.settingsInventoryTimer);
        this.settingsInventoryTimer = window.setTimeout(() => {
            this.settingsInventoryTimer = null;
            void this.scanAllSelectorOccurrences().then(map => {
                const tab = this.settingTab;
                if (!tab?.containerEl?.isConnected) return;
                tab._selectorOccurrenceMap = map;
                if (fullDisplay) tab.display();
                else tab.refreshLiveInventory(map);
            }).catch(error => {
                console.warn("TaxoFlow Properties: live settings inventory refresh failed", error);
                const tab = this.settingTab;
                if (tab?.containerEl?.isConnected && !fullDisplay) tab.renderOrphans(tab.containerEl, null, error);
            });
        }, 180);
    }
    decorateOpenMenus() {
        if (typeof document === "undefined") return;

        const labelEntries = [...this.labelByKey.entries()].filter(([, label]) => String(label || "").trim());
        for (const menu of document.querySelectorAll(".menu")) {
            if (!(menu instanceof HTMLElement)) continue;
            const key = this.pendingPropertyMenuKey;
            const withinWindow = key && Date.now() - this.pendingPropertyMenuAt < 1500;
            const menuTitleText = (menu.textContent || "").toLocaleLowerCase();
            const isPropertyMenu = Boolean(withinWindow && /change type|property|delete property|remove property|add property/i.test(menuTitleText));
            if (isPropertyMenu && !menu.querySelector(".taxoflow-open-plugin-settings-menu-item")) {
                const menuItem = menu.createDiv({ cls: "menu-item taxoflow-open-plugin-settings-menu-item" });
                const icon = menuItem.createDiv({ cls: "menu-item-icon" });
                if (typeof obsidian_1.setIcon === "function") obsidian_1.setIcon(icon, "settings"); else icon.textContent = "⚙";
                menuItem.createDiv({ cls: "menu-item-title", text: "Open TaxoFlow Properties settings" });
                const activateHover = () => {
                    menu.querySelectorAll(".menu-item").forEach(item => item.classList.remove("is-selected", "is-focused", "selected"));
                    menuItem.classList.add("is-selected");
                };
                menuItem.addEventListener("pointerenter", activateHover);
                menuItem.addEventListener("mousemove", activateHover);
                menuItem.addEventListener("focusin", activateHover);
                menuItem.addEventListener("pointerleave", () => menuItem.classList.remove("is-selected", "is-focused", "selected"));
                menuItem.addEventListener("click", event => {
                    event.preventDefault(); event.stopPropagation(); menu.remove();
                    if (this.getSelector(key)) void this.openSelectorSettings(key);
                    else { this.app?.setting?.open?.(); this.app?.setting?.openTabById?.(this.manifest.id); }
                });
                this.pendingPropertyMenuKey = ""; this.pendingPropertyMenuAt = 0;
            }
            if (!isPropertyMenu) continue;
            for (const titleEl of menu.querySelectorAll(".menu-item-title")) {
                if (!(titleEl instanceof HTMLElement) || titleEl.classList.contains("taxoflow-menu-label")) continue;
                const text = (titleEl.textContent || "").trim(); if (!text) continue;
                const match = labelEntries.find(([key]) => text === key || text === `note.${key}`);
                if (!match) continue;
                titleEl.dataset.tfLabelOriginal = text; titleEl.dataset.tfLabel = match[1]; titleEl.classList.add("taxoflow-menu-label");
            }
        }
    }
    getActiveProfile() { return this.settings.profiles.find(p => p.id === this.settings.activeProfileId) || this.settings.profiles[0] || null; }
    getProfileForSelector(selector) { return this.settings.profiles.find(p => p.selectors.includes(selector)) || null; }
    getProfileForPropertyKey(key) {
        const matches = matchingProfilesForPropertyKey(key, this.settings.profiles);
        return matches.length === 1 ? matches[0] : null;
    }
    getSelector(key) { return this.selectorByKey.get(key) || null; }
    getPropertyInfoMap() {

        const raw = this.app?.metadataCache?.getAllPropertyInfos?.();
        if (raw instanceof Map) return new Map(raw.entries());
        if (raw && typeof raw === "object") return new Map(Object.entries(raw));
        return new Map();
    }
    getVaultPropertyKeys() {

        const keys = new Set(this.getPropertyInfoMap().keys());
        for (const file of this.app?.vault?.getMarkdownFiles?.() || []) {
            const frontmatter = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter;
            if (frontmatter && typeof frontmatter === "object") for (const key of Object.keys(frontmatter)) keys.add(key);
        }
        return [...keys];
    }
    markSelectorOccurrencePathDirty(fileOrPath, maybeFile = null, deleted = false) {
        const isFile = fileOrPath && typeof fileOrPath === "object" && typeof fileOrPath.path === "string";
        const file = isFile ? fileOrPath : maybeFile;
        const path = isFile ? fileOrPath.path : String(fileOrPath || "");
        if (!path) return;
        const shouldDelete = deleted || (isFile && maybeFile === true);
        const entryDeleted = shouldDelete;
        const nextVersion = ++this.selectorOccurrenceDirtyCounter;
        this.selectorOccurrenceDirtyEntries.set(path, { version: nextVersion, file: entryDeleted ? null : (file || null), deleted: entryDeleted });
        this.orphanRefreshPaths.add(path);
        if (entryDeleted) this.selectorOccurrenceFilesByPath.delete(path);
        else if (file) this.selectorOccurrenceFilesByPath.set(path, file);
    }
    selectorOccurrenceRowsForFrontmatter(file, frontmatter) {
        if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return [];
        const rows = [];
        for (const [key, value] of Object.entries(frontmatter)) {
            if (!String(key).startsWith(TAXOFLOW_PROPERTY_PREFIX)) continue;
            rows.push({ key, file, path: file.path, value, serializedValue: stableJson(value) });
        }
        return rows;
    }
    replaceSelectorOccurrencePath(path, file, rows) {
        const oldRows = this.selectorOccurrenceRowsByPath.get(path) || [];
        for (const row of oldRows) {
            const byPath = this.selectorOccurrenceInventory.get(row.key);
            if (!byPath) continue;
            byPath.delete(path);
            if (!byPath.size) this.selectorOccurrenceInventory.delete(row.key);
        }
        const normalizedRows = (rows || []).map(row => ({ ...row, file: file || row.file, path }));
        if (normalizedRows.length) {
            this.selectorOccurrenceRowsByPath.set(path, normalizedRows);
            for (const row of normalizedRows) {
                if (!this.selectorOccurrenceInventory.has(row.key)) this.selectorOccurrenceInventory.set(row.key, new Map());
                this.selectorOccurrenceInventory.get(row.key).set(path, row);
            }
        } else this.selectorOccurrenceRowsByPath.delete(path);
        if (file) this.selectorOccurrenceFilesByPath.set(path, file);
        else this.selectorOccurrenceFilesByPath.delete(path);
    }
    snapshotSelectorOccurrenceInventory() {
        const result = new Map();
        for (const [key, byPath] of this.selectorOccurrenceInventory) {
            result.set(key, [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)));
        }
        return result;
    }
    async readSelectorOccurrenceRowsForFile(file) {
        let content;
        if (typeof this.app?.vault?.read === "function") content = await this.app.vault.read(file);
        else content = await this.app.vault.cachedRead(file);
        const text = String(content || "");
        const hasFrontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(text);
        const frontmatter = this.readFrontmatterFromRaw(text);
        if (hasFrontmatter && !frontmatter) throw new Error("Frontmatter could not be parsed; the inventory cannot safely determine whether selector properties exist.");
        return this.selectorOccurrenceRowsForFrontmatter(file, frontmatter);
    }
    async buildSelectorOccurrenceInventory() {
        const startedAt = Date.now();
        const files = this.app?.vault?.getMarkdownFiles?.() || [];
        const filesByPath = new Map(files.filter(file => file?.path && file.extension === "md").map(file => [file.path, file]));
        const rowsByPath = new Map();
        let filesRead = 0;
        for (let offset = 0; offset < files.length; offset += 16) {
            const batch = files.slice(offset, offset + 16);
            const batchResults = await Promise.all(batch.map(async file => {
                try {
                    const dirty = this.selectorOccurrenceDirtyEntries.get(file.path);
                    const cache = this.app?.metadataCache?.getFileCache?.(file);
                    let frontmatter = cache?.frontmatter;
                    if (dirty || !cache) {
                        filesRead++;
                        const content = typeof this.app?.vault?.read === "function"
                            ? await this.app.vault.read(file) : await this.app.vault.cachedRead(file);
                        const text = String(content || "");
                        const hasFrontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(text);
                        frontmatter = this.readFrontmatterFromRaw(text);
                        if (hasFrontmatter && !frontmatter) throw new Error("Frontmatter could not be parsed; the inventory cannot safely determine whether selector properties exist.");
                    }
                    return { path: file.path, rows: this.selectorOccurrenceRowsForFrontmatter(file, frontmatter), file };
                } catch (error) {
                    console.warn("TaxoFlow Properties: could not inspect note for Orphans", file.path, error);
                    throw new Error(`Could not inspect ${file.path}: ${error?.message || error}`);
                }
            }));
            for (const result of batchResults) rowsByPath.set(result.path, result.rows);
        }
        this.selectorOccurrenceFilesByPath = filesByPath;
        this.selectorOccurrenceRowsByPath = rowsByPath;
        this.selectorOccurrenceInventory = new Map();
        for (const [path, rows] of rowsByPath) {
            for (const row of rows) {
                if (!this.selectorOccurrenceInventory.has(row.key)) this.selectorOccurrenceInventory.set(row.key, new Map());
                this.selectorOccurrenceInventory.get(row.key).set(path, row);
            }
        }
        this.selectorOccurrenceInventoryReady = true;
        this._lastSelectorInventoryScanStats = { mode: "full", filesVisited: files.length, filesRead, pathsUpdated: files.length, durationMs: Date.now() - startedAt };
    }
    async refreshDirtySelectorOccurrences() {
        if (!this.selectorOccurrenceDirtyEntries.size) return;
        if (this.selectorOccurrenceDirtyRefreshPromise) return this.selectorOccurrenceDirtyRefreshPromise;
        const refresh = (async () => {
            const startedAt = Date.now();
            const batch = [...this.selectorOccurrenceDirtyEntries.entries()];
            let filesRead = 0, pathsUpdated = 0;
            for (let offset = 0; offset < batch.length; offset += 16) {
                const chunk = batch.slice(offset, offset + 16);
                const results = await Promise.all(chunk.map(async ([path, entry]) => {
                    if (entry.deleted || (!entry.file && !this.selectorOccurrenceFilesByPath.has(path))) {
                        return { path, entry, file: null, rows: [], deleted: true };
                    }
                    const file = entry.file || this.selectorOccurrenceFilesByPath.get(path);
                    if (!file || file.extension !== "md") return { path, entry, file: null, rows: [], deleted: true };
                    try {
                        filesRead++;
                        const rows = await this.readSelectorOccurrenceRowsForFile(file);
                        return { path, entry, file, rows, deleted: false };
                    } catch (error) {
                        console.warn("TaxoFlow Properties: could not refresh note inventory", path, error);
                        throw new Error(`Could not refresh ${path}: ${error?.message || error}`);
                    }
                }));
                for (const result of results) {

                    const current = this.selectorOccurrenceDirtyEntries.get(result.path);
                    if (current?.version !== result.entry.version) continue;
                    this.replaceSelectorOccurrencePath(result.path, result.file, result.rows);
                    this.selectorOccurrenceDirtyEntries.delete(result.path);
                    this.orphanRefreshPaths.delete(result.path);
                    pathsUpdated++;
                }
            }
            this._lastSelectorInventoryScanStats = { mode: "incremental", filesVisited: 0, filesRead, pathsUpdated, durationMs: Date.now() - startedAt };
        })();
        this.selectorOccurrenceDirtyRefreshPromise = refresh;
        try { await refresh; }
        finally { if (this.selectorOccurrenceDirtyRefreshPromise === refresh) this.selectorOccurrenceDirtyRefreshPromise = null; }
    }
    async scanAllSelectorOccurrences(options = {}) {
        if (options?.forceFull) this.selectorOccurrenceInventoryReady = false;
        if (!this.selectorOccurrenceInventoryReady) {
            if (!this.selectorOccurrenceFullScanPromise) {
                const fullScan = this.buildSelectorOccurrenceInventory();
                this.selectorOccurrenceFullScanPromise = fullScan;
            }
            const running = this.selectorOccurrenceFullScanPromise;
            try { await running; }
            finally { if (this.selectorOccurrenceFullScanPromise === running) this.selectorOccurrenceFullScanPromise = null; }
        } else if (!this.selectorOccurrenceDirtyEntries.size) {
            this._lastSelectorInventoryScanStats = { mode: "cached", filesVisited: 0, filesRead: 0, pathsUpdated: 0, durationMs: 0 };
        }
        await this.refreshDirtySelectorOccurrences();
        return this.snapshotSelectorOccurrenceInventory();
    }
    async scanExistingVaultPropertyKeys() {

        const keys = new Set([...this.getPropertyInfoMap().entries()]
            .filter(([, info]) => !Number.isFinite(info?.count) || info.count > 0)
            .map(([key]) => key));
        const files = this.app?.vault?.getMarkdownFiles?.() || [];
        for (const file of files) {
            try {
                const cache = this.app?.metadataCache?.getFileCache?.(file);
                let frontmatter = cache?.frontmatter;
                if (!cache || !frontmatter) {
                    const content = await this.app.vault.cachedRead(file);
                    frontmatter = this.readFrontmatterFromRaw(content);
                }
                if (frontmatter && typeof frontmatter === "object") for (const key of Object.keys(frontmatter)) keys.add(key);
            } catch (error) { console.warn("TaxoFlow Properties: could not inspect note properties", file.path, error); }
        }
        this.discoveredPropertyKeys = new Set(keys);
        await this.cleanupUnusedRegistrationSuppressions();
        return [...keys];
    }
    async scanOrphanProperties(occurrencesByKey = null) {
        occurrencesByKey = occurrencesByKey || await this.scanAllSelectorOccurrences();
        const selectors = new Set((this.settings.profiles || []).flatMap(profile => (profile.selectors || []).map(selector => selector.name)));
        const output = [];
        for (const [key, occurrences] of occurrencesByKey) {

            if (!key.startsWith(TAXOFLOW_PROPERTY_PREFIX) || !occurrences.length || selectors.has(key)) continue;
            const matches = matchingProfilesForPropertyKey(key, this.settings.profiles);
            let kind = "unmatched-profile", profile = null;
            if (matches.length === 1) { kind = "unregistered-selector"; profile = matches[0]; }
            else if (matches.length > 1) kind = "ambiguous-profile";
            output.push({ key, kind, profile, count: occurrences.length, occurrences: occurrences.sort((a, b) => a.path.localeCompare(b.path)) });
        }
        output.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
        await this.cleanupUnusedRegistrationSuppressions(new Set(occurrencesByKey.keys()), true);
        return output;
    }
    expandFolderInExplorer(folderPath) {
        const leaves = this.app.workspace?.getLeavesOfType?.("file-explorer") || [];
        if (!leaves.length || !folderPath) return;

        const parts = folderPath.split("/").filter(Boolean);
        let currentPath = "";
        
        const pathsToExpand = parts.map(part => {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            return currentPath;
        });

        for (const leaf of leaves) {
            const view = leaf.view;
            if (!view?.fileItems) continue;

            for (const path of pathsToExpand) {
                const folderItem = view.fileItems[path];
                if (folderItem && typeof folderItem.setCollapsed === "function") {
                    folderItem.setCollapsed(false);
                }
            }
        }
    }
    getOrphanProperties() {

        const infos = this.getPropertyInfoMap();
        const keys = getOrphanSelectorKeys(this.getVaultPropertyKeys(), this.settings.profiles);
        return keys.map(key => { const info = infos.get(key); return { key, count: Number.isFinite(info?.count) ? info.count : 0 }; });
    }
    async applyDefaultToExistingInstances(selector, overwriteAll = false) {
        const defaultValue = typeof selector?.defaultValue === "string" ? selector.defaultValue.trim() : "";
        if (!selector || !defaultValue) return { updated: 0, invalidContext: 0, unsupportedType: 0, errors: [] };
        if (!this.getKnownOptionsForSelector(selector).includes(defaultValue)) {
            throw new Error(`Default “${defaultValue}” is not a configured option for ${selector.name}.`);
        }
        const occurrences = await this.scanPropertyOccurrences(selector.name);
        const uniqueFiles = [...new Map(occurrences.map(item => [item.path, item.file])).entries()];
        let updated = 0, invalidContext = 0, unsupportedType = 0;
        const errors = [];
        for (const [path, file] of uniqueFiles) {
            let localUpdated = 0, localInvalidContext = 0, localUnsupportedType = 0;
            try {
                await this.processFrontMatterSerialized(file, frontmatter => {
                    if (!frontmatter || typeof frontmatter !== "object") return;
                    if (!Object.prototype.hasOwnProperty.call(frontmatter, selector.name)) return;
                    const currentVal = frontmatter[selector.name];
                    
                    if (!overwriteAll && !isEmptyPropertyValue(currentVal)) return;
                    
                    let coreType = this.getCorePropertyType(selector.name);
                    if (!coreType) coreType = Array.isArray(currentVal) ? "list" : "text";
                    
                    if (coreType !== "text" && coreType !== "list") { localUnsupportedType++; return; }
                    if (!this.getOptionsForFrontmatter(selector, frontmatter).includes(defaultValue)) { localInvalidContext++; return; }
                    
                    frontmatter[selector.name] = coreType === "list" ? [defaultValue] : defaultValue;
                    localUpdated++;
                });
                updated += localUpdated;
                invalidContext += localInvalidContext;
                unsupportedType += localUnsupportedType;
            } catch (error) {
                errors.push({ path, error });
                console.error(`TaxoFlow Properties: could not apply ${selector.name} default in ${path}`, error);
            }
        }
        if (updated) this.scheduleSettingsInventoryRefresh(false);
        return { updated, invalidContext, unsupportedType, errors };
    }
    async applyConfiguredDefaultsForFile(file) {
        if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return { updated: 0, skipped: 0 };
        let updated = 0, skipped = 0;
        const allSelectors = (this.settings.selectors && this.settings.selectors.length)
            ? this.settings.selectors
            : (this.settings.profiles || []).flatMap(p => p.selectors || []);
        const selectors = allSelectors.filter(selector => typeof selector.defaultValue === "string" && selector.defaultValue.trim())
            .slice().sort((a, b) => normalizeDependsOn(a.dependsOn).length - normalizeDependsOn(b.dependsOn).length);
        if (!selectors.length) return { updated: 0, skipped: 0 };
        await this.processFrontMatterSerialized(file, frontmatter => {
            if (!frontmatter || typeof frontmatter !== "object") return;

            for (let pass = 0; pass <= selectors.length; pass++) {
                let changed = false;
                for (const selector of selectors) {
                    if (!Object.prototype.hasOwnProperty.call(frontmatter, selector.name) || !isEmptyPropertyValue(frontmatter[selector.name])) continue;
                    let coreType = this.getCorePropertyType(selector.name);
                    if (!coreType) coreType = Array.isArray(frontmatter[selector.name]) ? "list" : "text";
                    
                    if (coreType !== "text" && coreType !== "list") { skipped++; continue; }
                    const defaultValue = selector.defaultValue.trim();
                    if (!this.getKnownOptionsForSelector(selector).includes(defaultValue) || !this.getOptionsForFrontmatter(selector, frontmatter).includes(defaultValue)) {
                        skipped++;
                        continue;
                    }
                    frontmatter[selector.name] = coreType === "list" ? [defaultValue] : defaultValue;
                    updated++; changed = true;
                }
                if (!changed) break;
            }
        });
        if (updated) this.scheduleSettingsInventoryRefresh(false);
        return { updated, skipped };
    }
    async getNoteFrontmatterKeys(file) {
        if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return new Set();
        const keys = new Set(Object.keys(this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || {}));
        try {
            const content = typeof this.app?.vault?.read === "function" ? await this.app.vault.read(file) : await this.app.vault.cachedRead(file);
            const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
            if (match && typeof obsidian_1.parseYaml === "function") {
                const frontmatter = obsidian_1.parseYaml(match[1]);
                if (frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)) {
                    for (const key of Object.keys(frontmatter)) keys.add(key);
                }
            }
        } catch (error) {
            console.warn("TaxoFlow Properties: could not inspect frontmatter keys for note", file.path, error);
        }
        return keys;
    }
    async ensureFolderExists(folderPath) {
        const parts = normalizeFolderPath(folderPath).split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const existing = this.app.vault.getAbstractFileByPath(current);
            if (!existing) {
                try {
                    await this.app.vault.createFolder(current);
                } catch (err) {
                    if (!this.app.vault.getAbstractFileByPath(current)) throw err;
                }
            }
        }
    }
    async moveNoteToFolder(file, targetFolder) {
        const cleanFolder = normalizeFolderPath(targetFolder);
        if (!cleanFolder || !(file instanceof obsidian_1.TFile) || file.extension !== "md") {
            return { success: false, reason: "invalid" };
        }
        const targetPath = `${cleanFolder}/${file.name}`;
        if (file.path === targetPath) {
            return { success: true, alreadyThere: true };
        }
        const moving = this._movingFiles || (this._movingFiles = new Set());
        if (moving.has(file.path)) {
            return { success: false, reason: "in_progress" };
        }
        await this.ensureFolderExists(cleanFolder);
        const existing = this.app.vault.getAbstractFileByPath(targetPath);
        if (existing && existing !== file) {
            new obsidian_1.Notice(`TaxoFlow: Cannot move "${file.name}" to "${cleanFolder}/" because a file with that name already exists.`);
            return { success: false, reason: "collision" };
        }
        
        const originalPath = file.path;
        moving.add(originalPath);
        
        try {
            await this.app.fileManager.renameFile(file, targetPath);
            this.expandFolderInExplorer(cleanFolder);
            return { success: true, targetPath };
        } catch (error) {
            console.error("TaxoFlow Properties: could not move note to folder", originalPath, targetPath, error);
            new obsidian_1.Notice(`TaxoFlow: Failed to move "${file.name}" to "${cleanFolder}/": ${error?.message || error}`);
            return { success: false, error };
        } finally {
            moving.delete(originalPath);
            moving.delete(file.path);
            moving.delete(targetPath);
        }
    }
    async handleAutoFolderForFile(file) {
        if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return;
        const moving = this._movingFiles || (this._movingFiles = new Set());
        if (moving.has(file.path)) return;
        const keys = await this.getNoteFrontmatterKeys(file);
        if (!keys.size) return;

        const matchingProfiles = getMatchingProfilesForFrontmatterKeys(keys, this.settings.profiles || []);
        
        const validProfiles = matchingProfiles.filter(p => !isFileInExcludedFolder(file, p.excludedFolders, this.settings.universalExcludedFolders));
        if (!validProfiles.length) return;

        const resolution = resolveTargetFolderForProfiles(validProfiles);

        if (resolution.status === "single" && resolution.folder) {
            await this.moveNoteToFolder(file, resolution.folder);
            return;
        }

        if (resolution.status === "conflict") {
            if (this._isStartingUp) return;

            const conflictKey = resolution.folders.slice().sort().join("::");
            const activeModals = this._activeFolderConflictModals || (this._activeFolderConflictModals = new Set());
            const dismissed = this._dismissedFolderConflicts || (this._dismissedFolderConflicts = new Map());
            
            if (activeModals.has(file.path)) return;
            if (dismissed.get(file.path) === conflictKey) return;

            activeModals.add(file.path);
            const modal = new TaxoFolderConflictModal(this.app, this, file, resolution.profiles, async chosenFolder => {
                activeModals.delete(file.path);
                dismissed.set(file.path, conflictKey);
                if (chosenFolder) {
                    await this.moveNoteToFolder(file, chosenFolder);
                }
            });
            modal.open();
        }
    }
    createAutoRegisteredSelector(key, profile) {
        return { name: key, label: profile.propertyLabels?.[key] || humanize(key), options: [], defaultValue: "", dependsOn: [], rules: [], customOptionsByContext: [] };
    }
    async cleanupUnusedRegistrationSuppressions(currentKeySet = null, authoritative = false) {
        const suppressed = uniqueStrings(this.settings.suppressedAutoRegistrationKeys || []);
        if (!suppressed.length) return 0;
        const retained = [];
        for (const key of suppressed) {
            if (currentKeySet && currentKeySet.has(key)) { retained.push(key); continue; }
            if (authoritative) continue;
            const occurrences = await this.scanPropertyOccurrences(key);
            if (occurrences.length) retained.push(key);
        }
        if (retained.length === suppressed.length && retained.every((key, i) => key === suppressed[i])) return 0;
        this.settings.suppressedAutoRegistrationKeys = retained;
        try { await this.persistSettingsNow(); }
        catch (error) {
            this.settings.suppressedAutoRegistrationKeys = suppressed;
            console.error("TaxoFlow Properties: could not clean expired registration markers", error);
            return 0;
        }
        return suppressed.length - retained.length;
    }
    async registerOrphanSelector(item) {
        const key = item?.key;
        if (!key || !item.profile || this.getProfileForPropertyKey(key)?.id !== item.profile.id) throw new Error("This orphan does not belong to one unambiguous profile namespace. Create or correct a profile first.");
        if (this.getSelector(key)) return false;
        const profile = item.profile;
        const selector = this.createAutoRegisteredSelector(key, profile);
        const label = profile.propertyLabels?.[key];
        const previousSuppressed = uniqueStrings(this.settings.suppressedAutoRegistrationKeys || []);
        if (label) { selector.label = label; delete profile.propertyLabels[key]; }
        profile.selectors.push(selector);
        this.settings.suppressedAutoRegistrationKeys = previousSuppressed.filter(value => value !== key);
        this.invalidateRuntimeCaches();
        try { await this.saveSettings(); }
        catch (error) { profile.selectors = profile.selectors.filter(value => value !== selector); if (label) profile.propertyLabels[key] = label; this.settings.suppressedAutoRegistrationKeys = previousSuppressed; this.invalidateRuntimeCaches(); throw error; }
        this.scheduleLabelRefresh();
        this.scheduleSettingsInventoryRefresh(true);
        return true;
    }
    async registerExistingNamespacedProperties() {
        const existing = await this.scanExistingVaultPropertyKeys();
        const known = new Set(this.settings.profiles.flatMap(profile => profile.selectors.map(selector => selector.name)));
        const additions = [];
        await this.cleanupUnusedRegistrationSuppressions();
        const suppressed = new Set(this.settings.suppressedAutoRegistrationKeys || []);
        for (const key of existing) {
            if (!String(key).startsWith(TAXOFLOW_PROPERTY_PREFIX) || known.has(key) || suppressed.has(key)) continue;
            const profile = this.getProfileForPropertyKey(key);
            if (!profile || !isValidProfilePropertyKey(key, profile)) continue;
            const selector = this.createAutoRegisteredSelector(key, profile);
            profile.selectors.push(selector); known.add(key); additions.push({ profile, selector });
        }
        if (!additions.length) return 0;
        this.invalidateRuntimeCaches();
        try { await this.persistSettingsNow(); }
        catch (error) {
            for (const { profile, selector } of additions) profile.selectors = profile.selectors.filter(item => item !== selector);
            this.invalidateRuntimeCaches();
            throw error;
        }
        return additions.length;
    }
    registerDiscoveredProperty(key, profile) {
        if (!key || this.getSelector(key) || (this.settings.suppressedAutoRegistrationKeys || []).includes(key) || this.autoRegistrationInFlight.has(key) || !isValidProfilePropertyKey(key, profile)) return null;
        this.autoRegistrationInFlight.add(key);
        this.autoRegistrationQueue = this.autoRegistrationQueue.catch(() => {}).then(async () => {
            if (this.getSelector(key) || !this.settings.profiles.includes(profile)) {
                this.autoRegistrationInFlight.delete(key);
                return;
            }
            const selector = this.createAutoRegisteredSelector(key, profile);
            profile.selectors.push(selector);
            this.invalidateRuntimeCaches();
            try {
                await this.saveSettings();
                this.autoRegistrationInFlight.delete(key);
                new TaxoNewPropertyRegistrationModal(this.app, this, profile, selector).open();
                this.scheduleLabelRefresh();
                this.scheduleSettingsInventoryRefresh(true);
            } catch (error) {
                this.autoRegistrationInFlight.delete(key);
                profile.selectors = profile.selectors.filter(item => item !== selector);
                this.invalidateRuntimeCaches();
                console.error("TaxoFlow Properties: automatic property registration failed", key, error);
                new obsidian_1.Notice(`Could not register ${key}: ${error?.message || error}`);
            }
        });
        return this.autoRegistrationQueue;
    }
    async registerPropertiesInModifiedNote(file) {
        if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return 0;
        const keys = new Set(Object.keys(this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || {}));
        try {
            const content = await this.app.vault.cachedRead(file);
            const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
            if (match && typeof obsidian_1.parseYaml === "function") {
                const frontmatter = obsidian_1.parseYaml(match[1]);
                if (frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)) for (const key of Object.keys(frontmatter)) keys.add(key);
            }
        } catch (error) { console.warn("TaxoFlow Properties: could not inspect modified note for new properties", file.path, error); }
        for (const key of keys) this.discoveredPropertyKeys.add(key);
        await this.cleanupUnusedRegistrationSuppressions(new Set(keys));
        const pending = [];
        for (const key of keys) {
            if (!String(key).startsWith(TAXOFLOW_PROPERTY_PREFIX)) continue;
            const profile = this.getProfileForPropertyKey(key);
            if (profile && isValidProfilePropertyKey(key, profile) && !this.getSelector(key) && !(this.settings.suppressedAutoRegistrationKeys || []).includes(key)) {
                const job = this.registerDiscoveredProperty(key, profile);
                if (job) pending.push(job);
            }
        }
        await Promise.all(pending);
        return pending.length;
    }
    readFrontmatterFromRaw(content) {
        const match = String(content || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!match || typeof obsidian_1.parseYaml !== "function") return null;
        try { const parsed = obsidian_1.parseYaml(match[1]); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
        catch (_) { return null; }
    }
    getDependencyOrderedSelectors() {
        if (this.dependencyOrderedSelectorsCache) return this.dependencyOrderedSelectorsCache;
        const all = (this.settings.profiles || []).flatMap(profile => profile.selectors || []);
        const indexByKey = new Map();
        all.forEach((selector, index) => { if (!indexByKey.has(selector.name)) indexByKey.set(selector.name, index); });
        const indegree = new Map(all.map(selector => [selector, 0]));
        const children = new Map(all.map(selector => [selector, []]));
        for (const selector of all) {
            for (const dep of this.getSelectorDependencies(selector)) {
                const parentIndex = indexByKey.get(dep);
                if (parentIndex == null) continue;
                const parent = all[parentIndex];
                indegree.set(selector, (indegree.get(selector) || 0) + 1);
                children.get(parent).push(selector);
            }
        }
        const queue = all.filter(selector => indegree.get(selector) === 0);
        const ordered = [];

        for (let head = 0; head < queue.length; head++) {
            const selector = queue[head]; ordered.push(selector);
            for (const child of children.get(selector) || []) {
                const next = indegree.get(child) - 1; indegree.set(child, next);
                if (next === 0) queue.push(child);
            }
        }
        const hasCycle = ordered.length !== all.length;
        if (hasCycle) {
            const included = new Set(ordered);
            for (const selector of all) if (!included.has(selector)) ordered.push(selector);
        }
        const result = { selectors: ordered.filter(selector => this.getSelectorDependencies(selector).length > 0), hasCycle };
        this.dependencyOrderedSelectorsCache = result;
        return result;
    }
    computeDependentValueChanges(frontmatter) {
        const working = { ...frontmatter };
        for (const [key, value] of Object.entries(working)) if (Array.isArray(value)) working[key] = [...value];
        const order = this.getDependencyOrderedSelectors();
        const selectors = order.selectors;
        const changes = new Map();

        const maxPasses = order.hasCycle ? selectors.length + 1 : 1;
        for (let pass = 0; pass < maxPasses; pass++) {
            let changed = false;
            for (const selector of selectors) {
                const key = selector.name;
                if (!Object.prototype.hasOwnProperty.call(working, key)) continue;
                const currentRaw = working[key];
                const currentValues = valueToArray(currentRaw);
                if (!currentValues.length) continue;
                const allowed = new Set(this.getOptionsForFrontmatter(selector, working));
                const known = new Set(this.getKnownOptionsForSelector(selector));
                const coreType = this.getCorePropertyType(key);
                const isList = coreType ? coreType === "list" : Array.isArray(currentRaw);
                let nextValue = currentRaw;
                if (isList) {
                    const filtered = currentValues.filter(value => !known.has(value) || allowed.has(value));
                    if (filtered.length !== currentValues.length) nextValue = filtered;
                } else {
                    const scalar = typeof currentRaw === "string" ? currentRaw : currentValues[0];
                    if (known.has(scalar) && !allowed.has(scalar)) nextValue = "";
                }
                if (stableJson(nextValue) !== stableJson(currentRaw)) {
                    working[key] = Array.isArray(nextValue) ? [...nextValue] : nextValue;
                    changes.set(key, working[key]); changed = true;
                }
            }
            if (!changed) break;
        }
        return [...changes.entries()].map(([key, value]) => ({ key, value }));
    }
    clearOptimisticPropertyDisplay(file, key, expectedToken = null) {
        if (typeof document === "undefined") return;
        document.querySelectorAll(".metadata-property").forEach(property => {
            if (this.getPropertyKey(property) !== key) return;
            let owningFile = null;
            try { owningFile = this.getFileFromElement(property); } catch (_) { owningFile = null; }
            if (!(owningFile instanceof obsidian_1.TFile) || owningFile.path !== file.path) return;
            const container = property.querySelector(".metadata-property-value");
            if (!container) return;
            if (expectedToken && container.dataset.tfOptimisticToken !== expectedToken) return;
            delete container.dataset.tfOptimisticDisplay;
            delete container.dataset.tfOptimisticToken;
        });
    }
    updateVisibleOptimisticProperty(file, key, value, optimistic = true, expectedToken = null) {
        if (typeof document === "undefined") return;
        const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const mapKey = this.optimisticValueKey(file, key);
        const entry = this.optimisticPropertyValues.get(mapKey);
        document.querySelectorAll(".metadata-property").forEach(property => {
            if (this.getPropertyKey(property) !== key) return;
            let owningFile = null;
            try { owningFile = this.getFileFromElement(property); } catch (_) { owningFile = null; }
            if (!(owningFile instanceof obsidian_1.TFile) || owningFile.path !== file.path) return;
            const container = property.querySelector(".metadata-property-value");
            if (!container) return;
            const editor = container.querySelector("input:not([type=checkbox]), textarea, [contenteditable=true]");
            if (editor && document.activeElement === editor) {
                if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) editor.value = Array.isArray(value) ? value.join(", ") : String(value ?? "");
                else editor.textContent = Array.isArray(value) ? value.join(", ") : String(value ?? "");
            } else if (optimistic) {
                container.dataset.tfOptimisticDisplay = Array.isArray(value) ? value.join(", ") : String(value ?? "");
                container.dataset.tfOptimisticToken = token;
                if (entry) entry.displayToken = token;
            } else {

                if (expectedToken && container.dataset.tfOptimisticToken !== expectedToken) return;

                delete container.dataset.tfOptimisticDisplay;
                delete container.dataset.tfOptimisticToken;
            }
        });
        this.refreshOpenSuggestions(key);
    }
    async processFrontMatterSerialized(file, mutator) {

        const path = file?.path;
        if (!path) throw new Error("Cannot serialize a frontmatter write without a file path.");
        const previous = this.fileWriteQueues.get(path) || Promise.resolve();
        const queued = previous.catch(() => undefined).then(() => this.app.fileManager.processFrontMatter(file, mutator));
        this.fileWriteQueues.set(path, queued);
        try { return await queued; }
        finally { if (this.fileWriteQueues.get(path) === queued) this.fileWriteQueues.delete(path); }
    }
    async reconcileDependentValuesForFile(file) {
        if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") return { changed: 0 };
        const inFlight = this.dependentReconcileQueues.get(file.path);
        if (inFlight) return inFlight;
        const job = (async () => {
            let frontmatter = null;
            try { frontmatter = this.readFrontmatterFromRaw(await this.app.vault.cachedRead(file)); }
            catch (error) { console.warn("TaxoFlow Properties: could not read note for dependency reconciliation", file.path, error); return { changed: 0, errors: 1 }; }
            if (!frontmatter) return { changed: 0, errors: 0 };
            const predicted = this.computeDependentValueChanges(frontmatter);
            if (!predicted.length) return { changed: 0, errors: 0 };
            const optimisticEntries = new Map();
            for (const change of predicted) {
                optimisticEntries.set(change.key, this.setOptimisticPropertyValue(file, change.key, change.value));
                this.updateVisibleOptimisticProperty(file, change.key, change.value);
            }
            let applied = 0;
            const queuedKey = `${file.path}\u0000__dependent-reconcile__`;
            const previous = this.selectorWriteQueues.get(queuedKey) || Promise.resolve();
            const queued = previous.catch(() => undefined).then(async () => {
                await this.processFrontMatterSerialized(file, fm => {
                    if (!fm || typeof fm !== "object") return;
                    const changes = this.computeDependentValueChanges(fm);
                    for (const change of changes) {
                        fm[change.key] = Array.isArray(change.value) ? [...change.value] : change.value;
                        applied++;
                        const entry = optimisticEntries.get(change.key);
                        if (entry) {
                            const mapKey = this.optimisticValueKey(file, change.key);
                            if (this.optimisticPropertyValues.get(mapKey) === entry) { entry.value = Array.isArray(change.value) ? [...change.value] : change.value; entry.at = Date.now(); }
                        }
                    }
                });
            });
            this.selectorWriteQueues.set(queuedKey, queued);
            try {
                await queued;
                this.reconcileOptimisticValuesForFile(file);
                if (applied > 0) this.markSelectorOccurrencePathDirty(file);
                for (const change of predicted) this.refreshOpenSuggestions(change.key);
                return { changed: applied, errors: 0 };
            } catch (error) {
                for (const change of predicted) {
                    this.clearOptimisticPropertyValue(file, change.key, optimisticEntries.get(change.key));
                    this.updateVisibleOptimisticProperty(file, change.key, this.app.metadataCache.getFileCache(file)?.frontmatter?.[change.key] ?? "", false, optimisticEntries.get(change.key)?.displayToken || null);
                }
                console.error(`TaxoFlow Properties: failed to reconcile dependent properties in ${file.path}`, error);
                return { changed: 0, errors: 1, error };
            } finally {
                if (this.selectorWriteQueues.get(queuedKey) === queued) this.selectorWriteQueues.delete(queuedKey);
            }
        })();
        this.dependentReconcileQueues.set(file.path, job);
        try { return await job; } finally { if (this.dependentReconcileQueues.get(file.path) === job) this.dependentReconcileQueues.delete(file.path); }
    }
    async removeOrphanOccurrence(key, occurrence) {
        const file = occurrence?.file || this.app.vault.getAbstractFileByPath(occurrence?.path || "");
        if (!(file instanceof obsidian_1.TFile)) throw new Error(`Note not found: ${occurrence?.path || "unknown path"}`);
        let outcome = "missing";
        await this.processFrontMatterSerialized(file, fm => {
            if (!Object.prototype.hasOwnProperty.call(fm, key)) { outcome = "missing"; return; }
            if (stableJson(fm[key]) !== occurrence.serializedValue) { outcome = "conflict"; return; }
            delete fm[key]; outcome = "deleted";
        });
        if (outcome === "conflict") throw new Error(`The value of ${key} in ${file.path} changed after the preview. Nothing was removed from that note.`);
        if (outcome === "missing") return false;
        this.markSelectorOccurrencePathDirty(file);
        await this.cleanupUnusedRegistrationSuppressions();
        return true;
    }
    async removeOrphanOccurrences(key, occurrences) {
        const results = { deleted: [], conflicts: [], errors: [] };
        for (const item of occurrences || []) {
            const file = item.file || this.app.vault.getAbstractFileByPath(item.path);
            if (!(file instanceof obsidian_1.TFile)) { results.errors.push({ path: item.path, message: "Note no longer exists." }); continue; }
            try {
                let outcome = "missing";
                await this.processFrontMatterSerialized(file, fm => {
                    if (!Object.prototype.hasOwnProperty.call(fm, key)) { outcome = "missing"; return; }
                    if (stableJson(fm[key]) !== item.serializedValue) { outcome = "conflict"; return; }
                    delete fm[key]; outcome = "deleted";
                });
                if (outcome === "deleted") { results.deleted.push(item.path); this.markSelectorOccurrencePathDirty(file); }
                else if (outcome === "conflict") results.conflicts.push(item.path);
            } catch (error) { results.errors.push({ path: item.path, message: error?.message || String(error) }); }
        }
        await this.cleanupUnusedRegistrationSuppressions();
        if (this.settingTab) this.settingTab._selectorOccurrenceMap = null;
        this.scheduleSettingsInventoryRefresh(false);
        return results;
    }
    async renameOrphanOccurrences(key, newKey, occurrences) {
        const target = String(newKey || "").trim();
        if (!target) throw new Error("Destination property key cannot be empty.");
        if (target === key) throw new Error("Choose a different destination property key.");
        const expected = new Map((occurrences || []).map(item => [item.path, item]));
        const current = await this.scanPropertyOccurrences(key);
        if (current.length !== expected.size || current.some(item => !expected.has(item.path) || expected.get(item.path).serializedValue !== item.serializedValue)) {
            throw new Error("The orphan instances changed after the preview. Reopen the manager and review the updated paths and values before retrying.");
        }
        const destinations = await this.scanPropertyOccurrences(target);
        const destinationPaths = new Set(destinations.map(item => item.path));
        const collisions = current.filter(item => destinationPaths.has(item.path));
        if (collisions.length) throw new Error(`Rename blocked to prevent overwriting ${target}. It already exists in: ${collisions.map(item => item.path).join(", ")}.`);
        const results = { renamed: [], conflicts: [], errors: [] };
        for (const item of current) {
            const file = item.file;
            try {
                let outcome = "missing";
                await this.processFrontMatterSerialized(file, fm => {
                    if (!Object.prototype.hasOwnProperty.call(fm, key) || stableJson(fm[key]) !== item.serializedValue) { outcome = "conflict"; return; }
                    if (Object.prototype.hasOwnProperty.call(fm, target)) { outcome = "collision"; return; }
                    fm[target] = fm[key]; delete fm[key]; outcome = "renamed";
                });
                if (outcome === "renamed") { results.renamed.push(item.path); this.markSelectorOccurrencePathDirty(file); }
                else if (outcome === "conflict" || outcome === "collision") results.conflicts.push({ path: item.path, reason: outcome });
            } catch (error) { results.errors.push({ path: item.path, message: error?.message || String(error) }); }
        }
        await this.cleanupUnusedRegistrationSuppressions();
        if (this.settingTab) this.settingTab._selectorOccurrenceMap = null;
        this.scheduleSettingsInventoryRefresh(false);
        const targetProfile = this.getProfileForPropertyKey(target);
        results.unassignedSelector = results.renamed.length > 0 && target.startsWith(TAXOFLOW_PROPERTY_PREFIX) && !targetProfile;
        results.registrationCandidatePath = results.renamed.length > 0 && targetProfile && !this.getSelector(target) && !(this.settings.suppressedAutoRegistrationKeys || []).includes(target)
            ? current.find(item => results.renamed.includes(item.path))?.path || null : null;
        return results;
    }
    async openSelectorSettings(key) {
        const profile = this.getProfileForPropertyKey(key) || this.getProfileForSelector(this.getSelector(key));
        if (profile && this.settings.activeProfileId !== profile.id) {
            this.settings.activeProfileId = profile.id;
            await this.saveSettings();
        }
        this.pendingFocusSelectorKey = key;
        if (this.settingTab) this.settingTab._searchQuery = "";
        const settingsApi = this.app?.setting;
        try {
            settingsApi?.open?.();
            settingsApi?.openTabById?.(this.manifest.id);
            window.setTimeout(() => { if (this.settingTab) this.settingTab.display(); }, 150);
        } catch (error) {
            console.warn("TaxoFlow Properties: could not open its settings tab", error);
            new obsidian_1.Notice("Open Settings → Community plugins → TaxoFlow Properties to view this property.");
        }
    }
    getKnownOptionsForSelector(selector) {
        const values = [...parseOptionList(selector?.options)];
        for (const rule of selector?.rules || []) values.push(...parseOptionList(rule.options));
        for (const entry of selector?.customOptionsByContext || []) values.push(...parseOptionList(entry.options));
        return this.canonicalOptionList(values);
    }
    getLabelForKey(key) { return this.labelByKey.get(key) || ""; }
    invalidateRuntimeCaches() {
        this.refreshFlatSelectors();
    }
    refreshOpenSuggestions(selectorKey = "") {
        for (const suggest of this.activeSuggests) {
            if (!suggest || suggest.disposed || !suggest.editor?.isConnected) { this.activeSuggests.delete(suggest); continue; }
            if (!selectorKey || suggest.selectorKey === selectorKey) suggest.refresh();
        }
    }
    scheduleSettingsSave(delay = 250) {
        if (this.settingsSaveTimer) window.clearTimeout(this.settingsSaveTimer);
        this.settingsSaveTimer = window.setTimeout(() => {
            this.settingsSaveTimer = null;
            void this.persistSettingsNow().catch(error => { console.error("TaxoFlow Properties: failed to save settings", error); new obsidian_1.Notice("TaxoFlow Properties could not save settings. Check the console for details."); });
        }, delay);
    }
    async scanPropertyOccurrences(key, options = {}) {
        const occurrences = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            let frontmatter = null;
            try {
                if (options?.forceRead) {
                    const content = typeof this.app?.vault?.read === "function"
                        ? await this.app.vault.read(file)
                        : await this.app.vault.cachedRead(file);
                    const hasFrontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(String(content || ""));
                    frontmatter = this.readFrontmatterFromRaw(content);
                    if (hasFrontmatter && !frontmatter) throw new Error("Frontmatter could not be parsed; the scan cannot safely determine whether the property exists.");
                } else {
                    frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || null;

                    if (!frontmatter) {
                        const content = typeof this.app?.vault?.read === "function"
                            ? await this.app.vault.read(file)
                            : await this.app.vault.cachedRead(file);
                        const hasFrontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(String(content || ""));
                        frontmatter = this.readFrontmatterFromRaw(content);
                        if (hasFrontmatter && !frontmatter) throw new Error("Frontmatter could not be parsed; the scan cannot safely determine whether the property exists.");
                    }
                }
            } catch (error) {
                console.warn("TaxoFlow Properties: could not inspect note", file.path, error);

                throw new Error(`Could not inspect ${file.path}: ${error?.message || error}`);
            }
            if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, key)) {
                occurrences.push({ file, path: file.path, value: frontmatter[key], serializedValue: stableJson(frontmatter[key]) });
            }
        }
        return occurrences.sort((a, b) => a.path.localeCompare(b.path));
    }
    validateConfiguration() {
        const issues = [];
        const add = (severity, message) => issues.push({ severity, message });
        const profiles = this.settings.profiles || [];
        const profileIds = new Set();
        const profileNames = new Map();
        for (const profile of profiles) {
            if (profileIds.has(profile.id)) add("error", `Duplicate profile ID: ${profile.id}.`);
            profileIds.add(profile.id);
            const nameKey = String(profile.name || "").trim().toLocaleLowerCase();
            if (profileNames.has(nameKey)) add("error", `Duplicate profile name: ${profile.name} (also used by ${profileNames.get(nameKey)}).`);
            else profileNames.set(nameKey, profile.name);
            if (!isValidProfileNamespace(profile.namespace)) add("error", `Profile “${profile.name}” has an invalid namespace: ${profile.namespace}.`);
            for (const other of profiles) if (other !== profile && profile.id < other.id && namespacesOverlap(profile.namespace, other.namespace)) add("error", `Overlapping namespaces: ${profile.name} (${profile.namespace}) and ${other.name} (${other.namespace}).`);
        }
        const globalKeys = new Map();
        for (const profile of profiles) {
            const byKey = new Map(profile.selectors.map(selector => [selector.name, selector]));
            for (const selector of profile.selectors) {
                if (globalKeys.has(selector.name)) add("error", `Property key ${selector.name} is configured more than once.`);
                else globalKeys.set(selector.name, profile.name);
                if (!selector.name.startsWith(profile.namespace)) add("error", `${selector.name} is outside its profile namespace ${profile.namespace}.`);
                const deps = normalizeDependsOn(selector.dependsOn);
                if (deps.includes(selector.name)) add("error", `${selector.name} depends on itself.`);
                for (const dep of deps) if (!byKey.has(dep)) add("error", `${selector.name} references missing parent selector ${dep}.`);
                if (rulesAreCyclic(selector, profile.selectors)) add("error", `Dependency cycle detected involving ${selector.name}.`);
                const options = selector.options || [];
                if (new Set(options).size !== options.length) add("warning", `${selector.name} has duplicate independent options.`);
                const knownOptions = this.getKnownOptionsForSelector(selector);
                if (selector.defaultValue && !knownOptions.includes(selector.defaultValue)) add("error", `${selector.name} has an unavailable default value “${selector.defaultValue}”. Choose a value configured in its options or dependency rules.`);
                if (deps.length && !(selector.rules || []).length) add("error", `${selector.name} has dependencies but no rules.`);
                if (!deps.length && (selector.rules || []).length) add("error", `${selector.name} has rules but no parent dependencies.`);
                const rules = normalizeRules(selector.rules);
                for (let index = 0; index < rules.length; index++) {
                    const rule = rules[index];
                    if (!rule.options.length) add("error", `${selector.name}, rule ${index + 1}, has no options.`);
                    if (!Object.keys(rule.when || {}).length) add("error", `${selector.name}, rule ${index + 1}, has no conditions and would match too broadly.`);
                    if (ruleLogic(rule) === "or" && Object.keys(rule.when || {}).length < 2) add("warning", `${selector.name}, rule ${index + 1}, uses OR with fewer than two conditions; this is equivalent to a single condition.`);
                    if (new Set(rule.options).size !== rule.options.length) add("warning", `${selector.name}, rule ${index + 1}, has duplicate options.`);
                    for (const parentKey of Object.keys(rule.when || {})) {
                        if (!deps.includes(parentKey)) add("error", `${selector.name}, rule ${index + 1}, constrains ${parentKey}, which is not enabled as a dependency.`);
                        if (!byKey.has(parentKey)) add("error", `${selector.name}, rule ${index + 1}, references missing parent ${parentKey}.`);
                    }
                }
                for (const [left, right] of conflictingRulePairs(rules)) add("error", `${selector.name} has equally specific, overlapping rules ${left + 1} and ${right + 1} with different option lists.`);
                for (const result of findUnreachableRuleDetails(selector, profile.selectors)) {
                    if (result.status === "impossible") add("error", `${selector.name}, rule ${result.index + 1}, is unreachable because it is provably impossible under the configured dependency chain: ${result.reason}`);
                    else if (result.status === "unknown") add("warning", `${selector.name}, rule ${result.index + 1}, reachability is uncertain: ${result.reason}`);
                }
                for (const [index, entry] of (selector.customOptionsByContext || []).entries()) {
                    const contextKeys = Object.keys(entry.context || {});
                    if (contextKeys.some(key => !deps.includes(key)) || deps.some(key => !contextKeys.includes(key))) add("warning", `${selector.name}, custom-option context ${index + 1}, does not match its current dependency keys.`);
                    if (!parseOptionList(entry.options).length) add("warning", `${selector.name}, custom-option context ${index + 1}, has no options.`);
                }
            }
            for (const key of Object.keys(profile.propertyLabels || {})) if (!key.startsWith(profile.namespace)) add("warning", `Label ${key} is outside ${profile.name}'s namespace ${profile.namespace}.`);
        }
        return issues;
    }
    async deleteProfileConfiguration(profile) {
        if (!profile || !(this.settings.profiles || []).includes(profile)) throw new Error("The selected profile no longer exists.");
        const external = this.getExternalProfileDependents(profile);
        if (external.length) throw new Error(`Cannot delete profile ${profile.name}: other profiles depend on its selectors (${external.map(item => `${item.profile}:${item.key}`).join(", ")}). Reconfigure those dependencies first.`);
        const keysToUnassign = (profile.selectors || []).map(s => s.name);
        const previousProfiles = this.settings.profiles.slice();
        const previousActiveProfile = this.settings.activeProfileId;
        this.settings.profiles = this.settings.profiles.filter(item => item !== profile);
        this.settings.activeProfileId = this.settings.profiles.some(item => item.id === previousActiveProfile)
            ? previousActiveProfile : (this.settings.profiles[0]?.id || "");
        this.invalidateRuntimeCaches();
        try { await this.saveSettings(); }
        catch (error) {
            this.settings.profiles = previousProfiles;
            this.settings.activeProfileId = previousActiveProfile;
            this.invalidateRuntimeCaches();
            throw error;
        }
        this.unassignObsidianPropertyType(keysToUnassign);
        this.scheduleSettingsInventoryRefresh(true);
        return { deletedProfileId: profile.id, noteDataChanged: false };
    }
    getSelectorDependents(profile, key) {

        return this.settings.profiles.flatMap(owner => owner.selectors.filter(selector => selector.name !== key && (
            normalizeDependsOn(selector.dependsOn).includes(key) ||
            (selector.rules || []).some(rule => Object.prototype.hasOwnProperty.call(rule.when || {}, key)) ||
            (selector.customOptionsByContext || []).some(entry => Object.prototype.hasOwnProperty.call(entry.context || {}, key))
        )));
    }
    getExternalProfileDependents(profile) {
        const keys = new Set((profile.selectors || []).map(selector => selector.name));
        return this.settings.profiles.filter(owner => owner !== profile).flatMap(owner => owner.selectors.filter(selector => {
            const referenced = [...normalizeDependsOn(selector.dependsOn), ...(selector.rules || []).flatMap(rule => Object.keys(rule.when || {})), ...(selector.customOptionsByContext || []).flatMap(entry => Object.keys(entry.context || {}))];
            return referenced.some(key => keys.has(key));
        }).map(selector => ({ profile: owner.name, key: selector.name })));
    }
    getPropertyKeysForSelector(profile, selector) {

        return selector?.name ? [selector.name] : [];
    }
    getConfigSummaryForSelector(profile, selector) {
        return {
            profile: { id: profile.id, name: profile.name, namespace: profile.namespace },
            selector: {
                name: selector.name, label: selector.label || "", options: parseOptionList(selector.options),
                defaultValue: typeof selector.defaultValue === "string" ? selector.defaultValue : "", dependsOn: normalizeDependsOn(selector.dependsOn),
                rules: normalizeRules(selector.rules), customOptionsByContext: normalizeCustomContexts(selector.customOptionsByContext),
            },
            propertyLabel: profile.propertyLabels?.[selector.name] || null,
            notePropertyKeysAffected: [selector.name],
        };
    }
    async removeSelectorConfiguration(profile, selector) {
        const dependents = this.getSelectorDependents(profile, selector.name);
        if (dependents.length) throw new Error(`Cannot remove ${selector.name}: dependent selectors must be reconfigured first: ${dependents.map(item => item.name).join(", ")}.`);
        const key = selector.name;
        const previousSelectors = profile.selectors.slice();
        const previousLabels = { ...(profile.propertyLabels || {}) };
        const previousSuppressed = uniqueStrings(this.settings.suppressedAutoRegistrationKeys || []);
        const occurrences = await this.scanPropertyOccurrences(key);
        if (occurrences.length) this.settings.suppressedAutoRegistrationKeys = uniqueStrings([...previousSuppressed, key]);
        profile.selectors = profile.selectors.filter(item => item !== selector);
        if (profile.propertyLabels) delete profile.propertyLabels[key];
        this.invalidateRuntimeCaches();
        try { await this.saveSettings(); }
        catch (error) {
            profile.selectors = previousSelectors;
            profile.propertyLabels = previousLabels;
            this.settings.suppressedAutoRegistrationKeys = previousSuppressed;
            this.invalidateRuntimeCaches();
            throw error;
        }
        this.unassignObsidianPropertyType([key]);
        this.scheduleLabelRefresh();
        this.scheduleSettingsInventoryRefresh(true);
    }
    async deleteSelectorAndPropertyData(profile, selector, previewOccurrences) {
        const key = selector.name;
        const dependents = this.getSelectorDependents(profile, key);
        if (dependents.length) throw new Error(`Cannot delete ${key} until these dependent selectors are reconfigured: ${dependents.map(s => s.name).join(", ")}.`);
        const linkedKeys = new Set([key]);
        const expected = new Map(previewOccurrences.map(item => [`${item.path}\u0000${item.key || key}`, item]));
        const filesByPath = new Map();
        for (const item of previewOccurrences) {
            if (!filesByPath.has(item.path)) filesByPath.set(item.path, item.file);
        }
        const deleted = [];
        const conflicts = [];
        const errors = [];

        try {
            const freshByKey = new Map();
            for (const linkedKey of linkedKeys) freshByKey.set(linkedKey, await this.scanPropertyOccurrences(linkedKey, { forceRead: true }));
            const freshFlat = [...freshByKey.entries()].flatMap(([linkedKey, rows]) => rows.map(row => ({ ...row, key: linkedKey })));
            const normalizeSnapshot = rows => JSON.stringify(rows.map(item => [item.key || key, item.path, item.serializedValue ?? stableJson(item.value)]).sort((a,b) => `${a[0]}\u0000${a[1]}`.localeCompare(`${b[0]}\u0000${b[1]}`)));
            if (normalizeSnapshot(freshFlat) !== normalizeSnapshot(previewOccurrences)) {
                const changedPaths = [...new Set([...freshFlat.map(item => item.path), ...previewOccurrences.map(item => item.path)])].sort();
                return { deleted: 0, conflicts: changedPaths.length ? changedPaths : ["Vault occurrence snapshot changed"], errors: [], rollbackErrors: [], configurationDeleted: false, issues: ["The vault changed after the confirmation preview. No deletion was started; review a refreshed preview."] };
            }
        } catch (error) {
            return { deleted: 0, conflicts: [], errors: [{ path: "vault scan", error }], rollbackErrors: [], configurationDeleted: false, issues: ["A complete scan failed. No deletion was started."] };
        }
        for (const [path, file] of filesByPath) {
            try {
                let conflict = false;
                const toDelete = [];
                await this.processFrontMatterSerialized(file, frontmatter => {

                    for (const linkedKey of linkedKeys) {
                        const preview = expected.get(`${path}\u0000${linkedKey}`);
                        const hasCurrent = Object.prototype.hasOwnProperty.call(frontmatter, linkedKey);
                        if (Boolean(preview) !== hasCurrent || (preview && stableJson(frontmatter[linkedKey]) !== preview.serializedValue)) {
                            conflict = true;
                            continue;
                        }
                        if (preview && hasCurrent) toDelete.push({ key: linkedKey, value: preview.value, serializedValue: preview.serializedValue });
                    }
                    if (conflict) return;
                    for (const item of toDelete) {
                        delete frontmatter[item.key];
                    }
                });
                if (conflict) conflicts.push(path);
                else {
                    for (const item of toDelete) deleted.push({ path, key: item.key, value: item.value, serializedValue: item.serializedValue });
                    if (toDelete.length) this.markSelectorOccurrencePathDirty(file);
                }
            } catch (error) { errors.push({ path, error }); console.error(`TaxoFlow Properties: failed to delete linked properties for ${key} in ${path}`, error); }
        }

        if (!conflicts.length && !errors.length) {
            try {
                for (const linkedKey of linkedKeys) {
                    const remaining = await this.scanPropertyOccurrences(linkedKey, { forceRead: true });
                    if (remaining.length) conflicts.push(...remaining.map(item => item.path));
                }
                if (conflicts.length) conflicts.push("One or more linked property instances remain after deletion; configuration was preserved.");
            } catch (error) { errors.push({ path: "final vault verification", error }); }
        }
        if (conflicts.length || errors.length) {

            const rollbackErrors = [];
            for (const item of deleted) {
                const file = this.app.vault.getAbstractFileByPath(item.path);
                if (!(file instanceof obsidian_1.TFile)) { rollbackErrors.push({ path: item.path, error: new Error("File no longer exists; original value could not be restored.") }); continue; }
                try {
                    await this.processFrontMatterSerialized(file, frontmatter => {
                        if (!Object.prototype.hasOwnProperty.call(frontmatter, item.key)) frontmatter[item.key] = item.value;
                        else if (stableJson(frontmatter[item.key]) !== item.serializedValue) throw new Error(`A newer value exists for ${item.key}; rollback did not overwrite it.`);
                    });
                    this.markSelectorOccurrencePathDirty(file);
                } catch (error) { rollbackErrors.push({ path: item.path, error }); console.error(`TaxoFlow Properties: rollback failed for ${item.key} in ${item.path}`, error); }
            }
            this.scheduleSettingsInventoryRefresh(true);
            return { deleted: 0, conflicts, errors, rollbackErrors, configurationDeleted: false };
        }
        const previousSelectors = profile.selectors.slice();
        const previousLabels = { ...(profile.propertyLabels || {}) };
        const previousSuppressed = uniqueStrings(this.settings.suppressedAutoRegistrationKeys || []);
        this.settings.suppressedAutoRegistrationKeys = previousSuppressed.filter(item => !linkedKeys.has(item));
        profile.selectors = profile.selectors.filter(item => item !== selector);
        for (const linkedKey of linkedKeys) if (profile.propertyLabels) delete profile.propertyLabels[linkedKey];
        this.invalidateRuntimeCaches();
        try { await this.saveSettings(); }
        catch (configError) {
            profile.selectors = previousSelectors; profile.propertyLabels = previousLabels;
            this.settings.suppressedAutoRegistrationKeys = previousSuppressed; this.invalidateRuntimeCaches();
            const rollbackErrors = [{ path: "data.json", error: configError }];
            for (const item of deleted) {
                const file = this.app.vault.getAbstractFileByPath(item.path);
                if (!(file instanceof obsidian_1.TFile)) { rollbackErrors.push({ path: item.path, error: new Error("File no longer exists; original value could not be restored.") }); continue; }
                try {
                    await this.processFrontMatterSerialized(file, frontmatter => {
                        if (!Object.prototype.hasOwnProperty.call(frontmatter, item.key)) frontmatter[item.key] = item.value;
                        else if (stableJson(frontmatter[item.key]) !== item.serializedValue) throw new Error(`A newer value exists for ${item.key}; rollback did not overwrite it.`);
                    });
                    this.markSelectorOccurrencePathDirty(file);
                } catch (error) { rollbackErrors.push({ path: item.path, error }); console.error(`TaxoFlow Properties: rollback failed for ${item.key} in ${item.path}`, error); }
            }
            this.scheduleSettingsInventoryRefresh(true);
            return { deleted: 0, conflicts: [], errors: [{ path: "data.json", error: configError }], rollbackErrors, configurationDeleted: false };
        }
        this.unassignObsidianPropertyType([...linkedKeys]);
        this.scheduleLabelRefresh();
        this.scheduleSettingsInventoryRefresh(true);
        return { deleted: deleted.length, conflicts: [], errors: [], rollbackErrors: [], configurationDeleted: true };
    }
    scheduleLabelRefresh() {
        if (this.labelRefreshTimer) window.clearTimeout(this.labelRefreshTimer);
        this.labelRefreshTimer = window.setTimeout(() => {
            this.labelRefreshTimer = null;
            if (document.body) this.injectDropdowns(document.body);
        }, 120);
    }
    async loadSettings() {
        const saved = await this.loadData();
        const legacyDefaultKeys = (Array.isArray(saved?.profiles) ? saved.profiles : [])
            .flatMap(profile => Array.isArray(profile?.selectors) ? profile.selectors : [])
            .filter(selector => selector?.defaultFirst === true && typeof selector.name === "string")
            .map(selector => selector.name);
        const normalized = normalizeSavedSettings(saved || {});
        this.settings = normalized.settings;
        this.migratedLegacyDefaultKeys = legacyDefaultKeys;
        this.refreshFlatSelectors();
        if (normalized.unsupportedFlatSchema) {
            new obsidian_1.Notice("This data.json uses an obsolete flat-selector format that is no longer imported automatically. Back up the file and recreate its profile configuration manually; note frontmatter has not been changed.", 12000);
        }
        if (normalized.migrated) await this.persistSettingsNow();
    }
    serializeSettings() {
        return {
            schemaVersion: 4,
            activeProfileId: this.settings.activeProfileId,
            suppressedAutoRegistrationKeys: uniqueStrings(this.settings.suppressedAutoRegistrationKeys || []),
            universalExcludedFolders: uniqueStrings(this.settings.universalExcludedFolders || []),
            propertySchemas: this.settings.propertySchemas || [],
            globalPropertyLabels: this.settings.globalPropertyLabels || {},
            profiles: this.settings.profiles.map(profile => ({
                id: profile.id, name: profile.name, namespace: profile.namespace,
                selectors: profile.selectors.map(s => ({ name: s.name, label: s.label || "", options: parseOptionList(s.options), defaultValue: typeof s.defaultValue === "string" ? s.defaultValue : "", dependsOn: normalizeDependsOn(s.dependsOn), rules: normalizeRules(s.rules), customOptionsByContext: normalizeCustomContexts(s.customOptionsByContext) })),
                propertyLabels: profile.propertyLabels || {},
                defaultFolder: profile.defaultFolder || "",
                excludedFolders: profile.excludedFolders || [],
            })),
        };
    }
    async persistSettingsNow() { await this.saveData(this.serializeSettings()); }
    async saveSettings() {
        if (this.settingsSaveTimer) { window.clearTimeout(this.settingsSaveTimer); this.settingsSaveTimer = null; }
        this.invalidateRuntimeCaches();
        await this.persistSettingsNow();
    }
    getFileFromElement(el) {
        const leafEl = el.closest(".workspace-leaf"); if (!leafEl) return this.app.workspace.getActiveFile(); let targetFile = null;
        this.app.workspace.iterateAllLeaves(leaf => { if (leaf.view.containerEl.parentElement === leafEl) { const view = leaf.view; if ("file" in view && view.file instanceof obsidian_1.TFile) targetFile = view.file; } });
        return targetFile ?? this.app.workspace.getActiveFile();
    }
    getPropertyKey(propEl) { const keyEl = propEl.querySelector(".metadata-property-key-input"); return (keyEl?.value || keyEl?.textContent || "").trim(); }
    readValueElement(element) {
        const valueContainer = element.matches?.(".metadata-property") ? element.querySelector(".metadata-property-value") : element;
        if (!valueContainer) return "";
        const input = valueContainer.querySelector("input:not([type=checkbox]), textarea"); if (input) return input.value.replace(/\s+/g, " ").trim();
        const editable = valueContainer.querySelector(".metadata-input-longtext, [contenteditable=true], [contenteditable]"); if (editable) return (editable.textContent || "").replace(/\s+/g, " ").trim();
        return (valueContainer.textContent || "").replace(/\s+/g, " ").trim();
    }
    getFileForContext(context, mode) {
        return mode === "properties" ? this.getFileFromElement(context) : null;
    }
    getRawPropertyFromContext(context, key, mode, overrideKey, overrideValue) {
        if (key === overrideKey) return overrideValue;
        const file = this.getFileForContext(context, mode);
        const optimistic = file ? this.getOptimisticPropertyValue(file, key) : undefined;
        if (optimistic !== undefined) return optimistic;
        const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
        if (mode === "properties") {
            const scope = context.closest(".workspace-leaf") ?? context.closest(".metadata-container") ?? context;
            const property = Array.from(scope.querySelectorAll(".metadata-property")).find(p => this.getPropertyKey(p) === key);
            const active = property?.querySelector(".metadata-property-value input:focus, .metadata-property-value textarea:focus, .metadata-property-value [contenteditable=true]:focus");
            if (active) return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.value : active.textContent || "";
        }
        return frontmatter?.[key];
    }
    getPropertyValuesFromContext(context, key, mode, overrideKey, overrideValue) {
        return valueToArray(this.getRawPropertyFromContext(context, key, mode, overrideKey, overrideValue));
    }
    getSelectorDependencies(selector) {
        const source = selector?.dependsOn;
        const cached = selector && this.selectorDependenciesCache.get(selector);
        if (cached && cached.source === source) return cached.dependencies;
        const dependencies = normalizeDependsOn(source);
        if (selector) this.selectorDependenciesCache.set(selector, { source, dependencies });
        return dependencies;
    }
    getPreparedRules(selector) {
        const source = Array.isArray(selector?.rules) ? selector.rules : EMPTY_ARRAY;
        const cached = selector && this.preparedRulesCache.get(selector);
        if (cached && cached.source === source) return cached.rules;
        const prepared = this.getNormalizedRules(selector).map(rule => ({
            rule,
            logic: ruleLogic(rule),
            conditions: Object.entries(rule.when || {}).map(([key, allowed]) => ({ key, allowed: new Set(parseOptionList(allowed)) })).filter(condition => condition.allowed.size),
        })).filter(entry => entry.conditions.length).sort((a, b) => compareSpecificity(a.rule, b.rule));
        if (selector) this.preparedRulesCache.set(selector, { source, rules: prepared });
        return prepared;
    }
    preparedRuleMatches(prepared, values, declaredDependencies = []) {
        const matchesCondition = condition => {
            const current = valueToArray(values[condition.key]);
            return current.length > 0 && current.some(value => condition.allowed.has(value));
        };
        if (!prepared.conditions.length) return false;
        if (prepared.logic === "or") return prepared.conditions.some(matchesCondition);
        if (declaredDependencies.some(key => !valueToArray(values[key]).length)) return false;
        return prepared.conditions.every(matchesCondition);
    }
    getOptionsForDependencyValues(selector, dependencies, values) {
        if (!dependencies.length) return this.canonicalOptionList(selector.options || []);
        let best = null;
        const ties = [];
        for (const prepared of this.getPreparedRules(selector)) {
            if (!this.preparedRuleMatches(prepared, values, dependencies)) continue;
            if (!best) { best = prepared; ties.push(prepared); continue; }
            if (compareSpecificity(prepared.rule, best.rule) !== 0) break;
            ties.push(prepared);
        }
        if (!best) return EMPTY_ARRAY;
        if (ties.some(entry => JSON.stringify(parseOptionList(entry.rule.options)) !== JSON.stringify(parseOptionList(best.rule.options)))) return EMPTY_ARRAY;
        const custom = this.getCustomOptionsForCurrentContext(selector, values);
        return this.canonicalOptionList([...best.rule.options, ...custom]);
    }
    contextIsComplete(selector, context, mode, overrideKey, overrideValue) {
        const dependencies = this.getSelectorDependencies(selector);
        if (!dependencies.length) return true;

        return this.getRuleOptions(selector, context, mode, overrideKey, overrideValue).length > 0;
    }
    ruleMatches(rule, values, declaredDependencies = []) {
        const conditions = Object.entries(rule?.when || {}).filter(([, allowed]) => parseOptionList(allowed).length > 0);
        if (!conditions.length) return false;
        const conditionMatches = ([key, allowed]) => {
            const current = valueToArray(values[key]);
            return current.length > 0 && parseOptionList(allowed).some(value => current.includes(value));
        };
        if (ruleLogic(rule) === "or") return conditions.some(conditionMatches);

        if (declaredDependencies.some(key => !valueToArray(values[key]).length)) return false;
        return conditions.every(conditionMatches);
    }
    getNormalizedRules(selector) {
        const source = Array.isArray(selector?.rules) ? selector.rules : EMPTY_ARRAY;
        const cached = this.normalizedRulesCache.get(source);
        if (cached) return cached;
        const normalized = normalizeRules(source);
        this.normalizedRulesCache.set(source, normalized);
        return normalized;
    }
    getRuleOptions(selector, context, mode, overrideKey, overrideValue) {
        const dependencies = this.getSelectorDependencies(selector);
        if (!dependencies.length) return this.canonicalOptionList(selector.options || []);
        const values = {};
        for (const key of dependencies) values[key] = this.getPropertyValuesFromContext(context, key, mode, overrideKey, overrideValue);
        return this.getOptionsForDependencyValues(selector, dependencies, values);
    }
    getCustomOptionsForCurrentContext(selector, values) {
        const dependencies = this.getSelectorDependencies(selector);
        const sortedDependencies = dependencies.slice().sort();
        const keySignature = sortedDependencies.map(key => [key, stableValues(values[key] || [])]);
        const signature = JSON.stringify(keySignature);
        for (const entry of selector.customOptionsByContext || []) {
            const entryValues = sortedDependencies.map(key => [key, stableValues(entry.context?.[key] || [])]);
            if (JSON.stringify(entryValues) === signature) return entry.options || [];
        }
        return [];
    }
    getOptionsForSelector(selector, context, mode, overrideKey, overrideValue) {
        return this.getRuleOptions(selector, context, mode, overrideKey, overrideValue);
    }
    getOptionsForFrontmatter(selector, frontmatter) {
        const dependencies = this.getSelectorDependencies(selector);
        if (!dependencies.length) return this.canonicalOptionList(selector.options || []);
        const values = {};
        for (const key of dependencies) values[key] = valueToArray(frontmatter[key]);
        return this.getOptionsForDependencyValues(selector, dependencies, values);
    }
    canonicalOptionList(options) {
        const cached = this.canonicalOptionSources.get(options); if (cached) return cached;
        const clean = uniqueStrings(options); const fingerprint = JSON.stringify(clean); const old = this.optionListCache.get(fingerprint);
        if (old) { this.canonicalOptionSources.set(options, old); return old; }
        if (this.optionListCache.size >= 32) this.optionListCache.clear(); this.optionListCache.set(fingerprint, clean);
        this.canonicalOptionSources.set(options, clean); this.canonicalOptionSources.set(clean, clean); return clean;
    }
    getCorePropertyType(key, context = null) {
        const normalizeType = candidate => {
            let raw = candidate;
            if (raw && typeof raw === "object") {
                raw = raw.assignedType ?? raw.propertyType ?? raw.type ?? raw.typeId ?? raw.id ?? raw.name ?? raw.value;
                if (raw && typeof raw === "object") raw = raw.id ?? raw.name ?? raw.value;
            }
            if (typeof raw !== "string") return null;
            const normalized = raw.trim().toLocaleLowerCase().replace(/[_\s]+/g, "-");
            return normalized || null;
        };
        const property = context?.matches?.(".metadata-property") ? context : context?.closest?.(".metadata-property");
        const valueContainer = property?.querySelector?.(".metadata-property-value");
        for (const node of [property, valueContainer]) {
            if (!node) continue;
            for (const attribute of ["data-property-type", "data-type", "data-property-value-type"]) {
                const resolved = normalizeType(node.getAttribute?.(attribute));
                if (["list", "multitext", "tags", "aliases"].includes(resolved)) return "list";
                if (resolved === "text") return "text";
            }
        }
        const manager = this.app?.metadataTypeManager;
        const getMapValue = map => {
            if (map instanceof Map) {
                if (map.has(key)) return map.get(key);
                const normalizedKey = key.toLocaleLowerCase();
                for (const [candidate, value] of map) if (String(candidate).toLocaleLowerCase() === normalizedKey) return value;
                return null;
            }
            if (!map || typeof map !== "object") return null;
            if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
            const normalizedKey = key.toLocaleLowerCase();
            const matchedKey = Object.keys(map).find(candidate => candidate.toLocaleLowerCase() === normalizedKey);
            return matchedKey ? map[matchedKey] : null;
        };
        if (manager) {
            for (const methodName of ["getAssignedType", "getPropertyType", "getPropertyInfo"]) {
                if (typeof manager[methodName] !== "function") continue;
                try {
                    const resolved = normalizeType(manager[methodName](key));
                    if (["list", "multitext", "tags", "aliases"].includes(resolved)) return "list";
                    if (resolved === "text") return "text";
                } catch (_) {}
            }
            for (const mapName of ["properties", "assignedTypes", "assignedPropertyTypes", "propertyTypes", "types"]) {
                const resolved = normalizeType(getMapValue(manager[mapName]));
                if (["list", "multitext", "tags", "aliases"].includes(resolved)) return "list";
                if (resolved === "text") return "text";
            }
        }
        if (valueContainer?.querySelector?.(".multi-select-pill, .multi-select-container, .metadata-input-list, .multi-select-input")) return "list";
        return null;
    }
    async unassignObsidianPropertyType(keys) {
        if (!this.app.metadataTypeManager || !keys || !keys.length) return;
        try {
            const keysToUnassign = [];
            for (const key of keys) {
                keysToUnassign.push(key);
                keysToUnassign.push(key.toLocaleLowerCase());
            }

            let memoryChanged = false;

            if (typeof this.app.metadataTypeManager.unassignProperties === "function") {
                this.app.metadataTypeManager.unassignProperties(keysToUnassign);
                memoryChanged = true;
            }

            const props = this.app.metadataTypeManager.properties;
            const types = this.app.metadataTypeManager.types;

            for (const key of keysToUnassign) {
                if (props) {
                    if (props instanceof Map) { if (props.has(key)) { props.delete(key); memoryChanged = true; } }
                    else if (props[key]) { delete props[key]; memoryChanged = true; }
                }
                if (types) {
                    if (types instanceof Map) { if (types.has(key)) { types.delete(key); memoryChanged = true; } }
                    else if (types[key]) { delete types[key]; memoryChanged = true; }
                }
            }

            if (memoryChanged && typeof this.app.metadataTypeManager.save === "function") {
                this.app.metadataTypeManager.save();
            }

            const configDir = this.app.vault.configDir || ".obsidian";
            const configPath = `${configDir}/types.json`;
            
            if (await this.app.vault.adapter.exists(configPath)) {
                const fileData = await this.app.vault.adapter.read(configPath);
                if (fileData) {
                    const parsed = JSON.parse(fileData);
                    let fileChanged = false;
                    
                    if (parsed && typeof parsed.types === "object" && !Array.isArray(parsed.types)) {
                        for (const key of keysToUnassign) {
                            if (parsed.types[key] !== undefined) {
                                delete parsed.types[key];
                                fileChanged = true;
                            }
                        }
                    }
                    
                    if (fileChanged) {
                        await this.app.vault.adapter.write(configPath, JSON.stringify(parsed, null, 2));
                    }
                }
            }
        } catch (e) {
            console.warn("TaxoFlow Properties: could not unassign properties from Obsidian disk/memory", e);
        }
    }
    getPropertyTypeSignature(key, context, mode) {
        const assigned = this.getCorePropertyType(key, context);
        if (assigned) return `assigned:${assigned}`;
        const file = this.getFileForContext(context, mode);
        const value = file ? this.app?.metadataCache?.getFileCache?.(file)?.frontmatter?.[key] : undefined;
        return Array.isArray(value) ? "shape:list" : "shape:scalar";
    }
    isListProperty(key, context, mode) {
        const assigned = this.getCorePropertyType(key, context); if (assigned) return assigned === "list";
        const file = this.getFileForContext(context, mode); const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
        return Array.isArray(fm?.[key]);
    }
    optimisticValueKey(file, key) { return `${file.path}\u0000${key}`; }
    setOptimisticPropertyValue(file, key, value) {
        if (!(file instanceof obsidian_1.TFile)) return null;
        const cloned = Array.isArray(value) ? [...value] : value;
        const entry = { value: cloned, at: Date.now() };
        this.optimisticPropertyValues.set(this.optimisticValueKey(file, key), entry);
        return entry;
    }
    clearOptimisticPropertyValue(file, key, expectedEntry) {
        if (!(file instanceof obsidian_1.TFile)) return;
        const mapKey = this.optimisticValueKey(file, key);
        if (!expectedEntry || this.optimisticPropertyValues.get(mapKey) === expectedEntry) this.optimisticPropertyValues.delete(mapKey);
    }
    getOptimisticPropertyValue(file, key) {
        if (!(file instanceof obsidian_1.TFile)) return undefined;
        const mapKey = this.optimisticValueKey(file, key);
        const entry = this.optimisticPropertyValues.get(mapKey);
        if (!entry) return undefined;
        const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (cached && stableJson(cached[key]) === stableJson(entry.value)) {
            this.optimisticPropertyValues.delete(mapKey);
            if (entry.displayToken) this.clearOptimisticPropertyDisplay(file, key, entry.displayToken);
            return undefined;
        }
        if (Date.now() - entry.at > 10000) {
            this.optimisticPropertyValues.delete(mapKey);
            if (entry.displayToken) this.clearOptimisticPropertyDisplay(file, key, entry.displayToken);
            return undefined;
        }
        return Array.isArray(entry.value) ? [...entry.value] : entry.value;
    }
    reconcileOptimisticValuesForFile(file) {
        if (!(file instanceof obsidian_1.TFile)) return;
        const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!cached) return;
        const prefix = `${file.path}\u0000`;
        for (const [mapKey, entry] of this.optimisticPropertyValues) {
            if (!mapKey.startsWith(prefix)) continue;
            const key = mapKey.slice(prefix.length);
            if (this.selectorWriteQueues.has(mapKey)) continue;
            if (stableJson(cached[key]) === stableJson(entry.value) || Date.now() - entry.at > 10000) {
                this.optimisticPropertyValues.delete(mapKey);
                if (entry.displayToken) this.clearOptimisticPropertyDisplay(file, key, entry.displayToken);
            }
        }
    }
    readStoredArrayValuesFromFile(key, context, mode) {
        let domValues = [];
        if (mode === "properties" && context) {
            const property = context.matches?.(".metadata-property") ? context : context.closest?.(".metadata-property");
            if (property) {
                const pills = Array.from(property.querySelectorAll(".multi-select-pill-content, .multi-select-pill"));
                if (pills.length > 0) {
                    domValues = pills.map(p => {
                        const content = p.classList.contains("multi-select-pill-content") ? p : p.querySelector(".multi-select-pill-content");
                        return (content || p).textContent.trim();
                    }).filter(Boolean);
                }
            }
        }

        const file = this.getFileForContext(context, mode); 
        if (!file) return uniqueStrings(domValues);

        const optimistic = this.getOptimisticPropertyValue(file, key);
        if (optimistic !== undefined) return uniqueStrings([...domValues, ...valueToArray(optimistic)]);
        
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return uniqueStrings([...domValues, ...valueToArray(fm?.[key])]);
    }
    getPropertyKeyLabelNode(property) {
        return property.querySelector(".metadata-property-key") || property.querySelector(".metadata-property-key-input")?.parentElement || null;
    }
    queryIncludingRoot(container, selector) {
        const matches = Array.from(container.querySelectorAll(selector));
        if (container.matches?.(selector)) matches.unshift(container);
        return matches;
    }
    applyLabels(container) {
        this.queryIncludingRoot(container, ".metadata-property").forEach(property => {
            const key = this.getPropertyKey(property); const label = this.getLabelForKey(key); const keyNode = this.getPropertyKeyLabelNode(property);
            if (!label || !keyNode) { property.removeAttribute("data-taxoflow-label"); keyNode?.removeAttribute("data-taxoflow-label"); return; }
            property.setAttribute("data-taxoflow-label", label); keyNode.setAttribute("data-taxoflow-label", label); keyNode.classList.add("taxoflow-property-key-label-host");
            const input = property.querySelector(".metadata-property-key-input");
            if (input && !input.dataset.tfLabelFocusBound) {
                input.dataset.tfLabelFocusBound = "true";
                input.addEventListener("focus", () => keyNode.classList.add("taxoflow-key-editing"));
                input.addEventListener("blur", () => keyNode.classList.remove("taxoflow-key-editing"));
            }
        });
    }
    isEditorElement(element) {
        if (!element || !(element instanceof HTMLElement)) return false;
        if (element.closest(".metadata-property-key")) return false;
        if (element instanceof HTMLInputElement) return !element.disabled && !["checkbox", "radio", "button", "submit", "hidden", "file"].includes(element.type.toLowerCase());
        return element instanceof HTMLDivElement && (element.isContentEditable || element.getAttribute("contenteditable") === "true");
    }
    findActiveEditor(host) {
        const active = document.activeElement;
        if (this.isEditorElement(active) && host.contains(active)) return active;
        const candidates = Array.from(host.querySelectorAll("input, div[contenteditable=true]" )).filter(candidate => {
            if (!this.isEditorElement(candidate) || candidate.closest(".suggestion-container")) return false;
            const style = window.getComputedStyle(candidate); return style.display !== "none" && style.visibility !== "hidden" && candidate.getClientRects().length > 0;
        });
        return candidates[candidates.length - 1] || null;
    }
    unbindSelectorHost(host) {
        const binding = host ? this.boundSelectorHosts.get(host) : null;
        if (!binding) return;
        host.removeEventListener("click", binding.openSuggestions);
        host.removeEventListener("focusin", binding.onFocusIn);
        for (const editor of binding.editors || []) {
            const suggest = this.selectorSuggests.get(editor);
            if (suggest && suggest.bindingKey === binding.bindingKey) {
                suggest.dispose(); this.activeSuggests.delete(suggest); this.selectorSuggests.delete(editor);
            }
        }
        this.boundSelectorHosts.delete(host);
        this.selectorHostBindings.delete(binding);
    }
    bindSelectorHost(host, propertyElement, selector, key, mode) {
        const current = this.boundSelectorHosts.get(host);
        const bindingKey = `${mode}\u0000${key}`;
        if (current && current.bindingKey === bindingKey && current.selector === selector && current.propertyElement === propertyElement) {
            if (current.editors?.size) {
                const propertyTypeSignature = this.getPropertyTypeSignature(key, propertyElement, mode);
                if (current.propertyTypeSignature && current.propertyTypeSignature !== propertyTypeSignature) {
                    current.propertyTypeSignature = propertyTypeSignature;
                    for (const editor of current.editors) this.selectorSuggests.get(editor)?.propertyTypeChanged?.();
                } else {
                    current.propertyTypeSignature = propertyTypeSignature;
                }
            }
            return;
        }
        if (current) this.unbindSelectorHost(host);
        const binding = { host, bindingKey, key, selector, propertyElement, mode, propertyTypeSignature: null, editors: new Set(), openSuggestions: null, onFocusIn: null };
        const openSuggestions = () => {
            if (host.dataset.tfSelectorAttachPending === "true") return; host.dataset.tfSelectorAttachPending = "true"; let attempts = 0;
            const tryAttach = () => {
                if (!host.isConnected) { delete host.dataset.tfSelectorAttachPending; return; }
                const editor = this.findActiveEditor(host);
                if (editor) { delete host.dataset.tfSelectorAttachPending; const focusOpenedAt = Number.parseInt(host.dataset.tfSelectorFocusOpenedAt || "0", 10); this.attachSelectorSuggest(editor, host, propertyElement, selector, key, mode, Date.now() - focusOpenedAt >= 100); return; }
                if (++attempts >= 12) { delete host.dataset.tfSelectorAttachPending; return; }
                window.setTimeout(tryAttach, 35);
            }; window.setTimeout(tryAttach, 0);
        };
        const onFocusIn = event => {
            const target = event.target;
            if (!this.isEditorElement(target) || !host.contains(target)) return;
            host.dataset.tfSelectorFocusOpenedAt = Date.now().toString();
            this.attachSelectorSuggest(target, host, propertyElement, selector, key, mode, true);
        };
        binding.openSuggestions = openSuggestions; binding.onFocusIn = onFocusIn;
        host.addEventListener("click", openSuggestions);
        host.addEventListener("focusin", onFocusIn);
        this.boundSelectorHosts.set(host, binding);
        this.selectorHostBindings.add(binding);
    }
    attachSelectorSuggest(editor, host, propertyElement, selector, key, mode, open) {
        const existing = this.selectorSuggests.get(editor);
        if (existing && !existing.disposed && existing.selectorRef === selector && existing.selectorKey === key) { if (open) existing.openAll(); return existing; }
        if (existing) { existing.dispose(); this.activeSuggests.delete(existing); this.selectorSuggests.delete(editor); }
        this.boundSelectorHosts.get(host)?.editors?.add(editor);
        const suggest = new TaxoOptionSuggest(this.app, editor,
            () => this.getOptionsForSelector(selector, propertyElement, mode),
            () => this.isListProperty(key, propertyElement, mode),
            () => this.readStoredArrayValuesFromFile(key, propertyElement, mode),
            value => { void this.commitSelectedOption(value, editor, host, propertyElement, selector, key, mode); },
            (value, baseline) => this.commitCustomValue(value, baseline, editor, host, propertyElement, selector, key, mode),
            () => this.contextIsComplete(selector, propertyElement, mode) && (normalizeDependsOn(selector.dependsOn).length === 0 || this.getOptionsForSelector(selector, propertyElement, mode).length > 0));
        suggest.selectorKey = key; suggest.selectorRef = selector; suggest.bindingKey = `${mode}\u0000${key}`;
        this.selectorSuggests.set(editor, suggest); this.activeSuggests.add(suggest);
        this.register(() => { suggest.dispose(); this.activeSuggests.delete(suggest); });
        if (open) { suggest.openAll(); window.setTimeout(() => suggest.hideCompetingSuggestionContainers(), 0); window.setTimeout(() => suggest.hideCompetingSuggestionContainers(), 40); } return suggest;
    }
    async commitSelectedOption(value, editor, host, context, selector, key, mode) {
        const file = this.getFileForContext(context, mode); if (!(file instanceof obsidian_1.TFile)) return;
        const initialListMode = this.isListProperty(key, context, mode);

        if (!initialListMode) { if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) editor.value = value; else editor.textContent = value; }
        const queueKey = `${file.path}\u0000${key}`; const previous = this.selectorWriteQueues.get(queueKey) ?? Promise.resolve();
        const currentValues = this.readStoredArrayValuesFromFile(key, context, mode);
        const predictedValue = initialListMode ? uniqueStrings([...currentValues, value]) : value;
        let optimisticEntry = this.setOptimisticPropertyValue(file, key, predictedValue);
        const queued = previous.catch(() => undefined).then(() => this.processFrontMatterSerialized(file, frontmatter => {
            const listModeAtWrite = this.isListProperty(key, context, mode);
            if (listModeAtWrite) frontmatter[key] = uniqueStrings([...valueToArray(frontmatter[key]), value]);
            else frontmatter[key] = value;
            const mapKey = this.optimisticValueKey(file, key);
            if (this.optimisticPropertyValues.get(mapKey) === optimisticEntry) optimisticEntry = this.setOptimisticPropertyValue(file, key, frontmatter[key]);
        }));
        this.selectorWriteQueues.set(queueKey, queued);
        try { await queued; }
        catch (error) {
            this.clearOptimisticPropertyValue(file, key, optimisticEntry);
            console.error(`TaxoFlow Properties: failed to save ${key} in ${file.path}`, error);
            if (!initialListMode && editor.isConnected) {
                const stored = valueToString(this.readStoredArrayValuesFromFile(key, context, mode));
                if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) editor.value = stored; else editor.textContent = stored;
            }
            return;
        }
        finally { if (this.selectorWriteQueues.get(queueKey) === queued) this.selectorWriteQueues.delete(queueKey); }
        this.refreshOpenSuggestions(key);
        if (editor.isConnected) editor.blur();
    }
    async commitCustomValue(value, baseline, editor, host, context, selector, key, mode) {
        const candidate = String(value || "").replace(/\s+/g, " ").trim();
        const original = String(baseline || "").replace(/\s+/g, " ").trim();
        if (!candidate || candidate === original) return;
        const available = this.getOptionsForSelector(selector, context, mode);
        const existing = available.find(option => option.toLocaleLowerCase() === candidate.toLocaleLowerCase());
        if (existing) { await this.commitSelectedOption(existing, editor, host, context, selector, key, mode); return; }
        const dependencies = normalizeDependsOn(selector.dependsOn);
        if (!this.contextIsComplete(selector, context, mode) || (dependencies.length && available.length === 0)) {
            if (editor instanceof HTMLInputElement) editor.value = original; else editor.textContent = original;
            if (editor.isConnected) editor.blur();
            return;
        }
        const file = this.getFileForContext(context, mode); if (!(file instanceof obsidian_1.TFile)) return;
        const initialListMode = this.isListProperty(key, context, mode);
        const queueKey = `${file.path}\u0000${key}`; const previous = this.selectorWriteQueues.get(queueKey) ?? Promise.resolve();
        const existingStoredValues = this.readStoredArrayValuesFromFile(key, context, mode);
        const predictedValue = initialListMode ? uniqueStrings([...existingStoredValues, candidate]) : candidate;
        let optimisticEntry = this.setOptimisticPropertyValue(file, key, predictedValue);
        const queued = previous.catch(() => undefined).then(() => this.processFrontMatterSerialized(file, fm => {
            const listModeAtWrite = this.isListProperty(key, context, mode);
            if (listModeAtWrite) fm[key] = uniqueStrings([...valueToArray(fm[key]), candidate]);
            else fm[key] = candidate;
            const mapKey = this.optimisticValueKey(file, key);
            if (this.optimisticPropertyValues.get(mapKey) === optimisticEntry) optimisticEntry = this.setOptimisticPropertyValue(file, key, fm[key]);
        }));
        this.selectorWriteQueues.set(queueKey, queued);
        try { await queued; } catch (error) {
            this.clearOptimisticPropertyValue(file, key, optimisticEntry);
            console.error(`TaxoFlow Properties: failed to save custom value for ${key}`, error);
            if (editor.isConnected) {
                const stored = valueToString(this.readStoredArrayValuesFromFile(key, context, mode));
                if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) editor.value = stored; else editor.textContent = stored;
            }
            return;
        }
        finally { if (this.selectorWriteQueues.get(queueKey) === queued) this.selectorWriteQueues.delete(queueKey); }
        if (!this.contextIsComplete(selector, context, mode)) return;

        if (dependencies.length && available.length === 0) return;
        if (!dependencies.length) {
            if (!selector.options.includes(candidate)) selector.options.push(candidate);
        } else {
            const actual = {}; for (const dep of dependencies) actual[dep] = stableValues(this.getPropertyValuesFromContext(context, dep, mode));
            const signature = JSON.stringify(Object.keys(actual).sort().map(k => [k, actual[k]]));
            let record = (selector.customOptionsByContext || []).find(entry => JSON.stringify(Object.keys(entry.context || {}).sort().map(k => [k, stableValues(entry.context[k])])) === signature);
            if (!record) { record = { context: actual, options: [] }; selector.customOptionsByContext = selector.customOptionsByContext || []; selector.customOptionsByContext.push(record); }
            if (!record.options.includes(candidate)) record.options.push(candidate);
        }
        this.invalidateRuntimeCaches();
        await this.saveSettings();
        this.refreshOpenSuggestions(key);
        this.scheduleLabelRefresh();
    }
    injectDropdowns(container) {
        this.applyLabels(container);
        this.queryIncludingRoot(container, ".metadata-property").forEach(property => {
            const valueContainer = property.querySelector(".metadata-property-value"); if (!valueContainer) return;
            const key = this.getPropertyKey(property);
            const selector = key ? this.getSelector(key) : null;
            if (!selector) {
                this.unbindSelectorHost(valueContainer);
                const profile = key ? this.getProfileForPropertyKey(key) : null;
                if (profile && isValidProfilePropertyKey(key, profile)) this.registerDiscoveredProperty(key, profile);
                return;
            }
            this.bindSelectorHost(valueContainer, property, selector, key, "properties");
        });
    }
    handleMutations(mutations) {
        const openedSuggestion = mutations.some(mutation => [...(mutation.addedNodes || [])].some(node => node instanceof Element && (node.matches(".suggestion-container") || node.querySelector(".suggestion-container"))));
        if (openedSuggestion) for (const suggest of this.activeSuggests) if (suggest && !suggest.disposed && suggest.editor?.isConnected && document.activeElement === suggest.editor) suggest.hideCompetingSuggestionContainers();
        this.decorateOpenMenus();
        const relevant = ".metadata-property";
        const roots = new Set();
        for (const mutation of mutations) {
            if (mutation.type === "attributes") {
                const target = mutation.target;
                const root = target instanceof Element ? (target.matches(relevant) ? target : target.closest(".metadata-property")) : null;
                if (root && !root.closest(".taxoflow-modal, .taxoflow-settings")) roots.add(root);
                continue;
            }
            if (mutation.type !== "childList" || mutation.addedNodes.length === 0) continue;
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.closest(".suggestion-container, .taxoflow-modal, .taxoflow-settings, .taxoflow-label-original")) continue;
                let root = null;
                if (node.matches(relevant) || node.querySelector(relevant)) root = node;
                else root = node.closest(".metadata-property");
                if (root) roots.add(root);
            }
        }
        if (!roots.size) return;
        const list = [...roots].filter(root => ![...roots].some(other => other !== root && other.contains(root)));
        for (const root of list) this.injectDropdowns(root);
    }
}
exports.default = TaxoFlowPlugin;