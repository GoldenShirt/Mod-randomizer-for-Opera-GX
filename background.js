// background.js (fixed)
// - Stores detected mod list separately and exposes only mods to popup
// - Writes a pendingRandomization event to storage and only runtime.sendMessage
//   if a popup view is open (avoids sending to unloaded popup)
// - Redirect delay for manual randomize = 3000ms so popup shows redirect message
// - Adds console logs for toggles/saves/alarms/randomization events

const MAX_LAST_RANDOMIZATION_AGE = 24 * 60 * 60 * 1000;
const MIN_RANDOMIZE_MINUTES = 0.25; // 15s for testing
const MIN_COOLDOWN_MS = 5000;
// Throttle/Coalesce identify calls to avoid duplicate logs
const IDENTIFY_THROTTLE_MS = 1500;
let identifyInFlight = null;
let lastIdentifyAt = 0;

let redirectTimeout = null;
let randomizationInProgress = false;

// Define storage helper object (promise wrappers for chrome.storage.local)
const storage = {
  get(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); },
  set(obj)  { return new Promise(resolve => chrome.storage.local.set(obj, resolve)); }, // IMPORTANT: pass resolve
  remove(k) { return new Promise(resolve => chrome.storage.local.remove(k, resolve)); }
};

// Remove MV3 popup port tracking: we now just attempt sendMessage and treat failures as "not open"
// (previous popupPorts/onConnect logic removed)

const management = {
  getAll() { return new Promise(resolve => chrome.management.getAll(resolve)); },
  setEnabled(id, enabled) { return new Promise(resolve => chrome.management.setEnabled(id, enabled, () => resolve())); }
};

// ---------- Utilities ----------
// Removed isPopupOpen(): no longer needed

function nowMs() { return Date.now(); }

async function logToggle(key, value) {
  console.log(`Toggle saved: ${key} = ${value}`);
  await storage.set({ [key]: value });
}

