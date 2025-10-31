// background.js (fixed)
// - Stores detected mod list separately and exposes only mods to popup
// - Writes a pendingRandomization event to storage and only runtime.sendMessage
//   if a popup view is open (avoids sending to unloaded popup)
// - Redirect delay for manual randomize = 3000ms so popup shows redirect message
// - Adds console logs for toggles/saves/alarms/randomization events

const MAX_LAST_RANDOMIZATION_AGE = 24 * 60 * 60 * 1000;
const MIN_RANDOMIZE_MINUTES = 0.25; // 15s for testing
const MIN_COOLDOWN_MS = 5000;
const IDENTIFY_THROTTLE_MS = 1500;

let identifyInFlight = null;
let lastIdentifyAt = 0;

let redirectTimeout = null;
let randomizationInProgress = false;

// Track popup connection
let popupPort = null;

// ---------- Storage helper ----------
const storage = {
    get(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); },
    set(obj)  { return new Promise(resolve => chrome.storage.local.set(obj, resolve)); },
    remove(k) { return new Promise(resolve => chrome.storage.local.remove(k, resolve)); }
};

const management = {
    getAll() { return new Promise(resolve => chrome.management.getAll(resolve)); },
    setEnabled(id, enabled) { return new Promise(resolve => chrome.management.setEnabled(id, enabled, () => resolve())); }
};

function nowMs() { return Date.now(); }

// ---------- Port-based delivery ----------
async function tryDeliverToPopup(message) {
    if (popupPort) {
        try {
            popupPort.postMessage(message);
            console.log('Delivered to popup via port:', message.action);
            return true;
        } catch (e) {
            console.warn('Port delivery failed, clearing popupPort', e);
            popupPort = null;
        }
    }
    return new Promise(resolve => {
        chrome.runtime.sendMessage(message, (res) => {
            if (chrome.runtime.lastError) {
                console.debug('runtime.sendMessage fallback failed', chrome.runtime.lastError.message);
                resolve(false);
            } else {
                console.log('runtime.sendMessage fallback returned, may not be consumed');
                resolve(true);
            }
        });
    });
}

chrome.runtime.onConnect.addListener((port) => {
    if (port && port.name === 'popup') {
        popupPort = port;
        console.log('Background: popup connected via port');

        port.onMessage.addListener(async (msg) => {
            if (!msg || !msg.action) return;

            if (msg.action === 'popupReady') {
                const { pendingRandomization } = await storage.get('pendingRandomization');
                if (pendingRandomization && pendingRandomization.enabledExtension) {
                    popupPort.postMessage({
                        action: 'randomizationCompleted',
                        enabledExtension: pendingRandomization.enabledExtension,
                        pendingId: pendingRandomization.timestamp
                    });
                    console.log('Sent pendingRandomization via port to popup');
                }
            } else if (msg.action === 'randomizationAck') {
                await storage.remove('pendingRandomization');
                console.log('Cleared pendingRandomization after ACK');
            }
        });

        port.onDisconnect.addListener(() => {
            console.log('Popup port disconnected');
            popupPort = null;
        });
    }
});

// ---------- Identification ----------
async function identifyModExtensions() {
    if (identifyInFlight) return identifyInFlight;
    const now = Date.now();
    if (now - lastIdentifyAt < IDENTIFY_THROTTLE_MS) {
        const cached = await storage.get('detectedModList');
        return cached.detectedModList || [];
    }
    identifyInFlight = (async () => {
        try {
            const all = await management.getAll();
            const detectedIds = all
                .filter(e => e.updateUrl === 'https://api.gx.me/store/mods/update')
                .map(e => ({ id: e.id, name: e.name }));
            await storage.set({ detectedModList: detectedIds });
            lastIdentifyAt = Date.now();
            console.log('identifyModExtensions -> detected', detectedIds.length, 'mods');
            return detectedIds;
        } catch (err) {
            console.error('identifyModExtensions error', err);
            return [];
        } finally {
            identifyInFlight = null;
        }
    })();
    return identifyInFlight;
}

async function ensureDefaults() {
    const s = await storage.get(['profiles', 'activeProfile']);
    if (!s.profiles) {
        const detected = await storage.get('detectedModList');
        const detectedIds = Array.isArray(detected.detectedModList)
            ? detected.detectedModList.map(m => m.id)
            : [];

        const profiles = { Default: detectedIds };
        await storage.set({ profiles, activeProfile: 'Default' });
        console.log(`Initialized default profile with ${detectedIds.length} mods`);
    }
}

