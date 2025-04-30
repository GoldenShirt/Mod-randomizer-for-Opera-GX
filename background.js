let redirectTimeout = null;
let randomizeTimeout;

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
                const filteredExtensions = extensions.filter(ext =>
                    ext.name.toLowerCase().includes(query.toLowerCase())
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
                    identifyModExtensions(() => sendResponse({ status: 'success' }));
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
    // 🔪 clear any missed alarm backlog
    chrome.alarms.clear('randomizeAlarm');

    // 🔁 re-schedule existing set-time alarm if enabled
    chrome.storage.local.get(
        ['toggleRandomizeOnSetTimeChecked', 'randomizeTime'],
        ({ toggleRandomizeOnSetTimeChecked, randomizeTime }) => {
            const minutes = parseFloat(randomizeTime);
            if (toggleRandomizeOnSetTimeChecked && minutes >= 0.25) {
                chrome.alarms.create('randomizeAlarm', {
                    delayInMinutes: minutes,
                    periodInMinutes: minutes
                });
            }
        }
    );

    // existing startup randomize and tab-open logic
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
}

function identifyModExtensions(callback) {
    chrome.management.getAll(extensions => {
        const modExtensionIds = extensions
            .filter(ext => ext.updateUrl === 'https://api.gx.me/store/mods/update')
            .map(ext => ext.id);
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

function runRandomization(callback, redirectDelay = 5000) {
    chrome.storage.local.get(['modExtensionIds', 'toggleOpenModsTabChecked'], ({ modExtensionIds, toggleOpenModsTabChecked }) => {
        if (modExtensionIds && modExtensionIds.length) {
            handleModExtensions(modExtensionIds, (selectedExtension, _ids) => {
                if (selectedExtension) {
                    chrome.storage.local.get('toggleOpenModsTabChecked', ({ toggleOpenModsTabChecked }) => {
                        if (toggleOpenModsTabChecked) {
                            if (redirectTimeout) clearTimeout(redirectTimeout);
                            redirectTimeout = setTimeout(() => {
                                chrome.tabs.create({ url: 'opera://mods/manage' });
                                redirectTimeout = null;
                            }, redirectDelay);
                        }
                    });
                    callback && callback(selectedExtension, modExtensionIds);
                } else {
                    callback && callback(null, modExtensionIds);
                }
            });
        } else {
            console.log('No mod extensions found.');
            callback && callback(null, modExtensionIds);
        }
    });
}

function handleModExtensions(modExtensionIds, callback) {
    chrome.storage.local.get(['lastEnabledModId'], ({ lastEnabledModId }) => {
        chrome.management.getAll(extensions => {
            const mods = extensions.filter(ext => modExtensionIds.includes(ext.id));
            mods.forEach(ext => ext.enabled &&
                chrome.management.setEnabled(ext.id, false)
            );
            let disabled = mods.filter(ext => !ext.enabled);
            if (lastEnabledModId) disabled = disabled.filter(ext => ext.id !== lastEnabledModId);
            if (!disabled.length) return callback && callback(null, modExtensionIds);
            const pick = disabled[Math.floor(Math.random()*disabled.length)];
            chrome.management.setEnabled(pick.id, true, () => {
                console.log(`Enabled: ${pick.name}`);
                chrome.storage.local.set({ lastEnabledModId: pick.id, currentMod: pick.name }, () => callback && callback(pick, modExtensionIds));
            });
        });
    });
}

function sendExtensionsData(sendResponse) {
    chrome.storage.local.get(['modExtensionIds', 'autoModIdentificationChecked'], ({ modExtensionIds = [], autoModIdentificationChecked }) => {
        chrome.management.getAll(exts => sendResponse({ extensions: exts, modExtensionIds, autoModIdentificationChecked }));
    });
}

function setRandomizeTime(time) {
    const parsedTime = parseFloat(time);
    if (isNaN(parsedTime)) return console.log(`Randomize time is not a number: ${time}`);
    chrome.alarms.clear('randomizeAlarm', () => {
        if (parsedTime === 0) return chrome.storage.local.set({ randomizeTime: parsedTime }, () => console.log(`Timer disabled.`));
        if (parsedTime < 0.25) return console.log(`Time must be at least 0.25 minutes. Given: ${time}`);
        chrome.storage.local.set({ randomizeTime: parsedTime }, () => {
            console.log(`Randomize time set to ${parsedTime} minutes`);
            chrome.storage.local.get('toggleRandomizeOnSetTimeChecked', ({ toggleRandomizeOnSetTimeChecked }) => {
                if (toggleRandomizeOnSetTimeChecked) {
                    chrome.alarms.create('randomizeAlarm', {
                        delayInMinutes: parsedTime,
                        periodInMinutes: parsedTime
                    });
                }
            });
        });
    });
}

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'randomizeAlarm') runRandomization(selected =>
            selected ? console.log('Randomization completed.') : console.log('Randomization failed.')
        , 500);
});
