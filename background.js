let modsTabOpened = false;

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
        console.log('Mod Randomizer: Extension installed. Initializing settings.', initialSettings);
        identifyModExtensions();
    });
});

chrome.runtime.onStartup.addListener(runStartupLogic);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, query } = message;

    switch (action) {
        case 'identifyModExtensions':
            identifyModExtensions((modExtensionIds) => {
                sendResponse({ status: 'success', modExtensionIds });
            });
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
                        enabledExtension: selectedExtension,
                        modExtensionIds: modExtensionIds
                    });
                } else {
                    sendResponse({
                        status: 'error',
                        message: 'No mod extensions were enabled.'
                    });
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
            return true; // Required for async responses
        case 'setRandomizeTime':
            setRandomizeTime(message.time);
            sendResponse({ status: 'success' });
            break;
        default:
            console.error('Unknown action:', action);
            sendResponse({ status: 'error', message: 'Unknown action' });
    }

    return true; // Required for async responses
});

function runStartupLogic() {
    chrome.storage.local.get(['toggleRandomizeOnStartupChecked', 'modExtensionIds', 'toggleOpenModsTabChecked'], ({ toggleRandomizeOnStartupChecked, modExtensionIds = [], toggleOpenModsTabChecked }) => {
        if (toggleRandomizeOnStartupChecked) {
            handleModExtensions(modExtensionIds, () => {
                if (toggleOpenModsTabChecked && !modsTabOpened) {
                    chrome.tabs.create({ url: 'opera://mods/manage' });
                    modsTabOpened = true;
                }
            });
        }
    });
}

function identifyModExtensions(callback) {
    chrome.management.getAll(extensions => {
        const modExtensionIds = extensions
            .filter(extension => extension.updateUrl === 'https://api.gx.me/store/mods/update')
            .map(extension => extension.id);
        chrome.storage.local.set({ modExtensionIds }, () => {
            console.log('Mod extensions identified:', modExtensionIds);
            if (callback) callback(modExtensionIds);
        });
    });
}

function saveModExtensionIds(modExtensionIds) {
    chrome.storage.local.set({ modExtensionIds }, () => {
        console.log('Mod extensions saved:', modExtensionIds);
    });
}

function runRandomization(callback) {
    chrome.storage.local.get(['modExtensionIds', 'toggleOpenModsTabChecked'], ({ modExtensionIds, toggleOpenModsTabChecked }) => {
        if (modExtensionIds && modExtensionIds.length > 0) {
            handleModExtensions(modExtensionIds, (selectedExtension, modExtensionIds) => {
                if (selectedExtension) {
                    if (toggleOpenModsTabChecked && !modsTabOpened) {
                        setTimeout(() => {
                            chrome.tabs.create({ url: 'opera://mods/manage' });
                            modsTabOpened = true;
                        }, 5000); // Wait for 5 seconds before opening the tab
                    }
                }
                if (callback) callback(selectedExtension, modExtensionIds);
            });
        } else {
            console.error('Error: Mod extensions not found in local storage');
            if (callback) callback(null, modExtensionIds); // Pass null to indicate an error, along with modExtensionIds
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
                            logExtensionState('Disabled Extension', extension);
                        });
                    }
                });

                let disabledMods = modExtensions.filter(extension => !extension.enabled);

                // Remove the last enabled mod from the list of options
                if (lastEnabledModId) {
                    disabledMods = disabledMods.filter(mod => mod.id !== lastEnabledModId);
                }

                if (disabledMods.length > 0) {
                    const randomIndex = Math.floor(Math.random() * disabledMods.length);
                    const selectedExtension = disabledMods[randomIndex];
                    chrome.management.setEnabled(selectedExtension.id, true, () => {
                        logExtensionState('Enabled selected mod extension', selectedExtension);

                        // Save the newly enabled mod's ID
                        chrome.storage.local.set({ lastEnabledModId: selectedExtension.id }, () => {
                            if (callback) {
                                callback(selectedExtension, modExtensionIds);
                            }
                        });
                    });
                } else {
                    console.log('Mod Randomizer: No disabled mods to enable (excluding last enabled).');
                    if (callback) {
                        callback(null, modExtensionIds);
                    }
                }
            } else {
                console.log('Mod Randomizer: No mod extensions found.');
                if (callback) {
                    callback(null, modExtensionIds);
                }
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

function logExtensionState(action, extension) {
    console.log(`${action}:`, { id: extension.id, name: extension.name, enabled: extension.enabled });
}

function setRandomizeTime(time) {
    chrome.storage.local.set({ randomizeTime: time }, () => {
        console.log(`Randomize time set to ${time} minutes`);
        if (time > 0) {
            setTimeout(() => {
                runRandomization((selectedExtension, modExtensionIds) => {
                    if (selectedExtension) {
                        console.log('Randomization completed successfully.');
                        chrome.storage.local.get('toggleOpenModsTabChecked', ({ toggleOpenModsTabChecked }) => {
                            if (toggleOpenModsTabChecked && !modsTabOpened) {
                                chrome.tabs.create({ url: 'opera://mods/manage' });
                                modsTabOpened = true;
                            }
                        });
                    } else {
                        console.error('Randomization failed.');
                    }
                });
            }, time * 60000); // Convert minutes to milliseconds
        }
    });
}
