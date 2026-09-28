import { resolveFallbackDisplaySource } from "./fallback-image.js";
import { appendCacheBustParam } from "./fallback-url.js";

const FALLBACK_PRELOAD_TIMEOUT_MS = 3000;
const FALLBACK_MAX_DEVICE_PIXEL_RATIO = 3;

export const prioritizeFallbackImageRequest = (image) => {
  if (!image) return;
  image.loading = "eager";
  image.decoding = "async";
  image.fetchPriority = "high";
  image.setAttribute?.("fetchpriority", "high");
};

export const resolveFallbackRequestHeight = ({
  imgEl,
  devicePixelRatio =
    globalThis.window?.devicePixelRatio || globalThis.devicePixelRatio || 1,
}) => {
  const container = imgEl?.parentElement || null;
  const cssHeight =
    Number(container?.getBoundingClientRect?.().height) ||
    Number(container?.clientHeight) ||
    Number(imgEl?.getBoundingClientRect?.().height) ||
    Number(imgEl?.clientHeight) ||
    0;
  if (cssHeight <= 0) return 0;
  const pixelRatio = Math.min(
    FALLBACK_MAX_DEVICE_PIXEL_RATIO,
    Math.max(1, Number(devicePixelRatio) || 1),
  );
  return Math.ceil(cssHeight * pixelRatio);
};

export const preloadFallbackImageSource = async (
  src,
  {
    createImage = () => {
      const ImageCtor = globalThis.Image;
      return typeof ImageCtor === "function" ? new ImageCtor() : null;
    },
    timeoutMs = FALLBACK_PRELOAD_TIMEOUT_MS,
  } = {},
) => {
  const source = String(src || "").trim();
  if (!source) return false;
  const image = createImage?.();
  if (!image) return true;
  prioritizeFallbackImageRequest(image);
  return await new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const done = (ready) => {
      if (settled) return;
      settled = true;
      if (timeout != null) clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(ready === true);
    };
    image.onload = () => done(true);
    image.onerror = () => done(false);
    timeout = setTimeout(
      () => done(false),
      Math.max(250, Number(timeoutMs) || FALLBACK_PRELOAD_TIMEOUT_MS),
    );
    image.src = source;
    if (typeof image.decode === "function") {
      void image.decode().then(
        () => done(true),
        () => {
          if (image.complete && Number(image.naturalWidth) > 0) done(true);
        },
      );
    }
  });
};

export const nextFallbackRequestId = (currentRequestId) =>
  Number(currentRequestId || 0) + 1;

export const issueFallbackRefreshToken = ({ currentRequestId }) => {
  const requestId = nextFallbackRequestId(currentRequestId);
  return {
    requestId,
    nextRequestId: requestId,
  };
};

export const getFallbackRefreshElements = (shadowRoot) => ({
  imgEl: shadowRoot?.querySelector?.("#stream-fallback-img") || null,
  statusEl: shadowRoot?.querySelector?.("#stream-fallback-status") || null,
});

export const canRefreshFallbackImage = ({ imgEl }) => !!imgEl;

export const beginFallbackRefresh = ({ imgEl, currentRequestId }) => {
  if (!canRefreshFallbackImage({ imgEl })) {
    return {
      shouldAbort: true,
      token: null,
    };
  }
  return {
    shouldAbort: false,
    token: issueFallbackRefreshToken({ currentRequestId }),
  };
};

export const resolveFallbackRefreshEntity = (activeCam) =>
  String(activeCam?.entity || "").trim();

export const loadPrimaryFallbackSource = async ({
  entity,
  loadPrimary,
  requestHeight = 0,
}) => {
  if (!entity) return "";
  return await loadPrimary(entity, { requestHeight });
};

export const resolveAltFallbackSource = ({ entity, loadAlt }) => {
  if (!entity) return "";
  return loadAlt(entity);
};

const canCacheBustFallbackSource = (src) =>
  Boolean(src) && !/[?&]authSig=/i.test(String(src));

