import {
  SUPPORTED_CARD_TAGS,
  normalizeCardTag,
  normalizeCardTags,
} from "../../constants.js";

export { normalizeCardTag };

const dashboardViewName = (view, index) => {
  const configuredPath = String(view?.path || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return configuredPath || String(index);
};

export const resolveDashboardNavbarOwnership = (
  dashboardConfig,
  cardTags = SUPPORTED_CARD_TAGS,
) => {
  const normalizedCardTags = new Set(normalizeCardTags(cardTags));
  const cards = [];
  if (!normalizedCardTags.size || !Array.isArray(dashboardConfig?.views)) {
    return { cards, claimants: [], owner: null, conflicts: [] };
  }

  let cardOrder = 0;
  dashboardConfig.views.forEach((view, viewIndex) => {
    const visited = new Set();
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 30) return;
      if (visited.has(value)) return;
      visited.add(value);
      if (
        !Array.isArray(value) &&
        normalizedCardTags.has(normalizeCardTag(value.type))
      ) {
        cards.push({
          config: value,
          cardOrder,
          view,
          viewIndex,
          viewName: dashboardViewName(view, viewIndex),
          viewTitle:
            String(view?.title || "").trim() || `Page ${viewIndex + 1}`,
        });
        cardOrder += 1;
        return;
      }
      Object.values(value).forEach((entry) => visit(entry, depth + 1));
    };
    visit(view);
  });

  const claimants = cards.filter(
    ({ config }) =>
      config?.mobile_view_ha_navbar_bottom === true &&
      config?.mobile_view_ha_navbar_dashboard === true,
  );
  return {
    cards,
    claimants,
    owner: claimants[0] || null,
    conflicts: claimants.slice(1),
  };
};

export const resolveDashboardNavbarCardOwnership = ({
  dashboardConfig,
  sourceConfig = null,
  requested = false,
  cardTag = SUPPORTED_CARD_TAGS,
  currentViewName = "",
} = {}) => {
  const ownership = resolveDashboardNavbarOwnership(dashboardConfig, cardTag);
  const exactRecord = ownership.cards.find(
    ({ config }) => config === sourceConfig,
  );
  const currentViewClaimants = ownership.claimants.filter(
    ({ viewName }) => viewName === currentViewName,
  );
  const currentCardIsResolvedOwner =
    Boolean(ownership.owner) &&
    (ownership.owner === exactRecord ||
      (!exactRecord &&
        requested &&
        ownership.owner.viewName === currentViewName &&
        currentViewClaimants.length === 1));
  const isOwner =
    requested && (!ownership.owner || currentCardIsResolvedOwner);
  return {
    ...ownership,
    requested,
    isOwner,
    locked: Boolean(ownership.owner) && !currentCardIsResolvedOwner,
    conflict: requested && Boolean(ownership.owner) && !isOwner,
  };
};
