import { SUPPORTED_CARD_TAGS } from "../../constants.js";
import { DEVICE_PROFILE } from "../../helpers.js";
import { LazyHomeAssistantDashboardSwipeNavigationController } from "./dashboard-swipe-navigation.loader.js";
import { LazyHomeAssistantNavbarController } from "./navbar.loader.js";
import { HomeAssistantPageBackgroundController } from "./page-background.ctrl.js";

const DEFAULT_FACTORIES = Object.freeze({
  createDashboardSwipeNavigationController: (card, options) =>
    new LazyHomeAssistantDashboardSwipeNavigationController(card, options),
  createNavbarController: (card, options) =>
    new LazyHomeAssistantNavbarController(card, options),
  createPageBackgroundController: (card) =>
    new HomeAssistantPageBackgroundController(card),
});

export const createHomeAssistantDashboardControllers = (
  card,
  {
    deviceProfile = DEVICE_PROFILE,
    factories = DEFAULT_FACTORIES,
  } = {},
) => {
  const resolvedFactories = { ...DEFAULT_FACTORIES, ...factories };
  const haNavbarController = resolvedFactories.createNavbarController(card, {
    cardTag: SUPPORTED_CARD_TAGS,
    isMobile: deviceProfile.isMobile,
    isPhone: deviceProfile.isPhone,
    isIOS: deviceProfile.isIOS,
  });
  const haDashboardSwipeNavigationController =
    resolvedFactories.createDashboardSwipeNavigationController(card, {
      hasTouch: deviceProfile.hasTouch,
      resolveInternalPageTarget: (direction, swipePolicy) =>
        card._pageNavigationController?.resolveSwipePageTarget?.(
          direction,
          swipePolicy?.mode,
        ) || null,
      resolveDashboardBoundaryPage: ({
        direction,
        transition,
        swipePolicy,
      }) =>
        card._pageNavigationController?.resolveDashboardSwipeBoundaryPage?.({
          direction,
          transition,
          swipeMode: swipePolicy?.mode,
        }) || null,
      allowDashboardNavigation: () =>
        card._pageNavigationController?.allowsDashboardPageSwipe?.() !== false,
      isNavigationEnabled: () =>
        card._pageNavigationController?.isSwipeNavigationEnabled?.() !== false,
      navigateInternalPage: (pageId) =>
        card._pageNavigationController?.navigateToPageRoute?.(pageId, {
          source: "dashboard-swipe",
        }) === pageId,
      onDashboardNavigationSettled: () =>
        card._handleDashboardSwipeNavigationSettled(),
      onDashboardScopeExited: () => card._handleDashboardScopeExited(),
      cardTag: SUPPORTED_CARD_TAGS,
      enforceDashboardOwner: true,
      isSwipeNavigationOwner: () =>
        card._config?.ha_dashboard_swipe_navigation_owner === true,
    });
  const haPageBackgroundController =
    resolvedFactories.createPageBackgroundController(card);

  return {
    _haNavbarController: haNavbarController,
    _haDashboardSwipeNavigationController:
      haDashboardSwipeNavigationController,
    _haPageBackgroundController: haPageBackgroundController,
  };
};