export const resolveFallbackRefreshSources = ({
  primarySrc,
  altSrc,
  cacheBustValue = null,
  preferAlternate = false,
}) => {
  const outcome = buildFallbackRefreshOutcome({
    primarySrc,
    altSrc,
  });
  const preferredSource =
    preferAlternate && altSrc ? altSrc : outcome.src;
  const src =
    cacheBustValue != null && canCacheBustFallbackSource(preferredSource)
      ? appendCacheBustParam(
          preferredSource,
          cacheBustValue,
          "fvc_loading_snapshot",
        )
      : preferredSource;
  return {
    primarySrc,
    altSrc,
    src,
    hasSource: Boolean(src),
  };
};

export const buildFallbackRefreshContext = ({
  entity,
  primarySrc,
  loadAlt,
  cacheBustValue = null,
  preferAlternate = false,
}) => {
  const altSrc = resolveAltFallbackSource({
    entity,
    loadAlt,
  });
  const sources = resolveFallbackRefreshSources({
    primarySrc,
    altSrc,
    cacheBustValue,
    preferAlternate,
  });
  return {
    entity,
    primarySrc,
    altSrc,
    sources,
  };
};

export const shouldApplyFallbackRefreshSources = ({ sources }) =>
  !!sources?.hasSource;

export const buildFallbackImageApplyPayload = ({
  imgEl,
  statusEl,
  entity,
  sources,
}) => ({
  img: imgEl,
  statusEl,
  altSrc: sources?.altSrc || "",
  entity,
  src: sources?.src || "",
});

export const buildFallbackImageWriteInput = ({ context, imgEl, statusEl }) => {
  const sources = context?.sources || null;
  return {
    applyPayload: buildFallbackImageApplyPayload({
      imgEl,
      statusEl,
      entity: context?.entity || "",
      sources,
    }),
    src: sources?.src || "",
  };
};

export const executeFallbackRefreshWrite = ({
  writeInput,
  applyHandlers,
  applySource,
}) => {
  if (!writeInput?.applyPayload) return;
  applyHandlers(writeInput.applyPayload);
  applySource({
    img: writeInput.applyPayload.img,
    src: writeInput.src,
  });
  if (writeInput.applyPayload.img) {
    if (writeInput.applyPayload.img.dataset) {
      writeInput.applyPayload.img.dataset.fallbackEntity =
        writeInput.applyPayload.entity;
    }
    writeInput.applyPayload.img.hidden = false;
  }
};

export const isFallbackRefreshStale = ({ requestId, activeRequestId }) =>
  requestId !== activeRequestId;

export const shouldAbortStaleFallbackRefresh = ({
  requestId,
  activeRequestId,
}) => isFallbackRefreshStale({ requestId, activeRequestId });

export const shouldAbortFallbackRefreshAfterPrimary = ({
  token,
  activeRequestId,
}) =>
  shouldAbortStaleFallbackRefresh({
    requestId: token?.requestId,
    activeRequestId,
  });

export const loadPrimaryWithStaleGate = async ({
  entity,
  token,
  activeRequestId,
  readActiveRequestId,
  loadPrimary,
  requestHeight = 0,
}) => {
  const primarySrc = await loadPrimaryFallbackSource({
    entity,
    loadPrimary,
    requestHeight,
  });
  const resolvedActiveRequestId = readActiveRequestId?.() ?? activeRequestId;
  if (
    shouldAbortFallbackRefreshAfterPrimary({
      token,
      activeRequestId: resolvedActiveRequestId,
    })
  ) {
    return {
      shouldAbort: true,
      primarySrc: "",
    };
  }
  return {
    shouldAbort: false,
    primarySrc,
  };
};

export const buildFallbackRefreshWritePlan = ({
  entity,
  primarySrc,
  loadAlt,
  imgEl,
  statusEl,
  cacheBustValue = null,
  preferAlternate = false,
}) => {
  const context = buildFallbackRefreshContext({
    entity,
    primarySrc,
    loadAlt,
    cacheBustValue,
    preferAlternate,
  });
  if (!shouldApplyFallbackRefreshSources({ sources: context.sources })) {
    return {
      shouldWrite: false,
      writeInput: null,
      context,
    };
  }
  return {
    shouldWrite: true,
    writeInput: buildFallbackImageWriteInput({
      context,
      imgEl,
      statusEl,
    }),
    context,
  };
};

