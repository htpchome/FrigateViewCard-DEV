import english from "./languages/en.json" with { type: "json" };
import { VERSION } from "../../constants.js";
import { LANGUAGE_ASSETS, LANGUAGE_ASSET_PREFIX } from "./catalogs.mjs";

const DEFAULT_LANGUAGE = "en";
const DEFAULT_DICTIONARIES = Object.freeze({
  en: english,
});

export const normalizeLanguageCode = (language) => {
  const candidate = String(language ?? "").trim().replaceAll("_", "-");
  if (!candidate) return DEFAULT_LANGUAGE;
  try {
    return Intl.getCanonicalLocales(candidate)[0] || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

export const resolveHassLanguage = (hass) =>
  normalizeLanguageCode(hass?.locale?.language || hass?.language);

const readTranslation = (dictionary, key) => {
  let value = dictionary;
  for (const part of String(key).split(".")) {
    if (!value || !Object.hasOwn(value, part)) return null;
    value = value[part];
  }
  return typeof value === "string" ? value : null;
};

const languageCandidates = (language) => {
  const candidates = [];
  let candidate = language;
  while (candidate) {
    candidates.push(candidate);
    const lastSeparator = candidate.lastIndexOf("-");
    candidate = lastSeparator < 0 ? "" : candidate.slice(0, lastSeparator);
  }
  return candidates;
};

const loadLanguageAsset = async (assetName) => {
  const url = new URL(
    `./${LANGUAGE_ASSET_PREFIX}-${assetName}.json`,
    import.meta.url,
  );
  url.searchParams.set("fvc-version", VERSION);
  const response = await fetch(url.href);
  if (!response.ok) return null;
  const dictionary = await response.json();
  return dictionary && typeof dictionary === "object" ? dictionary : null;
};

export const createLocalizationController = (options = {}) => {
  const customDictionaries = Object.hasOwn(options, "dictionaries");
  const dictionaries = options.dictionaries ?? DEFAULT_DICTIONARIES;
  const loadDictionary =
    options.loadDictionary ?? (customDictionaries ? null : loadLanguageAsset);
  const onLanguageLoaded = options.onLanguageLoaded;
  const available = new Map(
    Object.entries(dictionaries).map(([language, dictionary]) => [
      normalizeLanguageCode(language),
      dictionary,
    ]),
  );
  let language = DEFAULT_LANGUAGE;
  let lookupLanguages = [DEFAULT_LANGUAGE];
  let loadRevision = 0;
  let pendingLoad = Promise.resolve(false);
  const assetLoads = new Map();

  const rebuildLookupLanguages = () => {
    lookupLanguages = languageCandidates(language).filter((candidate) =>
      available.has(candidate),
    );
    if (!lookupLanguages.includes(DEFAULT_LANGUAGE)) {
      lookupLanguages.push(DEFAULT_LANGUAGE);
    }
  };

  const loadCandidate = async (candidate) => {
    if (available.has(candidate)) return false;
    const assetName = LANGUAGE_ASSETS[candidate];
    if (!assetName || typeof loadDictionary !== "function") return false;
    let load = assetLoads.get(assetName);
    if (!load) {
      load = Promise.resolve(loadDictionary(assetName)).catch(() => null);
      assetLoads.set(assetName, load);
    }
    const dictionary = await load;
    if (!dictionary || typeof dictionary !== "object") return false;
    available.set(candidate, dictionary);
    return true;
  };

  const scheduleLanguageLoad = () => {
    const revision = ++loadRevision;
    const candidates = languageCandidates(language);
    pendingLoad = Promise.all(candidates.map(loadCandidate)).then((results) => {
      if (revision !== loadRevision || !results.some(Boolean)) return false;
      const previousLookup = lookupLanguages.join("\u0000");
      rebuildLookupLanguages();
      if (lookupLanguages.join("\u0000") === previousLookup) return false;
      onLanguageLoaded?.({
        language,
        resolvedLanguage: lookupLanguages[0],
      });
      return true;
    });
  };

  const setLanguage = (requestedLanguage) => {
    const nextLanguage = normalizeLanguageCode(requestedLanguage);
    if (nextLanguage === language) return false;
    language = nextLanguage;
    rebuildLookupLanguages();
    scheduleLanguageLoad();
    return true;
  };

  const t = (key, values = {}) => {
    const text = lookupLanguages
      .map((locale) => readTranslation(available.get(locale), key))
      .find((value) => value !== null) ?? String(key);
    return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : token,
    );
  };

  return Object.freeze({
    get language() {
      return language;
    },
    get resolvedLanguage() {
      return lookupLanguages[0];
    },
    setLanguage,
    updateHass: (hass) => setLanguage(resolveHassLanguage(hass)),
    whenReady: () => pendingLoad,
    t,
  });
};
