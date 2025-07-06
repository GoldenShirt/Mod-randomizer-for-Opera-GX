let redirectTimeout = null; // To track redirection timer
let randomizeTimeout; // For recurring randomization
let randomizationInProgress = false; // Lock to prevent parallel randomization processes

chrome.runtime.onInstalled.addListener(() => {
    const initialSettings = {
        modExtensionIds: [],
        toggleRandomizeOnStartupChecked: false,
        autoModIdentificationChecked: true,
        toggleOpenModsTabChecked: true,
        toggleRandomizeOnSetTimeChecked: false,
        randomizeTime: 0,
        currentMod: "None"
    };
    chrome.storage.local.set(initialSettings, () => {
        console.log('Mod Randomizer: Installed with settings:', initialSettings);
        identifyModExtensions();
    });
});

chrome.runtime.onStartup.addListener(runStartupLogic);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, query } = message;
    switch (action) {
        case 'identifyModExtensions':
            identifyModExtensions((modExtensionIds) =>
                sendResponse({ status: 'success', modExtensionIds })
            );
            break;
        case 'saveModExtensionIds':
            saveModExtensionIds(message.modExtensionIds);
            sendResponse({ status: 'success' });
            break;
        case 'randomizeMods':
            executeRandomization('manual', (selectedExtension, modExtensionIds) => {
                if (selectedExtension) {
                    sendResponse({
                        status: 'success',
                        enabledExtension: { id: selectedExtension.id, name: selectedExtension.name },
                        modExtensionIds: modExtensionIds
                    });
                } else {
                    sendResponse({ status: 'error', message: 'No mod extensions were enabled.' });
                }
            });
            break;
        case 'getExtensions':
            sendExtensionsData(sendResponse);
            break;
        case 'SEARCH_QUERY':
            chrome.management.getAll(extensions => {
                const filteredExtensions = extensions.filter(extension =>
                    extension.name.toLowerCase().includes(query.toLowerCase())
                );
                sendResponse({ extensions: filteredExtensions });
            });
            return true;
        case 'toggleRandomizeOnSetTimeChecked':
            if (message.value) {
                chrome.storage.local.get('randomizeTime', ({ randomizeTime }) => {
                    setRandomizeTime(randomizeTime);
                });
            } else {
                if (randomizeTimeout) {
                    clearInterval(randomizeTimeout);
                    randomizeTimeout = null;
                }
                chrome.alarms.clear('randomizeAlarm', () => {
                    console.log('Randomize alarm cleared.');
                });
            }
            sendResponse({ status: 'success' });
            break;
        case 'popupOpened':
            chrome.storage.local.get('autoModIdentificationChecked', ({ autoModIdentificationChecked }) => {
                if (autoModIdentificationChecked) {
                    identifyModExtensions(() => {
                        sendResponse({ status: 'success' });
                    });
                } else {
                    sendResponse({ status: 'success' });
                }
            });
            break;
        case 'setRandomizeTime':
            setRandomizeTime(message.time);
            sendResponse({ status: 'success' });
            break;
        default:
            console.error('Unknown action:', action);
            sendResponse({ status: 'error', message: 'Unknown action' });
    }
    return true;
});


function runStartupLogic() {
    console.log('Running startup logic');
    // existing startup randomize + open-mods-tab logic
    chrome.storage.local.get(
        ['toggleRandomizeOnStartupChecked', 'modExtensionIds', 'toggleOpenModsTabChecked'],
        ({ toggleRandomizeOnStartupChecked, modExtensionIds = [], toggleOpenModsTabChecked }) => {
            if (toggleRandomizeOnStartupChecked) {
                executeRandomization('startup', (selectedExtension) => {
                    // Log the result of startup randomization
                    if (selectedExtension) {
                        console.log('Startup randomization completed successfully.');
                    } else {
                        console.log('Startup randomization skipped or failed.');
                    }
                }, 5000); // Use standard 5 second delay for startup
            }
        }
    );
}

function identifyModExtensions(callback) {
    chrome.management.getAll(extensions => {
        const modExtensionIds = extensions
            .filter(extension => extension.updateUrl === 'https://api.gx.me/store/mods/update')
            .map(extension => extension.id);
        chrome.storage.local.set({ modExtensionIds }, () => {
            console.log('Identified mod extensions:', modExtensionIds);
            if (callback) callback(modExtensionIds);
        });
    });
}

function saveModExtensionIds(modExtensionIds) {
    chrome.storage.local.set({ modExtensionIds }, () => {
        console.log('Saved mod extension IDs:', modExtensionIds);
    });
}

