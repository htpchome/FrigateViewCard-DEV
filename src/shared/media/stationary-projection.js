// Project media through nested shadow roots without reparenting its subtree.
export function createStationaryMediaProjection({ anchor, name }) {
  if (!anchor?.shadowRoot) throw new Error("A connected shadow host is required");
  const documentRef = anchor.ownerDocument;
  const deck = documentRef.createElement("div");
  deck.slot = name;
  deck.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:2";
  anchor.appendChild(deck);
  let relays = [];
  let target = null;
  const observer = new MutationObserver(() => {
    if (target?.isConnected) project(target);
  });

  const clear = () => {
    observer.disconnect();
    for (const relay of relays) relay.remove();
    relays = [];
    target = null;
  };

  const project = (slot) => {
    if (!slot?.isConnected || slot.localName !== "slot") return false;
    if (target === slot && relays.every((relay) => relay.isConnected)) return true;
    const path = [];
    let node = slot;
    let destination = slot.name;
    while (node) {
      const host = node.getRootNode()?.host;
      if (host === anchor) break;
      if (!host) return false;
      path.push({ host, destination });
      destination = name;
      node = host;
    }
    if (node.getRootNode()?.host !== anchor) return false;
    // Change only the slot chain, never the deck or any player descendants.
    clear();
    deck.slot = path.length ? name : slot.name;
    for (const { host, destination: slotName } of path) {
      const relay = documentRef.createElement("slot");
      relay.name = name;
      relay.slot = slotName;
      host.appendChild(relay);
      relays.push(relay);
    }
    target = slot;
    for (const { host } of path) observer.observe(host, { childList: true });
    return true;
  };

  return {
    deck,
    project,
    clear,
    dispose: () => {
      clear();
      deck.remove();
    },
  };
}
