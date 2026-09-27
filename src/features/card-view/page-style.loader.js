import { VERSION } from "../../constants.js";

const CARD_VIEW_ASSET_NAME = "frigate-view-card-card-view.js";
const cardViewStyleModuleState = { promise: null };

export const ensureCardViewPageStyleModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (cardViewStyleModuleState.promise) {
    return cardViewStyleModuleState.promise;
  }
  const assetUrl = new URL(`./${CARD_VIEW_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  cardViewStyleModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      cardViewStyleModuleState.promise = null;
      throw error;
    });
  return cardViewStyleModuleState.promise;
};

export const ensureCardViewPageStyles = async (
  host,
  options = {},
) => {
  const module = await ensureCardViewPageStyleModule(options);
  if (typeof module?.installCardViewPageStyles !== "function") {
    throw new TypeError(
      "Card View module did not export its style installer",
    );
  }
  return module.installCardViewPageStyles(host);
};
