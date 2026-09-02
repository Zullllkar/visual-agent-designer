export function assetLinkDrawStyle(highlighted: boolean) {
  return {
    strokeOpacity: highlighted ? 0.82 : 0.32,
    strokeWidth: highlighted ? 1.75 : 1.25,
    markerOpacity: highlighted ? 0.85 : 0.2,
    showLabel: highlighted,
    showMarker: highlighted,
  };
}