const CATALOG_URL = 'https://raw.githubusercontent.com/GoldenShirt/Mod-randomizer-for-Opera-GX/main/url-catalog.json';
let catalog = {};
// Load catalog immediately on background startup
loadCatalog();


// Load static catalog on startup
async function loadCatalog() {
    try {
        const res = await fetch(CATALOG_URL);
        catalog = await res.json();
        console.log('Catalog loaded:', Object.keys(catalog).length, 'mods');
    } catch (err) {
        console.error('Failed to load catalog:', err);
    }
}

// Function to get a mod URL by name
// ---------------------- getModUrlByName ----------------------
async function getModUrlByName(modName) {
    console.log(`[getModUrlByName] Looking for URL of mod: "${modName}"`);

    // Check catalog first
    if (catalog[modName] && catalog[modName].url) {
        console.log(`[getModUrlByName] Found in catalog:`, catalog[modName].url);
        return catalog[modName].url;
    } else {
        console.log(`[getModUrlByName] Not found in catalog for name: "${modName}"`);
    }

    // Check newly installed mods
    const storageData = await chrome.storage.local.get(['newMods']);
    const newMods = storageData.newMods || {};
    const found = Object.values(newMods).find(m => m.name === modName);
    if (found && found.url) {
        console.log(`[getModUrlByName] Found in newMods storage:`, found.url);
        return found.url;
    } else {
        console.log(`[getModUrlByName] Not found in newMods storage for: "${modName}"`);
    }

    // Fallback
    console.warn(`[getModUrlByName] No URL found for "${modName}"`);
    return null; // temporarily remove fallback to mods/manage
}


