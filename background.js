// background.js (fixed)
// - Stores detected mod list separately and exposes only mods to popup
// - Writes a pendingRandomization event to storage and only runtime.sendMessage
//   if a popup view is open (avoids sending to unloaded popup)
// - Redirect delay for manual randomize = 3000ms so popup shows redirect message
// - Adds console logs for toggles/saves/alarms/randomization events

const MAX_LAST_RANDOMIZATION_AGE = 24 * 60 * 60 * 1000;
const MIN_RANDOMIZE_MINUTES = 0.25; // 15s for testing
const MIN_COOLDOWN_MS = 5000;

let redirectTimeout = null;
let randomizationInProgress = false;

// Define storage helper object (promise wrappers for chrome.storage.local)
const storage = {
  get(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); },
  set(obj)  { return new Promise(resolve => chrome.storage.local.set(obj, resolve)); },
  remove(k) { return new Promise(resolve => chrome.storage.local.remove(k, resolve)); }
};

// Track live popup connections (MV3-safe)
const popupPorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.add(port);
    port.onDisconnect.addListener(() => popupPorts.delete(port));
  }
});

const management = {
  getAll() { return new Promise(resolve => chrome.management.getAll(resolve)); },
  setEnabled(id, enabled) { return new Promise(resolve => chrome.management.setEnabled(id, enabled, () => resolve())); }
};

// ---------- Utilities ----------
function isPopupOpen() {
  // MV3 service workers: detect popup via live Port connections
  return popupPorts.size > 0;
}

function nowMs() { return Date.now(); }

async function logToggle(key, value) {
  console.log(`Toggle saved: ${key} = ${value}`);
  await storage.set({ [key]: value });
}

