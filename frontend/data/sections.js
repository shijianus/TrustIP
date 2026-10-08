// Main section IDs.
//
// Each one is the `<h2 id>` a section component renders, and the key its
// mounting/loading status is filed under in the store. They are no longer scroll
// targets on `/` — each section now has a page of its own, reached through
// data/rail.js, which is what maps an id to a route and a component.
//

export const SECTION_IDS = [
  'IPInfo',
  'Connectivity',
  'WebRTC',
  'DNSLeakTest',
  'SpeedTest',
  'AdvancedTools',
];

// Loading semantics only apply to the four sections that actually run async
// network tests on mount. SpeedTest and AdvancedTools mount but have no
// orchestrator-tracked loading phase. Listed explicitly (not derived via
// slice) so future reorders of SECTION_IDS don't silently change membership.
const LOADING_SECTIONS = [
  'IPInfo',
  'Connectivity',
  'WebRTC',
  'DNSLeakTest',
];

function createStatusObject(keys) {
  return Object.fromEntries(keys.map((key) => [key, false]));
}

/** Returns a fresh mountingStatus initial object */
export function createMountingStatus() {
  return createStatusObject(SECTION_IDS);
}

/** Returns a fresh loadingStatus initial object */
export function createLoadingStatus() {
  return createStatusObject(LOADING_SECTIONS);
}