// Add only newly detected mods to all profiles when randomize-all is OFF.
// Maintain a persistent set of knownDetectedIds so previously unchecked mods stay unchecked.
async function addDetectedModsToAllProfiles(autoIdentify /* randomizeAllMods */) {
    const [detectedWrapper, profilesWrapper, knownWrapper] = await Promise.all([
        storage.get('detectedModList'),
        storage.get(['profiles', 'activeProfile']),
        storage.get('knownDetectedIds')
    ]);

    const detectedList = detectedWrapper.detectedModList || [];
    const detectedIds = detectedList.map(m => m.id);
    const profiles = profilesWrapper.profiles || {};

    // Ensure there is at least a Default profile
    if (!Object.keys(profiles).length) profiles['Default'] = [];

    // Build set of previously known ids (persisted)
    const knownDetectedIds = Array.isArray(knownWrapper.knownDetectedIds) ? new Set(knownWrapper.knownDetectedIds) : new Set();

    // Compute only genuinely new ids (newly installed mods since last time)
    const newIds = detectedIds.filter(id => !knownDetectedIds.has(id));

    let mutated = false;

    // Only mutate profiles when randomize-all is OFF, and only by adding newIds
    if (!autoIdentify && newIds.length) {
        for (const profileName of Object.keys(profiles)) {
            const set = new Set(profiles[profileName] || []);
            let addedCount = 0;
            for (const id of newIds) {
                if (!set.has(id)) {
                    profiles[profileName].push(id); // add new mod ON for all profiles
                    addedCount++;
                }
            }
            if (addedCount > 0) {
                console.log(`identify: added ${addedCount} new mod(s) to profile '${profileName}'`);
                mutated = true;
            }
        }
    }

    // Update knownDetectedIds to include all currently detected ids (union)
    const updatedKnown = Array.from(new Set([...knownDetectedIds, ...detectedIds]));
    // Persist storage updates atomically
    if (mutated) {
        await storage.set({ profiles, knownDetectedIds: updatedKnown });
    } else {
        await storage.set({ knownDetectedIds: updatedKnown });
    }

    return { detected: detectedList, profiles };
}
// ---------- Randomization ----------
// ---------------------- handleModEnableWorkflow ----------------------
async function handleModEnableWorkflow(modIdsForRandomization, uninstallAndReinstall, source) {
    console.log(`[handleModEnableWorkflow] Starting workflow. Mods:`, modIdsForRandomization, `uninstallAndReinstall:`, uninstallAndReinstall);

    if (!modIdsForRandomization || modIdsForRandomization.length === 0) {
        console.warn('[handleModEnableWorkflow] No mods to randomize');
        return null;
    }
    const s = await storage.get(['lastEnabledModId']);
    const lastEnabled = s.lastEnabledModId;
    const all = await management.getAll();
    const mods = all.filter(e => modIdsForRandomization.includes(e.id));

    if (!mods.length) {
        console.warn('[handleModEnableWorkflow] No mods found in management');
        return null;
    }

    // Disable currently enabled mods
    const currentlyEnabled = mods.filter(m => m.enabled);
    await Promise.all(currentlyEnabled.map(m => management.setEnabled(m.id, false)));

    // Pick new candidate (not last enabled)
    const candidates = mods.filter(m => m.id !== lastEnabled);
    if (!candidates.length) return null;

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    console.log(`[handleModEnableWorkflow] Selected mod: ${selected.name} (id: ${selected.id})`);

    // This function now only handles MANUAL randomization (alarm/startup handled separately)
    if (source !== "manual") {
        console.warn('[handleModEnableWorkflow] Called with non-manual source - this should not happen');
        return null;
    }

    if (uninstallAndReinstall) {
        // MANUAL + UNINSTALL MODE
        const reinstallUrl = await getModUrlByName(selected.name);
        if (!reinstallUrl) {
            console.log('[handleModEnableWorkflow] Reinstall url is null, enabling instead')
            // Fallback: Enable and redirect to mods tab
            await management.setEnabled(selected.id, true);
            await storage.set({ lastEnabledModId: selected.id, currentMod: selected.name });
            console.log(`[handleModEnableWorkflow] Enabled mod: ${selected.name}`);

            return {
                id: selected.id,
                name: selected.name,
                modsTabUrl: 'opera://configure/mods/manage',
                reinstallUrl: null
            };
        } else {
            console.log(`[handleModEnableWorkflow] Sending uninstall request to popup for mod: ${selected.name}`);
            await storage.set({ lastEnabledModId: selected.id, currentMod: selected.name });
            return { id: selected.id, name: selected.name, reinstallUrl };
        }
    } else {
        // MANUAL + ENABLE MODE
        await management.setEnabled(selected.id, true);
        await storage.set({ lastEnabledModId: selected.id, currentMod: selected.name });
        console.log(`[handleModEnableWorkflow] Enabled mod: ${selected.name}`);

        // Check if "Open mods tab" is enabled
        const { openModsTabChecked } = await storage.get('openModsTabChecked');
        const shouldRedirect = openModsTabChecked === undefined ? true : !!openModsTabChecked;

        return {
            id: selected.id,
            name: selected.name,
            modsTabUrl: shouldRedirect ? 'opera://configure/mods/manage' : null
        };
    }


}// ---------------------- executeRandomization ----------------------
async function executeRandomization(source = 'unknown', redirectDelayMs = 3000) {
    console.log(`[executeRandomization] Source: ${source}`);
    try {
        const s = await storage.get([
            'profiles',
            'activeProfile',
            'uninstallAndReinstallChecked',
            'autoModIdentificationChecked',
            'openModsTabChecked',
            'showNotificationsChecked'
        ]);
        const { detectedModList = [] } = await storage.get('detectedModList');
        const useAll = !!s.autoModIdentificationChecked;
        const activeList = useAll ? detectedModList.map(m => m.id) : (s.profiles?.[s.activeProfile] || []);

        // Special handling for auto randomization (alarm/startup)
        if (source === 'alarm' || source === 'startup') {
            const all = await management.getAll();
            const mods = all.filter(e => activeList.includes(e.id));
            const lastEnabled = (await storage.get('lastEnabledModId')).lastEnabledModId;
            const candidates = mods.filter(m => m.id !== lastEnabled);

            if (!candidates.length) return null;

            const selected = candidates[Math.floor(Math.random() * candidates.length)];

            // Delay before showing notification: 5s for startup, 0.5s for alarm
            const notificationDelay = source === 'startup' ? 5000 : 500;

            // Check if notifications are disabled
            if (!s.showNotificationsChecked) {
                // No notifications: just disable current, enable random, no redirect
                const currentlyEnabled = mods.filter(m => m.enabled);
                await Promise.all(currentlyEnabled.map(m => management.setEnabled(m.id, false)));
                await management.setEnabled(selected.id, true);
                await storage.set({ lastEnabledModId: selected.id, currentMod: selected.name });
                console.log(`Auto randomization (no notifications): enabled ${selected.name}, no redirect`);
                return null;
            }

            if (s.uninstallAndReinstallChecked) {
                // UNINSTALL MODE: Disable mods first, then show notification after delay
                const currentlyEnabled = mods.filter(m => m.enabled);
                await Promise.all(currentlyEnabled.map(m => management.setEnabled(m.id, false)));

                const reinstallUrl = await getModUrlByName(selected.name);

                // Update storage before showing notification
                await storage.set({
                    lastEnabledModId: selected.id,
                    currentMod: selected.name,
                    pendingNotification: {
                        modId: selected.id,
                        modName: selected.name,
                        reinstallUrl: reinstallUrl,
                        uninstallMode: true,
                        timestamp: nowMs()
                    }
                });

                setTimeout(() => {
                    chrome.notifications.create('modRandomizerAlert', {
                        type: 'basic',
                        iconUrl: 'icons/icon_128.png',
                        title: 'Mod Randomizer',
                        message: `Ready to switch to: ${selected.name}\n\nClick to uninstall and reinstall.`,
                        requireInteraction: true
                    });
                    console.log(`Auto randomization (uninstall mode): notification created for ${selected.name}`);
                }, notificationDelay);

                return null;
            } else {
                // ENABLE MODE: Disable others, enable selected, show notification after delay
                const currentlyEnabled = mods.filter(m => m.enabled);
                await Promise.all(currentlyEnabled.map(m => management.setEnabled(m.id, false)));
                await management.setEnabled(selected.id, true);
                await storage.set({ lastEnabledModId: selected.id, currentMod: selected.name });

                console.log(`Auto randomization (enable mode): enabled ${selected.name}, showing notification after delay`);

                // Check if open mods tab is enabled
                const shouldRedirect = s.openModsTabChecked;

                setTimeout(() => {
                    // Show notification
                    const message = shouldRedirect
                        ? `Enabled: ${selected.name}\n\nRedirecting to mods tab...`
                        : `Enabled: ${selected.name}`;

                    chrome.notifications.create('modRandomizerAlert', {
                        type: 'basic',
                        iconUrl: 'icons/icon_128.png',
                        title: 'Mod Randomizer',
                        message: message,
                        requireInteraction: false
                    });

                    if (shouldRedirect) {
                        setTimeout(() => {
                            chrome.tabs.create({ url: 'opera://configure/mods/manage' });
                            chrome.notifications.clear('modRandomizerAlert');
                        }, 3000);
                    } else {
                        // Auto-clear notification after a few seconds if no redirect
                        setTimeout(() => {
                            chrome.notifications.clear('modRandomizerAlert');
                        }, 5000);
                    }
                }, notificationDelay);

                return null;
            }
        }

        // Only manual randomization reaches here (alarm/startup already returned)
        const result = await handleModEnableWorkflow(activeList, s.uninstallAndReinstallChecked, source);

        if (result) {
            const pending = { enabledExtension: result, timestamp: nowMs() };
            await storage.set({ pendingRandomization: pending });
            // Only try to deliver if it's manual (popup is open)
            if (source === 'manual') {
                tryDeliverToPopup({ action: 'randomizationCompleted', enabledExtension: result, pendingId: pending.timestamp });
            }
        }

        return result;
    } catch (err) {
        console.error('[executeRandomization] error', err);
        return null;
    }
}
// Handle notification clicks - only for uninstall mode
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId === 'modRandomizerAlert') {
        // Use callback-based storage to preserve user gesture synchronously
        chrome.storage.local.get('pendingNotification', (result) => {
            const pendingNotification = result.pendingNotification;
            if (!pendingNotification) return;

            // Only handle uninstall mode clicks (enable mode notification is informational only)
            if (!pendingNotification.uninstallMode) {
                console.log('Notification clicked but enable mode - no action needed');
                return;
            }

            console.log(`Notification clicked for ${pendingNotification.modName} - triggering uninstall`);

            // Clear notification immediately
            chrome.notifications.clear(notificationId);

            // Trigger uninstall IMMEDIATELY using this click event (user gesture) - MUST be synchronous
            chrome.management.uninstall(pendingNotification.modId, { showConfirmDialog: true }, () => {
                if (chrome.runtime.lastError) {
                    console.log('Uninstall cancelled by user');
                } else {
                    console.log('Mod uninstalled successfully from notification');
                }
                // Clear storage after uninstall completes (whether cancelled or not)
                chrome.storage.local.remove('pendingNotification');
            });

            // Redirect immediately (don't wait for uninstall to complete)
            if (pendingNotification.reinstallUrl) {
                chrome.tabs.create({ url: pendingNotification.reinstallUrl });
            }
        });
    }
});

