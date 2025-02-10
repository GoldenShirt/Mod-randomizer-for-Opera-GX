chrome.runtime.onInstalled.addListener(() => {
    const initialSettings = {
        modExtensionIds: [],
        toggleRandomizeOnStartupChecked: true,
        autoModIdentificationChecked: true,
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
            identifyModExtensions();
            sendResponse({ status: 'success' });
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
        case 'SEARCH_QUERY': // Add this case
            chrome.management.getAll(extensions => {
                const filteredExtensions = extensions.filter(extension =>
                    extension.name.toLowerCase().includes(query.toLowerCase())
                );
                sendResponse({ extensions: filteredExtensions });
            });
            return true; // Required for async responses
        default:
            console.error('Unknown action:', action);
            sendResponse({ status: 'error', message: 'Unknown action' });
    }

    return true; // Required for async responses
});

function runStartupLogic() {
    chrome.storage.local.get(['toggleRandomizeOnStartupChecked', 'modExtensionIds'], ({ toggleRandomizeOnStartupChecked, modExtensionIds = [] }) => {
        if (toggleRandomizeOnStartupChecked) {
            handleModExtensions(modExtensionIds);
        }
    });
}

function identifyModExtensions() {
    chrome.management.getAll(extensions => {
        const modExtensionIds = extensions
            .filter(extension => extension.updateUrl === 'https://api.gx.me/store/mods/update')
            .map(extension => extension.id);

        chrome.storage.local.set({ modExtensionIds }, () => {
            console.log('Mod extensions identified:', modExtensionIds);
        });
    });
}

function saveModExtensionIds(modExtensionIds) {
    chrome.storage.local.set({ modExtensionIds }, () => {
        console.log('Mod extensions saved:', modExtensionIds);
    });
}

// Adjust runRandomization to take a callback that sends the enabled extension details
function runRandomization(callback) {
    chrome.storage.local.get('modExtensionIds', ({ modExtensionIds }) => {
        if (modExtensionIds && modExtensionIds.length > 0) {
            handleModExtensions(modExtensionIds, callback);
        } else {
            console.error('Error: Mod extensions not found in local storage');
            callback(null, modExtensionIds); // Pass null to indicate an error, along with modExtensionIds
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
