let redirectTimeout = null; // NEW: To track redirection timer
let randomizeTimeout; // For recurring randomization

chrome.runtime.onInstalled.addListener(() => {
    const initialSettings = {
        modExtensionIds: [],
        toggleRandomizeOnStartupChecked: false,
        autoModIdentificationChecked: true,
        toggleOpenModsTabChecked: true,
        toggleRandomizeOnSetTimeChecked: false,
        randomizeTime: 0
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
            runRandomization((selectedExtension, modExtensionIds) => {
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
    chrome.storage.local.get(
        ['toggleRandomizeOnStartupChecked', 'modExtensionIds', 'toggleOpenModsTabChecked'],
        ({ toggleRandomizeOnStartupChecked, modExtensionIds = [], toggleOpenModsTabChecked }) => {
            if (toggleRandomizeOnStartupChecked) {
                handleModExtensions(modExtensionIds, () => {
                    if (toggleOpenModsTabChecked) {
                        setTimeout(() => {
                            chrome.tabs.create({ url: 'opera://mods/manage' });
                        }, 5000);
                    }
                });
            }
        }
    );
    // NEW: Initialize randomize-on-set-time on startup
    chrome.storage.local.get(['toggleRandomizeOnSetTimeChecked', 'randomizeTime'], ({ toggleRandomizeOnSetTimeChecked, randomizeTime }) => {
        const parsedTime = parseFloat(randomizeTime);
        if (toggleRandomizeOnSetTimeChecked && !isNaN(parsedTime) && parsedTime >= 0.25) {
            setRandomizeTime(randomizeTime);
        }
    });
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

function runRandomization(callback) {
    chrome.storage.local.get(['modExtensionIds', 'toggleOpenModsTabChecked'], ({ modExtensionIds, toggleOpenModsTabChecked }) => {
        if (modExtensionIds && modExtensionIds.length > 0) {
            handleModExtensions(modExtensionIds, (selectedExtension, modExtensionIds) => {
                if (selectedExtension) {
                    // Always schedule redirection after 5 seconds if the setting is on.
                    chrome.storage.local.get('toggleOpenModsTabChecked', ({ toggleOpenModsTabChecked }) => {
                        if (toggleOpenModsTabChecked) {
                            // Reset the redirection timer if it already exists.
                            if (redirectTimeout) {
                                clearTimeout(redirectTimeout);
                            }
                            redirectTimeout = setTimeout(() => {
                                chrome.tabs.create({ url: 'opera://mods/manage' });
                                redirectTimeout = null;
                            }, 5000);
                        }
                    });
                    // Send a response back to the popup script to show the redirect message.
                    if (callback) callback(selectedExtension, modExtensionIds);
                } else {
                    if (callback) callback(null, modExtensionIds);
                }
            });
        } else {
            console.log('No mod extensions found.');
            if (callback) callback(null, modExtensionIds);
        }
    });
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
                        chrome.storage.local.set({ lastEnabledModId: selectedExtension.id }, () => {
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
    if (parsedTime === 0) {
        chrome.storage.local.set({ randomizeTime: parsedTime }, () => {
            console.log(`Randomize time set to 0 minutes. Timer disabled.`);
            chrome.alarms.clear('randomizeAlarm');
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
                // Schedule a persistent alarm.
                chrome.alarms.create('randomizeAlarm', {
                    periodInMinutes: parsedTime
                });
            }
        });
    });
}


chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'randomizeAlarm') {
        runRandomization((selectedExtension) => {
            if (selectedExtension) {
                console.log('Randomization completed successfully.');
            } else {
                console.log('Randomization failed.');
            }
        });
    }
});