// Clean up on notification dismiss
chrome.notifications.onClosed.addListener(async (notificationId) => {
    if (notificationId === 'modRandomizerAlert') {
        await storage.remove('pendingNotification');
        console.log('Notification dismissed, cleared pending action');
    }
});
// ---------- Alarms & Scheduling ----------
async function setRandomizeTime(minutes) {
  const parsed = parseFloat(minutes);
  if (isNaN(parsed)) {
    console.warn('setRandomizeTime -> invalid number', minutes);
    return;
  }

  // Clear existing alarm first
  chrome.alarms.clear('randomizeAlarm', () => {
    // then schedule if needed
    if (parsed === 0) {
      storage.set({ randomizeTime: parsed });
      console.log('setRandomizeTime -> disabled (0)');
      return;
    }
    if (parsed < MIN_RANDOMIZE_MINUTES) {
      console.warn(`setRandomizeTime -> refused to set below ${MIN_RANDOMIZE_MINUTES} minutes.`);
      return;
    }

    storage.set({ randomizeTime: parsed }).then(() => {
      chrome.alarms.create('randomizeAlarm', { delayInMinutes: parsed, periodInMinutes: parsed });
      console.log(`setRandomizeTime -> scheduled randomizeAlarm every ${parsed} minutes`);
    });
  });
}