// ---------- Identification ----------
async function identifyModExtensions() {
  try {
    const all = await management.getAll();
    const detectedIds = all
      .filter(e => e.updateUrl === 'https://api.gx.me/store/mods/update')
      .map(e => ({ id: e.id, name: e.name }));

    // store detected list (ids + names) for popup rendering and for new/add logic
    await storage.set({ detectedModList: detectedIds });
    console.log('identifyModExtensions -> detected', detectedIds.length, 'mods');
    return detectedIds;
  } catch (err) {
    console.error('identifyModExtensions error', err);
    return [];
  }
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

// Add detected mods to active profile (if auto-identify enabled) or ensure they appear in UI (but unchecked)
async function addDetectedModsToActiveProfile(autoIdentify) {
  const [detectedWrapper, profilesWrapper] = await Promise.all([
    storage.get('detectedModList'),
    storage.get(['profiles', 'activeProfile'])
  ]);
  const detected = detectedWrapper.detectedModList || [];
  const profiles = profilesWrapper.profiles || {};
  const active = profilesWrapper.activeProfile || 'Default';

  if (!profiles[active]) profiles[active] = [];

  // Build a set of existing ids in the profile
  const profileSet = new Set(profiles[active]);

  // Add new detected mods to profile if autoIdentify === true
  let added = false;
  for (const m of detected) {
    if (!profileSet.has(m.id)) {
      if (autoIdentify) {
        profiles[active].push(m.id);
        added = true;
        console.log(`identify: added detected mod ${m.name} (${m.id}) to profile '${active}'`);
      } else {
        // if not auto, keep them out of the profile but ensure UI can show them from detectedModList
        // we don't change the profile in this case
      }
    }
  }
  if (added) {
    await storage.set({ profiles });
  }
  return { detected, profiles, active };
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

  // Get current extensions from management to see which are disabled and available
  const all = await management.getAll();
  const mods = all.filter(e => modIdsForRandomization.includes(e.id));

  if (!mods.length) {
    console.log('handleModEnableWorkflow -> no matching installed mod extensions.');
    return null;
  }

  // disable any that are currently enabled (to get to a known state)
  await Promise.all(mods.filter(m => m.enabled).map(m => management.setEnabled(m.id, false)));

  // Candidates are disabled mods not equal to lastEnabled (if available)
  let candidates = mods.filter(m => !m.enabled && m.id !== lastEnabled);
  if (candidates.length === 0) {
    // If nothing excluding lastEnabled, skip (preserve previous logic)
    console.log('No disabled candidates excluding last enabled; skipping selection to avoid toggling previous.');
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

    // read active profile and profiles
    const { profiles = {}, activeProfile = 'Default', toggleOpenModsTabChecked = true } =
      await storage.get(['profiles', 'activeProfile', 'toggleOpenModsTabChecked']);

    const activeList = profiles[activeProfile] || [];
    if (!activeList.length) {
      console.log('executeRandomization -> active profile has no mods to randomize');
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

    // If popup open, send runtime message (safe)
    if (isPopupOpen()) {
      try {
        chrome.runtime.sendMessage({ action: 'randomizationCompleted', enabledExtension: result });
        // We delivered it live; prevent showing it again on next popup open
        await storage.set({ pendingRandomization: null });
        console.log('Sent runtime message to popup: randomizationCompleted');
      } catch (e) {
        // Non-fatal; leave pendingRandomization for popup to read
        console.warn('runtime.sendMessage to popup failed (ignored)', e && e.message);
      }
    } else {
      console.log('Popup not open — skip runtime message, popup will read pendingRandomization on open');
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
        case 'identifyModExtensions':
          {
            const detected = await identifyModExtensions();
            // After detection, possibly add to profile if autoIdentify on
            const s = await storage.get('autoModIdentificationChecked');
            await addDetectedModsToActiveProfile(!!s.autoModIdentificationChecked);
            sendResponse({ status: 'success', detectedModList: detected });
            console.log('Message: identifyModExtensions -> responded');
          }
          break;

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
          // When popup opens, ensure identification if autoIdentify enabled and return pendingRandomization if any
          const { autoModIdentificationChecked } = await storage.get('autoModIdentificationChecked');
          if (autoModIdentificationChecked) {
            await identifyModExtensions();
            await addDetectedModsToActiveProfile(true);
            console.log('popupOpened -> auto-identify performed');
          }
          // Give popup any pendingRandomization and then clear it (popup will display)
          const { pendingRandomization } = await storage.get('pendingRandomization');
          if (pendingRandomization) {
            // Only send via runtime if popup open (it is) — but still return in response too
            try {
              if (isPopupOpen()) {
                chrome.runtime.sendMessage({ action: 'randomizationCompleted', enabledExtension: pendingRandomization.enabledExtension });
                console.log('popupOpened -> sent runtime randomizationCompleted to popup');
              }
            } catch (e) {
              console.warn('popupOpened: runtime.sendMessage failed', e && e.message);
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
          const { profiles = {} } = await storage.get('profiles');
          if (profiles[profileName]) {
            sendResponse({ status: 'error', message: 'Profile already exists' });
          } else {
            profiles[profileName] = [];
            await storage.set({ profiles });
            console.log('Created profile', profileName);
            sendResponse({ status: 'success' });
          }
          break;
        }

        case 'deleteProfile': {
          const { profileName } = message;
          const data = await storage.get(['profiles', 'activeProfile']);
          const profiles = data.profiles || {};
          let active = data.activeProfile || 'Default';
          if (!profiles[profileName]) {
            sendResponse({ status: 'error', message: 'Profile not found' });
            break;
          }
          delete profiles[profileName];
          // pick a new active if needed
          const remaining = Object.keys(profiles);
          if (!remaining.length) profiles['Default'] = [];
          if (active === profileName) active = remaining[0] || 'Default';
          await storage.set({ profiles, activeProfile: active });
          console.log('Deleted profile', profileName, 'new active', active);
          sendResponse({ status: 'success', activeProfile: active });
          break;
        }

        case 'renameProfile': {
          const { oldName, newName } = message;
          const { profiles = {}, activeProfile = 'Default' } = await storage.get(['profiles', 'activeProfile']);
          if (!profiles[oldName]) {
            sendResponse({ status: 'error', message: 'Old profile not found' });
            break;
          }
          if (profiles[newName]) {
            sendResponse({ status: 'error', message: 'New profile name already exists' });
            break;
          }
          profiles[newName] = profiles[oldName];
          delete profiles[oldName];
          const newActive = (activeProfile === oldName) ? newName : activeProfile;
          await storage.set({ profiles, activeProfile: newActive });
          console.log(`Renamed profile ${oldName} -> ${newName}`);
          sendResponse({ status: 'success', activeProfile: newActive });
          break;
        }

        case 'setActiveProfile': {
          const { profileName } = message;
          const { profiles = {} } = await storage.get('profiles');
          if (!profiles[profileName]) {
            sendResponse({ status: 'error', message: 'Profile not found' });
            break;
          }
          await storage.set({ activeProfile: profileName });
          console.log('Active profile set to', profileName);
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
  const s = await storage.get(['toggleRandomizeOnStartupChecked']);
  if (s.toggleRandomizeOnStartupChecked) {
    console.log('onStartup -> toggleRandomizeOnStartupChecked true; scheduling startup randomize');
    setTimeout(() => executeRandomization('startup', 5000), 1000); // small wait for startup
  }
});

chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'install') {
    // Initialize sensible defaults
    await storage.set({
      toggleRandomizeOnStartupChecked: false,
      autoModIdentificationChecked: true,
      toggleOpenModsTabChecked: true,
      toggleRandomizeOnSetTimeChecked: false,
      randomizeTime: 0,
      currentMod: 'None'
    });
    console.log('Installed: default settings saved');
    await identifyModExtensions();
    await ensureDefaults();
  } else if (details.reason === 'update') {
    console.log('Extension updated');
    const s = await storage.get('autoModIdentificationChecked');
    if (s.autoModIdentificationChecked) await identifyModExtensions();
    await ensureDefaults();
  }
});