// Modified runRandomization function accepts an optional redirectDelay (default: 5000 ms)
// Single entry point for all randomization operations
function executeRandomization(source = 'unknown', callback, redirectDelay = 5000) {
    // Check if randomization is already in progress (except for manual randomization)
    if (randomizationInProgress && source !== 'manual') {
        console.log(`Skipping ${source} randomization - another randomization is already in progress`);
        if (callback) callback(null);
        return;
    }

    // No need to log here as the specific sources (startup, alarm) already log their own messages
    const now = Date.now();

    // For manual randomization, bypass the cooldown check completely
    if (source === 'manual') {
        // For manual randomization, proceed directly without cooldown check
        proceedWithRandomization();
        return;
    }

    chrome.storage.local.get('lastRandomizationTime', ({ lastRandomizationTime }) => {
        // If less than 5 seconds have passed since last randomization, skip it
        if (lastRandomizationTime && (now - lastRandomizationTime) < 5000) {
            console.log(`Skipping ${source} randomization - too soon after last randomization`);
            if (callback) callback(null);
            return;
        }

        proceedWithRandomization();
    });

    function proceedWithRandomization() {
        // Set the lock at the beginning of randomization
        if (source !== 'manual') {
            randomizationInProgress = true;
        }

        // Only update the last randomization time for non-manual sources
        const updateTimePromise = source !== 'manual' ?
            new Promise(resolve => chrome.storage.local.set({ lastRandomizationTime: now }, resolve)) :
            Promise.resolve();

        updateTimePromise.then(() => {
            chrome.storage.local.get(['modExtensionIds', 'toggleOpenModsTabChecked'], ({ modExtensionIds, toggleOpenModsTabChecked }) => {
                if (modExtensionIds && modExtensionIds.length > 0) {
                    handleModExtensions(modExtensionIds, (selectedExtension, modExtensionIds) => {
                        if (selectedExtension) {
                            // Handle redirection to mods page if setting enabled
                            if (toggleOpenModsTabChecked) {
                                if (redirectTimeout) clearTimeout(redirectTimeout);
                                redirectTimeout = setTimeout(() => {
                                    chrome.tabs.create({ url: 'opera://mods/manage' });
                                    redirectTimeout = null;
                                }, redirectDelay);
                            }
                            // Release the lock after randomization completes
                            if (source !== 'manual') {
                                randomizationInProgress = false;
                            }
                            if (callback) callback(selectedExtension, modExtensionIds);
                        } else {
                            // Release the lock even if no extension was selected
                            if (source !== 'manual') {
                                randomizationInProgress = false;
                            }
                            if (callback) callback(null, modExtensionIds);
                        }
                    });
                } else {
                    console.log('No mod extensions found.');
                    // Release the lock if no mod extensions were found
                    if (source !== 'manual') {
                        randomizationInProgress = false;
                    }
                    if (callback) callback(null, modExtensionIds);
                }
            });
        });
            }
}

function handleModExtensions(modExtensionIds, callback) {
    chrome.storage.local.get(['lastEnabledModId'], ({ lastEnabledModId }) => {
        chrome.management.getAll(extensions => {
            const modExtensions = extensions.filter(extension => modExtensionIds.includes(extension.id));
            if (modExtensions.length > 0) {
                modExtensions.forEach(extension => {
                    if (extension.enabled) {
                        chrome.management.setEnabled(extension.id, false, () => {
                            console.log(`Disabled Extension: id: ${extension.id}, name: ${extension.name}`);
                        });
                    }
                });
                let disabledMods = modExtensions.filter(extension => !extension.enabled);
                if (lastEnabledModId) {
                    disabledMods = disabledMods.filter(mod => mod.id !== lastEnabledModId);
                }
                if (disabledMods.length > 0) {
                    const randomIndex = Math.floor(Math.random() * disabledMods.length);
                    const selectedExtension = disabledMods[randomIndex];
                    chrome.management.setEnabled(selectedExtension.id, true, () => {
                        console.log(`Enabled selected mod extension: id: ${selectedExtension.id}, name: ${selectedExtension.name}`);
                        chrome.storage.local.set({ lastEnabledModId: selectedExtension.id, currentMod: selectedExtension.name }, () => {
                            if (callback) callback(selectedExtension, modExtensionIds);
                        });
                    });
                } else {
                    console.log('No disabled mods available (excluding last enabled).');
                    if (callback) callback(null, modExtensionIds);
                }
            } else {
                console.log('No mod extensions found.');
                if (callback) callback(null, modExtensionIds);
            }
        });
    });
}

function sendExtensionsData(sendResponse) {
    chrome.storage.local.get(['modExtensionIds', 'autoModIdentificationChecked'], ({ modExtensionIds = [], autoModIdentificationChecked }) => {
        chrome.management.getAll(extensions => {
            sendResponse({ extensions, modExtensionIds, autoModIdentificationChecked });
        });
    });
}

function setRandomizeTime(time) {
    const parsedTime = parseFloat(time);
    if (isNaN(parsedTime)) {
        console.log(`Randomize time is not a number: ${time}`);
        return;
    }

    chrome.alarms.clear('randomizeAlarm', () => {
        if (parsedTime === 0) {
            chrome.storage.local.set({ randomizeTime: parsedTime }, () => {
                console.log(`Randomize time set to 0 minutes. Timer disabled.`);
            });
            return;
        }
        if (parsedTime < 0.25) {
            console.log(`Randomize time must be at least 0.25 minutes (15 seconds). Given: ${time}`);
            return;
        }

        chrome.storage.local.set({ randomizeTime: parsedTime }, () => {
            console.log(`Randomize time set to ${parsedTime} minutes`);
            chrome.storage.local.get('toggleRandomizeOnSetTimeChecked', ({ toggleRandomizeOnSetTimeChecked }) => {
                if (toggleRandomizeOnSetTimeChecked) {
                    // Schedule a persistent alarm with delayed first fire
                    chrome.alarms.create('randomizeAlarm', {
                        delayInMinutes: parsedTime,
                        periodInMinutes: parsedTime
                    });
                }
            });
        });
    });
}


// In your alarm listener, use a shorter redirect delay
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'randomizeAlarm') {
        console.log('Running set time randomization');
        executeRandomization('alarm', (selectedExtension) => {
            if (selectedExtension) {
                console.log('Randomization completed successfully.');
            } else {
                console.log('Randomization failed.');
            }
        }, 500); // Use shorter delay for alarm-triggered randomization
    }
});

// Function removed - replaced by executeRandomization