// ---------- Message handling ----------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'identifyModExtensions': {
          const detected = await identifyModExtensions();
          const s = await storage.get('autoModIdentificationChecked');
          // Only add genuinely new mods when randomize-all is OFF
          await addDetectedModsToAllProfiles(!!s.autoModIdentificationChecked);
          sendResponse({ status: 'success', detectedModList: detected });
          console.log('Message: identifyModExtensions -> responded');
          break;
        }
        //This handles the direct, synchronous request from the popup's button.
          case 'getRandomMod': {
              console.log('Message: getRandomMod received (direct from popup)');

              // 1. Get the list of mods to choose from
              const { detectedModList = [] } = await storage.get('detectedModList');
              const { autoModIdentificationChecked } = await storage.get('autoModIdentificationChecked');
              const { profiles = {}, activeProfile = 'Default' } = await storage.get(['profiles', 'activeProfile']);

              const useAll = !!autoModIdentificationChecked;
              const activeList = useAll ? detectedModList.map(m => m.id) : (profiles?.[activeProfile] || []);

              // 2. Call your core logic function directly
              const result = await handleModEnableWorkflow(
                  activeList,
                  message.uninstallAndReinstall, // Use the value sent from the popup
                  'manual' // The source is manual
              );

              // 3. Send the result directly back to the waiting popup
              sendResponse(result);
              break;
          }
        case 'getExtensions': {
          // Return only detected mods (so popup shows only mods), plus profiles + activeProfile
          const { detectedModList = [] } = await storage.get('detectedModList');
          const { profiles = {}, activeProfile = 'Default' } = await storage.get(['profiles', 'activeProfile']);
          const { autoModIdentificationChecked = true } = await storage.get('autoModIdentificationChecked');
          sendResponse({ detectedModList, profiles, activeProfile, autoModIdentificationChecked });
          console.log('Message: getExtensions -> returned detectedModList + profiles');
          break;
        }

        case 'saveModExtensionIds': {
          // message.profileName optional - if provided save to that profile; else to activeProfile
          const { modExtensionIds = [], profileName } = message;
          const s = await storage.get(['profiles', 'activeProfile']);
          const profiles = s.profiles || {};
          const active = profileName || s.activeProfile || 'Default';
          profiles[active] = Array.isArray(modExtensionIds) ? modExtensionIds : [];
          await storage.set({ profiles });
          console.log(`Saved ${profiles[active].length} ids to profile '${active}'`);
          sendResponse({ status: 'success' });
          break;
        }

        case 'randomizeMods': {
          // Manual randomize: allow redirect after a short delay so popup shows redirect message
          console.log('Message: randomizeMods received (manual)');
          const result = await executeRandomization('manual', 3000); // 3s delay so popup shows redirect message
          if (result) sendResponse({ status: 'success', enabledExtension: result });
          else sendResponse({ status: 'error', message: 'No mod enabled' });
          break;
        }

        case 'popupOpened': {
          const { autoModIdentificationChecked } = await storage.get('autoModIdentificationChecked');
          await identifyModExtensions();
          await addDetectedModsToAllProfiles(!!autoModIdentificationChecked);
          console.log('popupOpened -> identification done (profiles updated only for newly detected mods and only if randomize-all OFF)');
          // Give popup any pendingRandomization and then clear it (popup will display)
          const { pendingRandomization } = await storage.get('pendingRandomization');
          if (pendingRandomization) {
            // Try to send; if popup isn't actively listening, storage fallback remains.
            try {
              chrome.runtime.sendMessage({ action: 'randomizationCompleted', enabledExtension: pendingRandomization.enabledExtension });
              console.log('popupOpened -> sent runtime randomizationCompleted to popup');
            } catch (e) {
              console.debug('popupOpened: runtime.sendMessage likely no listener; popup will read from storage.', e && e.message);
            }
            // Optionally keep or clear pending event; we'll clear so it doesn't show again
            await storage.remove('pendingRandomization');
          }
          sendResponse({ status: 'success' });
          break;
        }

        case 'setRandomizeTime': {
          console.log('Message: setRandomizeTime ->', message.time);
          await setRandomizeTime(message.time);
          sendResponse({ status: 'success' });
          break;
        }

        case 'toggleRandomizeOnSetTimeChecked': {
          console.log('Message: toggleRandomizeOnSetTimeChecked ->', message.value);
          await storage.set({ toggleRandomizeOnSetTimeChecked: message.value });
          if (message.value) {
            const { randomizeTime = 0 } = await storage.get('randomizeTime');
            if (randomizeTime > 0) {
              chrome.alarms.create('randomizeAlarm', { delayInMinutes: randomizeTime, periodInMinutes: randomizeTime });
              console.log('Scheduled randomizeAlarm because toggle enabled and randomizeTime > 0');
            } else {
              console.log('Toggle enabled but randomizeTime is 0, not scheduling alarm');
            }
          } else {
            await new Promise(resolve => {
              chrome.alarms.clear('randomizeAlarm', (wasCleared) => {
                console.log(`Cleared randomizeAlarm because toggle disabled: ${wasCleared}`);
                resolve();
              });
            });
          }
          sendResponse({ status: 'success' });
          break;
        }

        case 'createProfile': {
          const { profileName } = message;
          const name = (profileName || '').trim();
          const { profiles = {} } = await storage.get('profiles');
          if (!name) {
            sendResponse({ status: 'error', message: 'Profile name cannot be empty' });
            break;
          }
          const nameLc = name.toLowerCase();
          if (Object.keys(profiles).some(k => k.toLowerCase() === nameLc)) {
            sendResponse({ status: 'error', message: 'Profile already exists' });
          } else {
            // Initialize the new profile with ALL detected mods checked
            const { detectedModList = [] } = await storage.get('detectedModList');
            const allIds = Array.isArray(detectedModList) ? detectedModList.map(m => m.id) : [];
            profiles[name] = allIds;

            await storage.set({ profiles });
            console.log('Created profile with all mods checked:', name, 'count=', allIds.length);
            sendResponse({ status: 'success' });
          }
          break;
        }

        case 'deleteProfile': {
          const { profileName } = message;
          const data = await storage.get(['profiles', 'activeProfile', 'detectedModList']);
          const profiles = data.profiles || {};
          let active = data.activeProfile || 'Default';

          if (!profiles[profileName]) {
            sendResponse({ status: 'error', message: 'Profile not found' });
            break;
          }

          delete profiles[profileName];

          // Determine remaining profiles
          let remaining = Object.keys(profiles);

          // If none remain, recreate Default with ALL detected mods checked
          if (!remaining.length) {
            const detected = Array.isArray(data.detectedModList) ? data.detectedModList : [];
            profiles['Default'] = detected.map(m => m.id);
            remaining = ['Default'];
            console.log('Recreated Default profile with all detected mods after deletion');
          }

          // Pick a new active if needed
          if (active === profileName) active = remaining[0] || 'Default';

          await storage.set({ profiles, activeProfile: active });
          console.log('Deleted profile', profileName, 'new active', active);
          sendResponse({ status: 'success', activeProfile: active });
          break;
        }

        case 'renameProfile': {
          const { oldName, newName } = message;
          const oldN = (oldName || '').trim();
          const newN = (newName || '').trim();
          const { profiles = {}, activeProfile = 'Default' } = await storage.get(['profiles', 'activeProfile']);
          if (!profiles[oldN]) {
            sendResponse({ status: 'error', message: 'Old profile not found' });
            break;
          }
          if (!newN) {
            sendResponse({ status: 'error', message: 'New profile name cannot be empty' });
            break;
          }
          const oldLc = oldN.toLowerCase();
          const newLc = newN.toLowerCase();
          // If the new name is different (beyond casing) and collides with another profile (case-insensitive), reject
          if (newLc !== oldLc && Object.keys(profiles).some(k => k.toLowerCase() === newLc)) {
            sendResponse({ status: 'error', message: 'New profile name already exists' });
            break;
          }
          // Perform rename (allow case-only change as well)
          profiles[newN] = profiles[oldN];
          delete profiles[oldN];
          const newActive = (activeProfile === oldN) ? newN : activeProfile;
          await storage.set({ profiles, activeProfile: newActive });
          console.log(`Renamed profile ${oldN} -> ${newN}`);
          sendResponse({ status: 'success', activeProfile: newActive });
          break;
        }

        case 'setActiveProfile': {
          const { profileName } = message;
          const name = (profileName || '').trim();
          const { profiles = {} } = await storage.get('profiles');
          if (!profiles[name]) {
            sendResponse({ status: 'error', message: 'Profile not found' });
            break;
          }
          await storage.set({ activeProfile: name });
          console.log('Active profile set to', name);
          sendResponse({ status: 'success' });
          break;
        }

        default:
          console.warn('Unknown message action:', message.action);
          sendResponse({ status: 'error', message: 'Unknown action' });
      }
    } catch (err) {
      console.error('onMessage handling error', err);
      sendResponse({ status: 'error', message: err && err.message });
    }
  })();
  return true;
});