// ---------- Identification ----------
async function identifyModExtensions() {
  // If a previous identify is in progress, reuse it to avoid duplicate work/logs
  if (identifyInFlight) return identifyInFlight;

  const now = Date.now();
  // If called again very soon after the last full identify, serve from storage without re-logging
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

// ---------- Profiles & Mod storage ----------
// Storage layout minimal keys used here:
// profiles: { [profileName]: [ids...] }
// activeProfile: string
// detectedModList: [{id,name}, ...]
// pendingRandomization: { enabledExtension, timestamp }   // last randomize not yet consumed by popup

async function ensureDefaults() {
  const s = await storage.get(['profiles', 'activeProfile']);
  if (!s.profiles) {
    // initialize a default profile that preserves previous single-list behavior if present
    const prev = await storage.get('modExtensionIds');
    const defaultList = Array.isArray(prev.modExtensionIds) ? prev.modExtensionIds : [];
    const profiles = { Default: defaultList };
    await storage.set({ profiles, activeProfile: 'Default' });
    console.log('Initialized default profiles');
  }
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
async function handleModEnableWorkflow(modIdsForRandomization) {
  // modIdsForRandomization: array of extension IDs to use for randomization
  if (!modIdsForRandomization || modIdsForRandomization.length === 0) {
    console.log('No mods in active profile to randomize.');
    return null;
  }

  // Get last enabled mod to avoid immediate repeat
  const s = await storage.get('lastEnabledModId');
  const lastEnabled = s.lastEnabledModId;

  // Get current extensions from management to see which are part of the set
  const all = await management.getAll();
  const mods = all.filter(e => modIdsForRandomization.includes(e.id));

  if (!mods.length) {
    console.log('handleModEnableWorkflow -> no matching installed mod extensions.');
    return null;
  }

  // Disable any that are currently enabled (normalize state)
  await Promise.all(mods.filter(m => m.enabled).map(m => management.setEnabled(m.id, false)));

  // IMPORTANT: Don't rely on stale m.enabled flags after disabling.
  // Select a candidate solely by excluding the lastEnabled id to avoid repeats.
  // If this leaves no candidates (e.g., only one mod that equals lastEnabled), skip enabling to honor "no repeat".
  const candidates = mods.filter(m => m.id !== lastEnabled);
  if (candidates.length === 0) {
    console.log('No candidates available that differ from last enabled; skipping to avoid repeat.');
    return null;
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  await management.setEnabled(selected.id, true);
  await storage.set({ lastEnabledModId: selected.id, currentMod: selected.name });

  console.log(`Randomize -> enabled ${selected.name} (${selected.id})`);
  return { id: selected.id, name: selected.name };
}

async function executeRandomization(source = 'unknown', redirectDelayMs = 3000) {
  // source: 'manual' | 'startup' | 'alarm' etc
  try {
    if (randomizationInProgress && source !== 'manual') {
      console.log(`Skipping ${source} randomization — already in progress`);
      return null;
    }

    const now = nowMs();
    const s = await storage.get('lastRandomizationTime');
    let lastRandomizationTime = s.lastRandomizationTime;
    // clean old marker
    if (lastRandomizationTime && (now - lastRandomizationTime) > MAX_LAST_RANDOMIZATION_AGE) {
      await storage.remove('lastRandomizationTime');
      lastRandomizationTime = null;
    }
    if (source !== 'manual' && lastRandomizationTime && (now - lastRandomizationTime) < MIN_COOLDOWN_MS) {
      console.log(`Skipping ${source} randomization — cooldown`);
      return null;
    }

    if (source !== 'manual') {
      randomizationInProgress = true;
      await storage.set({ lastRandomizationTime: now });
    }

    // read active profile and profiles + randomize-all flag and detected list
    const {
      profiles = {},
      activeProfile = 'Default',
      toggleOpenModsTabChecked = true,
      autoModIdentificationChecked = false
    } = await storage.get(['profiles', 'activeProfile', 'toggleOpenModsTabChecked', 'autoModIdentificationChecked']);
    const { detectedModList = [] } = await storage.get('detectedModList');

    // Determine which list to use:
    // - randomize-all ON -> use all detected mods
    // - randomize-all OFF -> use the saved checks of the active profile
    const useAll = !!autoModIdentificationChecked;
    const activeList = useAll
      ? detectedModList.map(m => m.id)
      : (profiles[activeProfile] || []);

    if (!activeList.length) {
      console.log('executeRandomization -> no mods to randomize (list is empty)');
      if (source !== 'manual') randomizationInProgress = false;
      return null;
    }

    const result = await handleModEnableWorkflow(activeList);

    // store pending randomization so popup can pick it up when opened even if it wasn't open now
    if (result) {
      const pending = { enabledExtension: result, timestamp: nowMs() };
      await storage.set({ pendingRandomization: pending });
      console.log('Stored pendingRandomization for popup consumption:', pending);
    }

    // Always attempt to notify popup; treat failures as "popup not open"
    try {
      chrome.runtime.sendMessage({ action: 'randomizationCompleted', enabledExtension: result });
      // We delivered it live; prevent showing it again on next popup open
      await storage.set({ pendingRandomization: null });
      console.log('Sent runtime message to popup: randomizationCompleted');
    } catch (e) {
      // Non-fatal; leave pendingRandomization for popup to read
      console.debug('runtime.sendMessage (randomizationCompleted) likely no listener; will rely on pending.', e && e.message);
    }

    // If open mods tab is enabled, schedule redirect after redirectDelayMs
    if (result && toggleOpenModsTabChecked) {
      if (redirectTimeout) clearTimeout(redirectTimeout);
      redirectTimeout = setTimeout(() => {
        chrome.tabs.create({ url: 'opera://mods/manage' }, () => { redirectTimeout = null; });
        console.log('Redirected to opera://mods/manage');
      }, redirectDelayMs);
      console.log(`Scheduled redirect to mods/manage in ${redirectDelayMs}ms`);
    }

    if (source !== 'manual') randomizationInProgress = false;
    return result;
  } catch (err) {
    console.error('executeRandomization error', err);
    if (source !== 'manual') randomizationInProgress = false;
    return null;
  }
}

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
            }
          } else {
            chrome.alarms.clear('randomizeAlarm');
            console.log('Cleared randomizeAlarm because toggle disabled');
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
    await storage.set({ autoModIdentificationChecked: true });
    console.log('Startup: randomize-all missing; set to ON by default');
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
      autoModIdentificationChecked: true, // randomize-all: ON by default
      toggleOpenModsTabChecked: true,
      toggleRandomizeOnSetTimeChecked: false,
      randomizeTime: 0,
      currentMod: 'None'
    });
    console.log('Installed: default settings saved (randomize-all ON)');
    await identifyModExtensions();
    await ensureDefaults();
  } else if (details.reason === 'update') {
    console.log('Extension updated');
    // Migration: if key is missing, default to true (randomize-all ON)
    const s = await storage.get('autoModIdentificationChecked');
    if (s.autoModIdentificationChecked === undefined) {
      await storage.set({ autoModIdentificationChecked: true });
      console.log('Migration: set randomize-all ON (autoModIdentificationChecked=true)');
    }
    await identifyModExtensions();
    await ensureDefaults();
  }
});