export const runFallbackRefreshCycle = async ({
  shadowRoot,
  currentRequestId,
  activeCam,
  setActiveRequestId,
  readActiveRequestId,
  loadPrimary,
  loadAlt,
  applyHandlers,
  applySource,
  preloadSource = preloadFallbackImageSource,
  devicePixelRatio,
  cacheBustValue = null,
  preferAlternate = false,
}) => {
  const { imgEl, statusEl } = getFallbackRefreshElements(shadowRoot);
  const begin = beginFallbackRefresh({
    imgEl,
    currentRequestId,
  });
  if (begin.shouldAbort) {
    return {
      shouldAbort: true,
      didWrite: false,
    };
  }

  prioritizeFallbackImageRequest(imgEl);
  const requestHeight = resolveFallbackRequestHeight({
    imgEl,
    devicePixelRatio,
  });

  const token = begin.token;
  setActiveRequestId?.(token.nextRequestId);

  const entity = resolveFallbackRefreshEntity(activeCam);
  const primaryPhase = await loadPrimaryWithStaleGate({
    entity,
    token,
    activeRequestId: token.nextRequestId,
    readActiveRequestId,
    loadPrimary,
    requestHeight,
  });
  if (primaryPhase.shouldAbort) {
    return {
      shouldAbort: true,
      didWrite: false,
    };
  }

  const writePlan = buildFallbackRefreshWritePlan({
    entity,
    primarySrc: primaryPhase.primarySrc,
    loadAlt,
    imgEl,
    statusEl,
    cacheBustValue,
    preferAlternate,
  });
  if (!writePlan.shouldWrite) {
    return {
      shouldAbort: false,
      didWrite: false,
    };
  }

  const alternateSource = writePlan.context?.sources?.altSrc || "";
  let readySource = writePlan.writeInput.src;
  let sourceReady = await preloadSource?.(readySource);
  if (
    !sourceReady &&
    alternateSource &&
    alternateSource !== readySource
  ) {
    readySource = alternateSource;
    sourceReady = await preloadSource?.(readySource);
  }
  if (
    shouldAbortStaleFallbackRefresh({
      requestId: token.requestId,
      activeRequestId: readActiveRequestId?.() ?? token.nextRequestId,
    })
  ) {
    return {
      shouldAbort: true,
      didWrite: false,
    };
  }
  const writeInput = {
    ...writePlan.writeInput,
    src: readySource,
    applyPayload: {
      ...writePlan.writeInput.applyPayload,
      src: readySource,
    },
  };

  executeFallbackRefreshWrite({
    writeInput,
    applyHandlers,
    applySource,
  });

  return {
    shouldAbort: false,
    didWrite: true,
  };
};

export const runFallbackRefreshCycleForCard = async ({
  card,
  applyHandlers,
  applySource,
  cacheBustValue = null,
  preferAlternate = false,
}) => {
  if (!card) {
    return {
      shouldAbort: true,
      didWrite: false,
    };
  }

  return await runFallbackRefreshCycle({
    shadowRoot: card.shadowRoot,
    currentRequestId: card._fallbackReqId,
    activeCam: {
      entity:
        card._activeGroupMemberOverride || card._activeCam?.entity || "",
    },
    setActiveRequestId: (nextRequestId) => {
      card._fallbackReqId = nextRequestId;
    },
    readActiveRequestId: () => card._fallbackReqId,
    loadPrimary: async (nextEntity, options) =>
      await card._streamFallbackUrl(nextEntity, options),
    loadAlt: (nextEntity) => card._streamFallbackAltUrl(nextEntity),
    applyHandlers,
    applySource,
    cacheBustValue,
    preferAlternate,
  });
};

export const buildFallbackRefreshOutcome = ({ primarySrc, altSrc }) => {
  const src = resolveFallbackDisplaySource({
    primarySrc,
    altSrc,
  });
  return {
    src,
    hasSource: !!src,
  };
};