// alarms
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'randomizeAlarm') {
    console.log('Alarm fired: randomizeAlarm');
    await executeRandomization('alarm', 500); // short redirect for alarms
  }
});

// startup & install
chrome.runtime.onStartup.addListener(async () => {
  const s = await storage.get(['toggleRandomizeOnStartupChecked', 'autoModIdentificationChecked']);
  if (s.autoModIdentificationChecked === undefined) {
    await storage.set({ autoModIdentificationChecked: false });
    console.log('Startup: randomize-all missing; set to OFF by default');
  }
  if (s.toggleRandomizeOnStartupChecked) {
    console.log('onStartup -> toggleRandomizeOnStartupChecked true; scheduling startup randomize');
    setTimeout(() => executeRandomization('startup', 5000), 1000);
  }
});

chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'install') {
    // Initialize sensible defaults
    await storage.set({
      toggleRandomizeOnStartupChecked: false,
      autoModIdentificationChecked: false, // randomize-all: OFF by default
      uninstallAndReinstallChecked: true,
      openModsTabChecked: true, // open mods tab: ON by default
      showNotificationsChecked: true, // show notifications: ON by default
      toggleRandomizeOnSetTimeChecked: false,
      randomizeTime: 0,
      currentMod: 'None'
    });
    console.log('Installed: default settings saved (randomize-all OFF)');
    await identifyModExtensions();
    await ensureDefaults();
  } else if (details.reason === 'update') {
    console.log('Extension updated');
    // Migration: if key is missing, default appropriately
    const s = await storage.get(['autoModIdentificationChecked', 'openModsTabChecked', 'showNotificationsChecked']);
    const updates = {};
    if (s.autoModIdentificationChecked === undefined) {
      updates.autoModIdentificationChecked = false;
    }
    if (s.openModsTabChecked === undefined) {
      updates.openModsTabChecked = true;
    }
    if (s.showNotificationsChecked === undefined) {
      updates.showNotificationsChecked = true;
    }
    if (Object.keys(updates).length > 0) {
      await storage.set(updates);
      console.log('Migration: set defaults', updates);
    }
    await identifyModExtensions();
    await ensureDefaults();
  }
});